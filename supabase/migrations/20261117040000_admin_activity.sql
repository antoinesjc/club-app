-- 17 Nov 2026 (Antoine): Admin → Activity board (desktop). Members only (hosts and admins left out).
-- app_events records what the database didn't keep yet: app opens (with the device) and "Can't make it".
-- Everything else in the feed comes from existing tables, so it has history from day one.
-- Active = opened in the last 7 days, Quiet = 7–14 days, Inactive = 14+ days or never.

create table public.app_events (
  id          bigserial primary key,
  user_id     uuid not null references auth.users (id) on delete cascade default auth.uid(),
  kind        text not null check (kind in ('open', 'cant')),
  device      text not null default '' check (device in ('', 'phone-app', 'phone-browser', 'tablet', 'computer')),
  session_id  text,
  at          timestamptz not null default now()
);
create index app_events_user_at on public.app_events (user_id, at desc);
create index app_events_at on public.app_events (at desc);
alter table public.app_events enable row level security;
revoke all on public.app_events from anon, authenticated;

-- Called by the app when it opens (and when it comes back after 30+ minutes away). At most one per 30 min.
create or replace function public.log_open(p_device text)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  insert into public.app_events (user_id, kind, device)
  select auth.uid(), 'open', case when p_device in ('phone-app', 'phone-browser', 'tablet', 'computer') then p_device else '' end
  where public.is_member() and not exists (
    select 1 from public.app_events e where e.user_id = auth.uid() and e.kind = 'open' and e.at > now() - interval '30 minutes');
$$;
revoke all on function public.log_open(text) from public, anon;
grant execute on function public.log_open(text) to authenticated;

-- "Can't make it" removes the interest row, so keep a trace of it.
create or replace function public.interest_removed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.app_events (user_id, kind, session_id) values (old.user_id, 'cant', old.session_id);
  return old;
end;
$$;
revoke all on function public.interest_removed() from public, anon, authenticated;
create trigger interest_removed after delete on public.interests for each row execute function public.interest_removed();

-- Members only (role 'member' on the access list).
create or replace function public.member_ids()
returns table (user_id uuid, name text)
language sql
stable
security definer
set search_path = ''
as $$
  select u.id, p.display_name from auth.users u left join public.profiles p on p.id = u.id
  where public.access_role(u.email) = 'member';
$$;
revoke all on function public.member_ids() from public, anon, authenticated;

-- Last seen: latest app open, or sign-in for members who haven't opened the app since tracking started.
create or replace function public.admin_activity_members()
returns table (user_id uuid, name text, last_seen timestamptz, device text, opens_7d integer, sessions_30d integer,
               imin_7d integer, xp_month integer, notif boolean)
language sql
stable
security definer
set search_path = ''
as $$
  with m as (select * from public.member_ids()),
  month_start as (select (date_trunc('month', now() at time zone 'Europe/Brussels') at time zone 'Europe/Brussels') as t)
  select m.user_id, m.name,
    greatest((select max(e.at) from public.app_events e where e.user_id = m.user_id and e.kind = 'open'),
             (select u.last_sign_in_at from auth.users u where u.id = m.user_id)),
    (select e.device from public.app_events e where e.user_id = m.user_id and e.kind = 'open' and e.device <> '' order by e.at desc limit 1),
    (select count(*) from public.app_events e where e.user_id = m.user_id and e.kind = 'open' and e.at > now() - interval '7 days')::int,
    (select count(*) from public.attendance a join public.sessions s on s.id = a.session_id
      where a.user_id = m.user_id and not s.cancelled and s.starts_at > now() - interval '30 days')::int,
    (select count(*) from public.interests i where i.user_id = m.user_id and i.created_at > now() - interval '7 days')::int,
    coalesce((select sum(x.points) from public.xp_events() x, month_start where x.user_id = m.user_id and x.at >= month_start.t), 0)::int,
    exists (select 1 from public.push_subscriptions s where s.user_id = m.user_id)
  from m
  where public.my_role() = 'admin';
