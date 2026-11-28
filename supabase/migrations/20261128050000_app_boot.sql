-- Speed (28 Nov 2026): everything loadAll() needs at startup in ONE call instead of ~20 parallel requests
-- (which queued for the database's few connections; each trip from Asia to Ireland also costs ~0.25 s).
-- Security invoker: every table keeps its own row-level security, every function its own checks.
create or replace function public.app_boot(p_since timestamptz)
returns json language sql stable set search_path = '' as $$
  select json_build_object(
    'sessions', (select coalesce(json_agg(x order by x.starts_at), '[]') from (select id, title, level, category, starts_at, ends_at, topic, about, host_name, cancelled, synced_at, skill_level, cats
                   from public.sessions where not cancelled and starts_at >= p_since) x),
    'interests', (select coalesce(json_agg(x), '[]') from (select session_id, user_id from public.interests) x),
    'profiles', (select coalesce(json_agg(x), '[]') from (select id, display_name, fruit, bg, country, chinese_level, show_in_directory, script, created_at, updated_at, notify_reminders,
                   notify_new, notify_notes, notify_email, timezone, bio, sticker, notify_rewards, notify_streak, phonetic, tour_seen, show_milestones from public.profiles) x),
    'roles', (select coalesce(json_agg(x), '[]') from public.member_roles() x),
    'meet', (select coalesce(json_agg(x), '[]') from public.club_meet_urls() x),
    'discords', (select coalesce(json_agg(x), '[]') from public.club_discords() x),
    'attendance', (select coalesce(json_agg(x), '[]') from (select session_id, user_id from public.attendance) x),
    'notes', (select coalesce(json_agg(x), '[]') from public.session_notes x),
    'board', (select coalesce(json_agg(x), '[]') from public.xp_board() x),
    'awards', (select coalesce(json_agg(x order by x.awarded_at desc), '[]') from public.xp_awards x),
    'stats', (select coalesce(json_agg(x), '[]') from public.member_stats() x),
    'stickers', (select coalesce(json_agg(x order by x.awarded_at desc), '[]') from public.sticker_awards x),
    'worn', (select coalesce(json_agg(x), '[]') from public.board_stickers() x),
    'rewards', (select coalesce(json_agg(x), '[]') from public.bootcamp_rewards x),
    'bootcamps', (select coalesce(json_agg(x), '[]') from public.member_bootcamps() x),
    'hosts', (select coalesce(json_agg(x), '[]') from public.session_hosts() x),
    'meet_name', (select h.meet_name from public.host_meet_names h where h.user_id = (select auth.uid())),
    'hb_in', (select coalesce(json_agg(x), '[]') from public.hongbao_inbox() x),
    'avatar_awards', (select coalesce(json_agg(x), '[]') from public.avatar_awards x),
    'hb_given', (select row_to_json(x) from (select * from public.hongbaos where giver = (select auth.uid()) order by created_at desc limit 1) x)
  );
$$;
revoke all on function public.app_boot(timestamptz) from public, anon;
grant execute on function public.app_boot(timestamptz) to authenticated;
