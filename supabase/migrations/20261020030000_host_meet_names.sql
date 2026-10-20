-- Hosts' "Name you use on Google Meet" (Antoine, 20 Oct 2026). Private: only the host can read it.
-- Used to find which host runs a session (the calendar's "Host:" line), to show their avatar on the next session.
create table public.host_meet_names (
  user_id    uuid primary key references auth.users (id) on delete cascade default auth.uid(),
  meet_name  text not null default '' check (char_length(meet_name) <= 60),
  updated_at timestamptz not null default now()
);
alter table public.host_meet_names enable row level security;
create policy "Hosts read their own" on public.host_meet_names for select to authenticated
  using (user_id = (select auth.uid()));
create policy "Hosts add their own" on public.host_meet_names for insert to authenticated
  with check (user_id = (select auth.uid()) and public.is_host());
create policy "Hosts change their own" on public.host_meet_names for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()) and public.is_host());
revoke all on public.host_meet_names from anon, authenticated;
grant select, insert, update on public.host_meet_names to authenticated;

-- Which host runs each upcoming session, matched on the Google Meet name (names themselves stay private).
create or replace function public.session_hosts()
returns table (session_id text, host_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id::text, m.user_id
  from public.sessions s
  join public.host_meet_names m
    on m.meet_name <> '' and lower(btrim(m.meet_name)) = lower(btrim(s.host_name))
  join auth.users u on u.id = m.user_id
  where public.is_member() and s.starts_at > now() - interval '1 day'
    and public.access_role(u.email) in ('host', 'admin');
$$;
revoke all on function public.session_hosts() from public, anon;
grant execute on function public.session_hosts() to authenticated;