$$;
revoke all on function public.admin_activity_members() from public, anon;
grant execute on function public.admin_activity_members() to authenticated;

-- Members who opened the app per day (Taiwan time), last 30 days.
create or replace function public.admin_activity_daily()
returns table (day date, members integer, opens integer)
language sql
stable
security definer
set search_path = ''
as $$
  with days as (select generate_series((now() at time zone 'Asia/Taipei')::date - 29, (now() at time zone 'Asia/Taipei')::date, interval '1 day')::date as day)
  select d.day, count(distinct e.user_id)::int, count(e.id)::int
  from days d
  left join public.app_events e on e.kind = 'open' and (e.at at time zone 'Asia/Taipei')::date = d.day
    and e.user_id in (select user_id from public.member_ids())
  where public.my_role() = 'admin'
  group by d.day order by d.day;
$$;
revoke all on function public.admin_activity_daily() from public, anon;
grant execute on function public.admin_activity_daily() to authenticated;

-- Live feed of member activity. p_group: 'all', 'sessions', 'learning', 'community'.
create or replace function public.admin_activity_feed(p_group text default 'all', p_before timestamptz default null, p_limit integer default 30)
returns table (at timestamptz, user_id uuid, name text, kind text, label text, grp text)
language sql
stable
security definer
set search_path = ''
as $$
  with m as (select * from public.member_ids()),
  ev as (
    select e.at, e.user_id, 'open' as kind,
      case e.device when 'phone-app' then 'on the phone app' when 'phone-browser' then 'on a phone browser' when 'tablet' then 'on a tablet' when 'computer' then 'on a computer' else '' end as label,
      'community' as grp
    from public.app_events e where e.kind = 'open'
    union all
    select e.at, e.user_id, 'cant', coalesce(s.title, 'a session') || coalesce(' · ' || to_char(s.starts_at at time zone 'Asia/Taipei', 'Dy DD Mon HH24:MI'), ''), 'sessions'
    from public.app_events e left join public.sessions s on s.id = e.session_id where e.kind = 'cant'
    union all
    select i.created_at, i.user_id, 'imin', coalesce(s.title, 'a session') || coalesce(' · ' || to_char(s.starts_at at time zone 'Asia/Taipei', 'Dy DD Mon HH24:MI'), ''), 'sessions'
    from public.interests i left join public.sessions s on s.id = i.session_id
    union all
    select greatest(s.starts_at, a.created_at), a.user_id, 'attended', s.title, 'sessions'
    from public.attendance a join public.sessions s on s.id = a.session_id where not s.cancelled
    union all
    select h.created_at, h.giver, 'hongbao', coalesce(p.display_name, 'a member'), 'community'
    from public.hongbaos h left join public.profiles p on p.id = h.receiver
    union all
    select i.created_at, i.user_id, 'idea', case i.category when 'sessions' then 'Sessions' when 'app' then 'App features' when 'discord' then 'Discord' else 'Something else' end, 'community'
    from public.ideas i
    union all
    select b.created_at, b.user_id, 'bootcamp', b.title, 'learning'
    from public.bootcamp_requests b
    union all
    select a.awarded_at, a.user_id, 'sticker', a.sticker, 'community'
    from public.sticker_awards a
    union all
    select x.awarded_at, x.user_id, 'xp', x.points::text || coalesce(' · ' || nullif(x.reason, ''), ''), 'learning'
    from public.xp_awards x
  )
  select ev.at, ev.user_id, m.name, ev.kind, ev.label, ev.grp
  from ev join m on m.user_id = ev.user_id
  where public.my_role() = 'admin' and ev.at <= now() + interval '1 day'
    and (p_group = 'all' or ev.grp = p_group)
    and (p_before is null or ev.at < p_before)
  order by ev.at desc
  limit least(greatest(p_limit, 1), 100);
$$;
revoke all on function public.admin_activity_feed(text, timestamptz, integer) from public, anon;
grant execute on function public.admin_activity_feed(text, timestamptz, integer) to authenticated;
