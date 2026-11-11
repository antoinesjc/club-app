-- 11 Nov 2026 (Antoine): "Request to join" on bootcamp cards (replaces "Ask a host to join" on Discord).
-- The member confirms in two steps; the request is stored here and emailed to contact@mandarinzest.com
-- by the bootcamp-notify function (every 5 minutes, retried until the email goes out).

create table public.bootcamp_requests (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade default auth.uid(),
  bootcamp    text not null check (char_length(bootcamp) between 1 and 300),  -- bootcamp page URL (or title)
  title       text not null check (char_length(title) between 1 and 200),
  status      text not null default '' check (char_length(status) <= 60),   -- card status when requested
  created_at  timestamptz not null default now(),
  notified_at timestamptz,
  unique (user_id, bootcamp)
);
alter table public.bootcamp_requests enable row level security;
create policy "Members see their own requests, admins all" on public.bootcamp_requests for select to authenticated
  using (public.is_member() and (user_id = (select auth.uid()) or public.my_role() = 'admin'));
create policy "Members request a bootcamp for themselves" on public.bootcamp_requests for insert to authenticated
  with check (public.is_member() and user_id = (select auth.uid()) and notified_at is null);
revoke all on public.bootcamp_requests from anon, authenticated;
grant select on public.bootcamp_requests to authenticated;
grant insert (bootcamp, title, status) on public.bootcamp_requests to authenticated;

select cron.schedule('club-bootcamp-notify', '1-59/5 * * * *', $$ select private.call_fn('bootcamp-notify') $$);
