-- Great Chinese University (28 Nov 2026, admin demo): textbook courses on their own map above Zest Town.
-- Course content (adapted from the textbooks) lives here, never in the public repo. Readable by admins only during the demo.
create table if not exists public.uni_courses (
  id text primary key,
  title text not null,
  sort int not null default 0,
  price_cents int not null default 0,      -- Self-Study price (Club members get the Club price, decided later)
  published boolean not null default false,
  data_s jsonb not null,                    -- simplified
  data_t jsonb not null,                    -- traditional
  updated_at timestamptz not null default now()
);
alter table public.uni_courses enable row level security;
drop policy if exists uni_courses_read on public.uni_courses;
create policy uni_courses_read on public.uni_courses for select to authenticated
  using ((select public.my_role()) = 'admin');

-- Progress per person and course: {"<section>": {"at": "...", "stars": 3}}, plus the last part opened ("parts").
create table if not exists public.uni_progress (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  course text not null,
  done jsonb not null default '{}'::jsonb,
  parts jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, course)
);
alter table public.uni_progress enable row level security;
drop policy if exists uni_progress_own on public.uni_progress;
create policy uni_progress_own on public.uni_progress for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
grant select on public.uni_courses to authenticated;
grant select, insert, update, delete on public.uni_progress to authenticated;
