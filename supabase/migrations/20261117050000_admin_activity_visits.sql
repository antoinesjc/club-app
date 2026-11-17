-- 17 Nov 2026: more accurate "last seen" and app opens on the Activity board.
-- The app keeps members signed in, so the sign-in date can be weeks old for someone who uses the app daily.
-- But the app renews each member's login (auth.refresh_tokens) about once an hour while it's in use: a reliable
-- trace of visits, with history since launch. A visit = app open or login renewal, counted once per 30 minutes.

create or replace function public.member_visits(p_since timestamptz)
returns table (user_id uuid, at timestamptz, device text)
language sql
stable
security definer
set search_path = ''
as $$
  with raw as (
    select e.user_id, e.at, e.device from public.app_events e where e.kind = 'open' and e.at >= p_since
    union all
    select r.user_id::uuid, r.created_at, '' from auth.refresh_tokens r where r.created_at >= p_since and r.user_id ~ '^[0-9a-f-]{36}$'
  )
  select x.user_id, min(x.at), max(x.device)
  from raw x
  group by x.user_id, floor(extract(epoch from x.at) / 1800);
$$;
revoke all on function public.member_visits(timestamptz) from public, anon, authenticated;

create or replace function public.admin_activity_members()
returns table (user_id uuid, name text, last_seen timestamptz, device text, opens_7d integer, sessions_30d integer,
               imin_7d integer, xp_month integer, notif boolean)
language sql
stable
security definer
set search_path = ''
as $$
  with m as (select * from public.member_ids()),
  v as (select * from public.member_visits(now() - interval '60 days')),
  month_start as (select (date_trunc('month', now() at time zone 'Europe/Brussels') at time zone 'Europe/Brussels') as t)
  select m.user_id, m.name,
    greatest((select max(v.at) from v where v.user_id = m.user_id),
             (select u.last_sign_in_at from auth.users u where u.id = m.user_id),
             (select max(i.created_at) from public.interests i where i.user_id = m.user_id)),
    (select e.device from public.app_events e where e.user_id = m.user_id and e.kind = 'open' and e.device <> '' order by e.at desc limit 1),
    (select count(*) from v where v.user_id = m.user_id and v.at > now() - interval '7 days')::int,
    (select count(*) from public.attendance a join public.sessions s on s.id = a.session_id
      where a.user_id = m.user_id and not s.cancelled and s.starts_at > now() - interval '30 days')::int,
    (select count(*) from public.interests i where i.user_id = m.user_id and i.created_at > now() - interval '7 days')::int,
    coalesce((select sum(x.points) from public.xp_events() x, month_start where x.user_id = m.user_id and x.at >= month_start.t), 0)::int,
    exists (select 1 from public.push_subscriptions s where s.user_id = m.user_id)
  from m
  where public.my_role() = 'admin';
$$;

create or replace function public.admin_activity_daily()
returns table (day date, members integer, opens integer)
language sql
stable
security definer
set search_path = ''
as $$
  with days as (select generate_series((now() at time zone 'Asia/Taipei')::date - 29, (now() at time zone 'Asia/Taipei')::date, interval '1 day')::date as day),
  v as (select * from public.member_visits(now() - interval '31 days') where user_id in (select user_id from public.member_ids()))
  select d.day, count(distinct v.user_id)::int, count(v.at)::int
  from days d left join v on (v.at at time zone 'Asia/Taipei')::date = d.day
  where public.my_role() = 'admin'
  group by d.day order by d.day;
$$;

create or replace function public.admin_activity_feed(p_group text default 'all', p_before timestamptz default null, p_limit integer default 30)
returns table (at timestamptz, user_id uuid, name text, kind text, label text, grp text)
language sql
stable
security definer
set search_path = ''
as $$
  with m as (select * from public.member_ids()),
  ev as (
    select v.at, v.user_id, 'open' as kind,
      case v.device when 'phone-app' then 'on the phone app' when 'phone-browser' then 'on a phone browser' when 'tablet' then 'on a tablet' when 'computer' then 'on a computer' else '' end as label,
      'community' as grp
    from public.member_visits(coalesce(p_before, now()) - interval '60 days') v
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
