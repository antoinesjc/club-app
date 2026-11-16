-- 16 Nov 2026 (Antoine): Admin tab (desktop) → "Send a notification".
-- Admins write a message (with {name} for each person's first name), pick who gets it
-- (everyone, members, hosts or chosen people) and how (app only, app or email, app and email).
-- The admin-notify function sends it and logs it here.

create table public.admin_broadcasts (
  id          uuid primary key default gen_random_uuid(),
  title       text not null check (char_length(title) between 1 and 80),
  body        text not null check (char_length(body) between 1 and 300),
  url         text not null default '',
  audience    text not null,
  channel     text not null check (channel in ('push', 'fallback', 'both')),
  recipients  integer not null default 0,
  sent_push   integer not null default 0,
  sent_email  integer not null default 0,
  unreached   integer not null default 0,
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now()
);
alter table public.admin_broadcasts enable row level security;
create policy "Admins see sent notifications" on public.admin_broadcasts for select to authenticated
  using (public.my_role() = 'admin');
revoke all on public.admin_broadcasts from anon, authenticated;
grant select on public.admin_broadcasts to authenticated;

-- Everyone who can use the app, for the admin-notify function (service role only).
create or replace function public.admin_recipients()
returns table (user_id uuid, email text, name text, role text, allow_email boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, u.email, p.display_name, public.access_role(u.email), p.notify_email
  from public.profiles p join auth.users u on u.id = p.id
  where public.access_role(u.email) is not null;
$$;
revoke all on function public.admin_recipients() from public, anon, authenticated;
grant execute on function public.admin_recipients() to service_role;

-- Who has app notifications turned on (at least one device), so admins see the reach before sending.
create or replace function public.admin_push_reach()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$ select distinct s.user_id from public.push_subscriptions s where public.my_role() = 'admin'; $$;
revoke all on function public.admin_push_reach() from public, anon;
grant execute on function public.admin_push_reach() to authenticated;
