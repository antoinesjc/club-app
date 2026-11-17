-- Magical Forest (beta): members who opened the app in the last 24 hours, with their streak tree.
-- Streak = days in a row (in the member's own time zone) with a session attended or a Zest Town game,
-- or saved with the watering can; ends today or yesterday.
create or replace function public.forest_members()
returns table(user_id uuid, name text, fruit text, bg text, country text, last_seen timestamptz, streak int)
language sql stable security definer set search_path to ''
as $$
  with seen as (
    select x.uid, max(x.at) as at from (
      select e.user_id as uid, e.at from public.app_events e where e.kind = 'open' and e.at >= now() - interval '24 hours'
      union all
      select r.user_id::uuid, greatest(r.created_at, r.updated_at) from auth.refresh_tokens r
        where r.updated_at >= now() - interval '24 hours' and r.user_id ~ '^[0-9a-f-]{36}$'
    ) x group by x.uid
  ), mem as (
    select p.id, p.display_name, p.fruit, p.bg, p.country, s.at,
      coalesce(nullif(p.timezone, ''), 'Asia/Taipei') as tz
    from seen s join public.profiles p on p.id = s.uid join auth.users u on u.id = p.id
    where public.access_role(u.email) = 'member'
  ), days as (
    select distinct m.id, (se.starts_at at time zone m.tz)::date as d
      from mem m join public.attendance a on a.user_id = m.id join public.sessions se on se.id = a.session_id
      where not se.cancelled and se.starts_at <= now()
    union
    select l.user_id, l.day from public.learn_days l join mem m on m.id = l.user_id
  ), isl as (
    select d.id, d.d, d.d - (row_number() over (partition by d.id order by d.d))::int as grp from days d
  ), runs as (
    select i.id, max(i.d) as last_day, count(*)::int as len from isl i group by i.id, i.grp
  )
  select m.id, m.display_name, m.fruit, m.bg, m.country, m.at,
    coalesce((select r.len from runs r where r.id = m.id and r.last_day >= (now() at time zone m.tz)::date - 1 order by r.last_day desc limit 1), 0)
  from mem m
  where public.is_beta()
  order by m.at desc;
$$;
revoke all on function public.forest_members() from public, anon;
grant execute on function public.forest_members() to authenticated;
