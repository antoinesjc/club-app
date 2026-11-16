-- 16 Nov 2026 (Antoine): admins see a member's activity on their profile:
-- sessions attended, every XP gain (sessions, streaks, bootcamps, bonuses, hongbaos),
-- stickers and special avatars received. Admins only; returns nothing for anyone else.

create or replace function public.member_activity(p_user uuid)
returns table (at timestamptz, kind text, points integer, title text, detail text, by_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select t.at, t.kind, t.points, t.title, t.detail, t.by_name from (
    select s.starts_at as at, 'session'::text as kind, 20 as points, s.title, nullif(s.host_name, '') as detail, null::text as by_name
    from public.attendance a join public.sessions s on s.id = a.session_id
    where a.user_id = p_user and not s.cancelled
    union all
    select e.at, 'streak', e.points, '4 weeks in a row', null, null
    from public.xp_events() e where e.user_id = p_user and e.kind = 'streak'
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
$$;
revoke all on function public.member_activity(uuid) from public, anon;
grant execute on function public.member_activity(uuid) to authenticated;
