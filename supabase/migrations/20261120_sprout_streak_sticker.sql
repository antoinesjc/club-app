-- Sprout sticker: also unlocked by a first 10-day streak in Zest Town (streak tree days: sessions, games, watering).
-- Runs every hour; the rewards-notify job then sends the "New sticker!" notification and the app shows the pop-up.
create or replace function public.award_streak_stickers() returns int
language sql security definer set search_path to ''
as $$
  with isl as (
    select t.user_id, t.d - (row_number() over (partition by t.user_id order by t.d))::int as grp from public.tree_days() t
  ), best as (
    select i.user_id, max(n) as best from (select user_id, grp, count(*) as n from isl group by user_id, grp) i group by i.user_id
  ), ins as (
    insert into public.sticker_awards (user_id, sticker, reason)
    select b.user_id, 'sprout', 'First 10-day streak in Zest Town'
    from best b join auth.users u on u.id = b.user_id
    where b.best >= 10 and public.access_role(u.email) = 'member'
    on conflict (user_id, sticker) do nothing
    returning 1
  )
  select count(*)::int from ins;
$$;
revoke all on function public.award_streak_stickers() from public, anon, authenticated;
select cron.schedule('club-streak-stickers', '7 * * * *', $$ select public.award_streak_stickers() $$);
