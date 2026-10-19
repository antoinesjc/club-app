-- Phase 2: attendance, session notes, files, notifications.

-- ---------------------------------------------------------------------------
-- Attendance (ticked by hosts)
-- ---------------------------------------------------------------------------
create table public.attendance (
  session_id text not null references public.sessions (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  marked_by  uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  primary key (session_id, user_id)
);
create index attendance_user on public.attendance (user_id);
alter table public.attendance enable row level security;

create policy "Members see their own attendance, hosts see all"
  on public.attendance for select to authenticated
  using (public.is_member() and (user_id = (select auth.uid()) or public.is_host()));
create policy "Hosts tick attendance"
  on public.attendance for insert to authenticated
  with check (public.is_host());
create policy "Hosts untick attendance"
  on public.attendance for delete to authenticated
  using (public.is_host());

-- Who may read a session's notes: hosts, people who came, people who said "I'm in".
create or replace function public.can_read_notes(p_session text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_member() and (
    public.is_host()
    or exists (select 1 from public.attendance a where a.session_id = p_session and a.user_id = auth.uid())
    or exists (select 1 from public.interests i where i.session_id = p_session and i.user_id = auth.uid())
  );
$$;
revoke all on function public.can_read_notes(text) from public, anon;
grant execute on function public.can_read_notes(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Session notes
-- ---------------------------------------------------------------------------
create table public.session_notes (
  session_id   text primary key references public.sessions (id) on delete cascade,
  vocab        jsonb not null default '[]'::jsonb check (jsonb_typeof(vocab) = 'array'),
  body         text not null default '' check (char_length(body) <= 20000),
  published_at timestamptz,
  updated_by   uuid references auth.users (id) on delete set null default auth.uid(),
  updated_at   timestamptz not null default now()
);
alter table public.session_notes enable row level security;

create policy "Published notes for those who may read them; hosts see drafts"
  on public.session_notes for select to authenticated
  using (public.is_host() or (published_at is not null and public.can_read_notes(session_id)));
create policy "Hosts write notes"
  on public.session_notes for insert to authenticated
  with check (public.is_host());
create policy "Hosts edit notes"
  on public.session_notes for update to authenticated
  using (public.is_host()) with check (public.is_host());

create or replace function public.session_notes_touch()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;
create trigger session_notes_touch before update on public.session_notes
  for each row execute function public.session_notes_touch();

-- Attachments (files live in the private "session-files" bucket)
create table public.note_files (
  id          uuid primary key default gen_random_uuid(),
  session_id  text not null references public.sessions (id) on delete cascade,
  path        text not null unique,
  name        text not null check (char_length(name) <= 200),
  size        bigint not null default 0,
  created_by  uuid references auth.users (id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now()
);
create index note_files_session on public.note_files (session_id);
alter table public.note_files enable row level security;

create policy "Files of notes you may read"
  on public.note_files for select to authenticated
  using (public.is_host() or (public.can_read_notes(session_id)
         and exists (select 1 from public.session_notes n where n.session_id = note_files.session_id and n.published_at is not null)));
create policy "Hosts add files" on public.note_files for insert to authenticated with check (public.is_host());
create policy "Hosts remove files" on public.note_files for delete to authenticated using (public.is_host());

insert into storage.buckets (id, name, public, file_size_limit)
values ('session-files', 'session-files', false, 20971520)
on conflict (id) do nothing;

create policy "Hosts upload session files"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'session-files' and public.is_host());
create policy "Hosts delete session files"
  on storage.objects for delete to authenticated
  using (bucket_id = 'session-files' and public.is_host());
create policy "Read session files you may see"
  on storage.objects for select to authenticated
  using (bucket_id = 'session-files' and exists (
    select 1 from public.note_files f where f.path = storage.objects.name
      and (public.is_host() or public.can_read_notes(f.session_id))));

-- ---------------------------------------------------------------------------
-- Notifications
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column notify_reminders boolean not null default true,
  add column notify_new       boolean not null default true,
  add column notify_notes     boolean not null default true,
  add column notify_email     boolean not null default true,
  add column timezone         text not null default '' check (char_length(timezone) <= 64);

grant update (notify_reminders, notify_new, notify_notes, notify_email, timezone)
  on public.profiles to authenticated;

create table public.push_subscriptions (
  endpoint   text primary key,
  user_id    uuid not null references auth.users (id) on delete cascade default auth.uid(),
  p256dh     text not null,
  auth       text not null,
  user_agent text not null default '',
  created_at timestamptz not null default now(),
  last_ok_at timestamptz
);
create index push_subscriptions_user on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;
create policy "Own devices" on public.push_subscriptions for select to authenticated using (user_id = (select auth.uid()));
create policy "Add own device" on public.push_subscriptions for insert to authenticated
  with check (user_id = (select auth.uid()) and public.is_member());
create policy "Update own device" on public.push_subscriptions for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "Remove own device" on public.push_subscriptions for delete to authenticated using (user_id = (select auth.uid()));

-- Work for the notify job, and what was already sent (never twice).
create table public.notify_outbox (
  id         bigserial primary key,
  kind       text not null check (kind in ('new_session', 'notes')),
  session_id text not null references public.sessions (id) on delete cascade,
  created_at timestamptz not null default now(),
  done_at    timestamptz
);
create table public.notify_log (
  kind       text not null,
  session_id text not null,
  user_id    uuid not null references auth.users (id) on delete cascade,
  channel    text not null,
  sent_at    timestamptz not null default now(),
  primary key (kind, session_id, user_id)
);
-- Calendar series already seen, so only genuinely new sessions are announced.
create table public.known_series (
  uid        text primary key,
  first_seen timestamptz not null default now()
);
alter table public.notify_outbox enable row level security;
alter table public.notify_log enable row level security;
alter table public.known_series enable row level security;

insert into public.known_series (uid)
select distinct split_part(id, '|', 1) from public.sessions
on conflict do nothing;

-- Host presses "Publish": notes become visible; the first publish notifies.
create or replace function public.publish_notes(p_session text)
returns json
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_was timestamptz;
begin
  if not public.is_host() then raise exception 'Hosts only'; end if;
  insert into public.session_notes (session_id) values (p_session) on conflict (session_id) do nothing;
  select published_at into v_was from public.session_notes where session_id = p_session;
  update public.session_notes set published_at = coalesce(published_at, now()) where session_id = p_session;
  if v_was is null then
    insert into public.notify_outbox (kind, session_id) values ('notes', p_session);
  end if;
  return json_build_object('first', v_was is null);
end;
$$;
revoke all on function public.publish_notes(text) from public, anon;
grant execute on function public.publish_notes(text) to authenticated;

-- Who should hear about something (service role only).
create or replace function public.notify_targets(p_kind text, p_session text)
returns table (user_id uuid, email text, name text, timezone text, allow_email boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, u.email, p.display_name, p.timezone, p.notify_email
  from public.profiles p
  join auth.users u on u.id = p.id
  where public.access_role(u.email) is not null
    and case p_kind
      when 'reminder' then p.notify_reminders
        and exists (select 1 from public.interests i where i.session_id = p_session and i.user_id = p.id)
      when 'new_session' then p.notify_new
      when 'notes' then p.notify_notes
        and (exists (select 1 from public.attendance a where a.session_id = p_session and a.user_id = p.id)
          or exists (select 1 from public.interests i where i.session_id = p_session and i.user_id = p.id))
      else false end
    and not exists (select 1 from public.notify_log l where l.kind = p_kind and l.session_id = p_session and l.user_id = p.id);
$$;
revoke all on function public.notify_targets(text, text) from public, anon, authenticated;
grant execute on function public.notify_targets(text, text) to service_role;

-- Privileges
revoke all on public.attendance, public.session_notes, public.note_files, public.push_subscriptions,
  public.notify_outbox, public.notify_log, public.known_series from anon, authenticated;
grant select, insert, delete on public.attendance to authenticated;
grant select, insert, update on public.session_notes to authenticated;
grant select, insert, delete on public.note_files to authenticated;
grant select, insert, update, delete on public.push_subscriptions to authenticated;

-- Notify job every 5 minutes.
select cron.schedule('club-notify', '*/5 * * * *', $$ select private.call_sync('notify') $$);
