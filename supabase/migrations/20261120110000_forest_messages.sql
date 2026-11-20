-- Magical Forest: one short message per person, Chinese characters only (traditional or simplified) + Chinese punctuation.
create table if not exists public.forest_messages (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  body text not null,
  updated_at timestamptz not null default now(),
  constraint forest_message_chinese check (
    char_length(body) between 1 and 30
    and body ~ '^[㐀-䶿一-鿿　-〿！（），：；？～…—·“”‘’ ]+$'
    and body ~ '[㐀-䶿一-鿿]'
  )
);
alter table public.forest_messages enable row level security;
drop policy if exists "club reads messages" on public.forest_messages;
create policy "club reads messages" on public.forest_messages for select to authenticated using (public.my_role() in ('member', 'host', 'admin'));
drop policy if exists "own message insert" on public.forest_messages;
create policy "own message insert" on public.forest_messages for insert to authenticated with check (user_id = auth.uid() and public.my_role() in ('member', 'host', 'admin'));
drop policy if exists "own message update" on public.forest_messages;
create policy "own message update" on public.forest_messages for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "own or admin delete" on public.forest_messages;
create policy "own or admin delete" on public.forest_messages for delete to authenticated using (user_id = auth.uid() or public.my_role() = 'admin');
grant select, insert, update, delete on public.forest_messages to authenticated;
