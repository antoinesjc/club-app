-- Calligraphy School courses (first: Oracle Bone Mystery): which chapters each member finished.
create table if not exists public.course_progress (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  course text not null,
  done integer[] not null default '{}',
  updated_at timestamptz not null default now(),
  primary key (user_id, course)
);
alter table public.course_progress enable row level security;
drop policy if exists course_progress_own on public.course_progress;
create policy course_progress_own on public.course_progress for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
