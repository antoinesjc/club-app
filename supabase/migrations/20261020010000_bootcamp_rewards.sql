-- What each bootcamp gives (Antoine, 20 Oct 2026): XP + an optional sticker, shown on the bootcamp card.
-- Set by admins on the card; the "Give XP or a sticker" form fills in from it.
-- bootcamp = the bootcamp's page URL from the website feed (or its title if it has no URL).
create table public.bootcamp_rewards (
  bootcamp   text primary key check (char_length(bootcamp) between 1 and 300),
  xp         integer not null default 0 check (xp between 0 and 2000),
  sticker    text check (sticker is null or public.sticker_ok(sticker)),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null default auth.uid()
);
alter table public.bootcamp_rewards enable row level security;
create policy "Members see bootcamp rewards" on public.bootcamp_rewards for select to authenticated
  using (public.is_member());
create policy "Admins add bootcamp rewards" on public.bootcamp_rewards for insert to authenticated
  with check (public.my_role() = 'admin');
create policy "Admins change bootcamp rewards" on public.bootcamp_rewards for update to authenticated
  using (public.my_role() = 'admin') with check (public.my_role() = 'admin');
create policy "Admins remove bootcamp rewards" on public.bootcamp_rewards for delete to authenticated
  using (public.my_role() = 'admin');
revoke all on public.bootcamp_rewards from anon, authenticated;
grant select, insert, update, delete on public.bootcamp_rewards to authenticated;
