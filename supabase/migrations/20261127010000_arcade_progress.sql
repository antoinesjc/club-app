-- Arcade 遊戲廳: progress per member per game (stars per level, best score, plays). Own rows only.
create table if not exists public.arcade_progress (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  game text not null check (char_length(game) between 1 and 40),
  stars jsonb not null default '{}'::jsonb,  -- {"1": 3, "2": 2, ...}: best stars per level
  best int not null default 0,
  plays int not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, game)
);
alter table public.arcade_progress enable row level security;
drop policy if exists arcade_own_select on public.arcade_progress;
drop policy if exists arcade_own_insert on public.arcade_progress;
drop policy if exists arcade_own_update on public.arcade_progress;
create policy arcade_own_select on public.arcade_progress for select to authenticated using (user_id = auth.uid());
create policy arcade_own_insert on public.arcade_progress for insert to authenticated with check (user_id = auth.uid());
create policy arcade_own_update on public.arcade_progress for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke all on public.arcade_progress from anon;
grant select, insert, update on public.arcade_progress to authenticated;
