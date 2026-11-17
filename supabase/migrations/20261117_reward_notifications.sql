-- Phone notifications for rewards: XP from the team, stickers, characters and level-ups.
alter table public.xp_awards add column if not exists notified_at timestamptz;
alter table public.sticker_awards add column if not exists notified_at timestamptz;
alter table public.avatar_awards add column if not exists notified_at timestamptz;
update public.xp_awards set notified_at = now() where notified_at is null;
update public.sticker_awards set notified_at = now() where notified_at is null;
update public.avatar_awards set notified_at = now() where notified_at is null;
alter table public.profiles add column if not exists notify_rewards boolean not null default true;

-- Last level we told each member about.
create table if not exists private.member_levels (
  user_id uuid primary key references auth.users(id) on delete cascade,
  level int not null,
  updated_at timestamptz not null default now()
);

-- Members whose level went up since the last run (and remembers the new level). Service role only.
create or replace function public.reward_level_ups()
returns table(user_id uuid, old_level int, new_level int)
language plpgsql security definer set search_path to ''
as $$
#variable_conflict use_column
begin
  return query
  with cur as (
    select p.id as uid, public.xp_level(coalesce(sum(e.points), 0)::int) as lv
    from public.profiles p
    join auth.users u on u.id = p.id
    left join public.xp_events() e on e.user_id = p.id
    where public.access_role(u.email) = 'member'
    group by p.id
  ), ups as (
    insert into private.member_levels as m (user_id, level)
    select c.uid, c.lv from cur c
    on conflict (user_id) do update set level = excluded.level, updated_at = now()
      where m.level < excluded.level
    returning m.user_id as uid, m.level as lv, (m.xmax <> 0) as was_update
  )
  select x.uid, null::int, x.lv from ups x where x.was_update;
end $$;
revoke all on function public.reward_level_ups() from public, anon, authenticated;
grant execute on function public.reward_level_ups() to service_role;

-- Seed today's levels so nobody gets a notification for old level-ups.
insert into private.member_levels (user_id, level)
select p.id, public.xp_level(coalesce(sum(e.points), 0)::int)
from public.profiles p join auth.users u on u.id = p.id
left join public.xp_events() e on e.user_id = p.id
where public.access_role(u.email) = 'member'
group by p.id
on conflict (user_id) do nothing;
