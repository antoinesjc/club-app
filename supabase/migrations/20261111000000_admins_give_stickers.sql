-- 11 Nov 2026 (Antoine): only admins give stickers and special avatars (hosts no longer can).
alter policy "Hosts give stickers" on public.sticker_awards with check (public.my_role() = 'admin');
alter policy "Hosts give stickers" on public.sticker_awards rename to "Admins give stickers";
alter policy "Hosts give special avatars" on public.avatar_awards with check (public.my_role() = 'admin');
alter policy "Hosts give special avatars" on public.avatar_awards rename to "Admins give special avatars";
