-- 1 Nov 2026 (Antoine): no more hiding from the member directory; every member is visible.
update public.profiles set show_in_directory = true where not show_in_directory;
alter table public.profiles alter column show_in_directory set default true;
revoke update (show_in_directory) on public.profiles from authenticated;
alter policy "Members see visible profiles, their own, and hosts see all" on public.profiles using (public.is_member());
