-- Calligraphy School: "You looked up", saved per member so it's the same on every device.
create table if not exists public.char_recent (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  text text not null check (char_length(text) between 1 and 8),
  looked_at timestamptz not null default now(),
  primary key (user_id, text)
);
alter table public.char_recent enable row level security;
drop policy if exists char_recent_own on public.char_recent;
create policy char_recent_own on public.char_recent for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
