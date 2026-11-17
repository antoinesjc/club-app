-- Streak reminder (Learning beta): a phone notification one hour before the member's day ends
-- (23:00 in their time zone) if their streak tree hasn't grown today. Push only, never email.
alter table public.profiles add column if not exists notify_streak boolean not null default true;
create table if not exists private.streak_notify_log (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  sent_at timestamptz not null default now(),
  primary key (user_id, day)
);

create or replace function public.streak_reminders()
returns table(user_id uuid, streak int, day date)
language sql stable security definer set search_path to ''
as $$
  with due as (
    select p.id, coalesce(nullif(p.timezone, ''), 'Asia/Taipei') as tz
    from public.profiles p join auth.users u on u.id = p.id
    where p.notify_streak
      and (public.access_role(u.email) = 'admin' or exists (select 1 from public.beta_testers b where b.user_id = p.id))
      and exists (select 1 from public.push_subscriptions s where s.user_id = p.id)
  ), win as (
    select d.id, d.tz, (now() at time zone d.tz)::date as today from due d
    where extract(hour from now() at time zone d.tz) = 23
      and not exists (select 1 from private.streak_notify_log l where l.user_id = d.id and l.day = (now() at time zone d.tz)::date)
  ), days as (
    select distinct w.id, (se.starts_at at time zone w.tz)::date as d
      from win w join public.attendance a on a.user_id = w.id join public.sessions se on se.id = a.session_id
      where not se.cancelled and se.starts_at <= now()
    union
    select l.user_id, l.day from public.learn_days l join win w on w.id = l.user_id
  ), isl as (
    select d.id, d.d, d.d - (row_number() over (partition by d.id order by d.d))::int as grp from days d
  ), runs as (
    select i.id, max(i.d) as last_day, count(*)::int as len from isl i group by i.id, i.grp
  )
  select w.id, r.len, w.today
  from win w join runs r on r.id = w.id and r.last_day = w.today - 1
  where not exists (select 1 from days x where x.id = w.id and x.d = w.today);
$$;
revoke all on function public.streak_reminders() from public, anon, authenticated;
grant execute on function public.streak_reminders() to service_role;

create or replace function public.streak_reminder_sent(p_users uuid[], p_days date[])
returns void language sql security definer set search_path to ''
as $$ insert into private.streak_notify_log (user_id, day) select * from unnest(p_users, p_days) on conflict do nothing; $$;
revoke all on function public.streak_reminder_sent(uuid[], date[]) from public, anon, authenticated;
grant execute on function public.streak_reminder_sent(uuid[], date[]) to service_role;
