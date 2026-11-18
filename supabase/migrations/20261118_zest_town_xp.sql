-- Zest Town XP (kept small so sessions stay the core of the Club):
--   'game' +1 XP: played a game in Zest Town that day (max once a day: learn_days has one 'game' row per day)
--   'tree' +2 XP: every 10th day in a row of the streak tree (day 10, 20, 30, ...)
-- Only for people who have Learning: beta testers and admins now; everyone once private.config learning_live = 'true'.
insert into private.config (name, value) values ('learning_live', 'false') on conflict (name) do nothing;

create or replace function public.learning_on(p_user uuid) returns boolean
language sql stable security definer set search_path to ''
as $$
  select coalesce((select c.value = 'true' from private.config c where c.name = 'learning_live'), false)
    or exists (select 1 from public.beta_testers b where b.user_id = p_user)
    or exists (select 1 from auth.users u where u.id = p_user and public.access_role(u.email) = 'admin');
$$;

-- Days that count for each person's streak tree, in their own time zone.
create or replace function public.tree_days()
returns table(user_id uuid, d date)
language sql stable security definer set search_path to ''
as $$
  with tz as (select p.id, coalesce(nullif(p.timezone, ''), 'Asia/Taipei') as tz from public.profiles p where public.learning_on(p.id))
  select distinct t.id, (s.starts_at at time zone t.tz)::date
    from tz t join public.attendance a on a.user_id = t.id join public.sessions s on s.id = a.session_id
    where not s.cancelled and s.starts_at <= now()
  union
  select l.user_id, l.day from public.learn_days l join tz t on t.id = l.user_id;
$$;
revoke all on function public.tree_days() from public, anon, authenticated;

create or replace function public.xp_events()
 returns table(user_id uuid, points integer, kind text, at timestamp with time zone, session_id text)
 language sql stable security definer set search_path to ''
as $function$
  with att as (
    select a.user_id, s.id as session_id, s.starts_at
    from public.attendance a join public.sessions s on s.id = a.session_id
    where not s.cancelled
  ),
  weeks as (
    select distinct att.user_id, date_trunc('week', att.starts_at at time zone 'Europe/Brussels')::date as wk from att
  ),
  islands as (
    select w.user_id, w.wk,
      (w.wk - date '2000-01-03') / 7 - row_number() over (partition by w.user_id order by w.wk) as grp
    from weeks w
  ),
  runs as (
    select i.user_id, i.wk, row_number() over (partition by i.user_id, i.grp order by i.wk) as rn from islands i
  ),
  tdays as (select * from public.tree_days()),
  tisl as (select t.user_id, t.d, t.d - (row_number() over (partition by t.user_id order by t.d))::int as grp from tdays t),
  truns as (select t.user_id, t.d, row_number() over (partition by t.user_id, t.grp order by t.d) as rn from tisl t)
  select att.user_id, 20, 'session', att.starts_at, att.session_id from att
  union all
  select r.user_id, 50, 'streak', (r.wk::timestamp at time zone 'Europe/Brussels'), null from runs r where r.rn % 4 = 0
  union all
  select x.user_id, x.points, x.kind, x.awarded_at, null from public.xp_awards x
  union all
  select h.receiver, 30, 'hongbao', h.created_at, null from public.hongbaos h
  union all
  select l.user_id, 1, 'game', l.created_at, null from public.learn_days l where l.kind = 'game' and public.learning_on(l.user_id)
  union all
  select t.user_id, 2, 'tree', (t.d + time '12:00')::timestamp at time zone 'Asia/Taipei', null from truns t where t.rn % 10 = 0;
$function$;

create or replace function public.member_activity(p_user uuid)
 returns table(at timestamp with time zone, kind text, points integer, title text, detail text, by_name text)
 language sql stable security definer set search_path to ''
as $function$
  select t.at, t.kind, t.points, t.title, t.detail, t.by_name from (
    select s.starts_at as at, 'session'::text as kind, 20 as points, s.title, nullif(s.host_name, '') as detail, null::text as by_name
    from public.attendance a join public.sessions s on s.id = a.session_id
    where a.user_id = p_user and not s.cancelled
    union all
    select e.at, e.kind, e.points, case e.kind when 'streak' then '4 weeks in a row' when 'game' then 'Zest Town game' else '10-day streak tree' end, null, null
    from public.xp_events() e where e.user_id = p_user and e.kind in ('streak', 'game', 'tree')
    union all
    select x.awarded_at, x.kind, x.points, case x.kind when 'bootcamp' then 'Bootcamp' else 'Bonus' end, nullif(x.reason, ''), g.display_name
    from public.xp_awards x left join public.profiles g on g.id = x.awarded_by where x.user_id = p_user
    union all
    select h.created_at, 'hongbao', 30, 'Hongbao', g.display_name, null
    from public.hongbaos h left join public.profiles g on g.id = h.giver where h.receiver = p_user
    union all
    select a.awarded_at, 'sticker', 0, a.sticker, nullif(a.reason, ''), g.display_name
    from public.sticker_awards a left join public.profiles g on g.id = a.awarded_by where a.user_id = p_user
    union all
    select a.awarded_at, 'avatar', 0, a.avatar, nullif(a.reason, ''), null
    from public.avatar_awards a where a.user_id = p_user
  ) t
  where public.my_role() = 'admin'
  order by t.at desc;
$function$;
