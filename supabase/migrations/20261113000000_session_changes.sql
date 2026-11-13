-- 13 Nov 2026 (Antoine): tell members who said "I'm in" when a session is cancelled
-- (taken off the Google Calendar) or rescheduled (moved to another time).
-- The calendar sync records the change here; the notify job (every 5 min) sends it
-- (Web Push, email fallback), using the "Session reminders" setting.

create table public.session_changes (
  id            bigserial primary key,
  kind          text not null check (kind in ('cancelled', 'rescheduled')),
  session_id    text not null references public.sessions (id) on delete cascade,
  old_starts_at timestamptz,
  created_at    timestamptz not null default now(),
  done_at       timestamptz
);
alter table public.session_changes enable row level security;
revoke all on public.session_changes from anon, authenticated;

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
      when 'cancelled' then p.notify_reminders
        and exists (select 1 from public.interests i where i.session_id = p_session and i.user_id = p.id)
      when 'rescheduled' then p.notify_reminders
        and exists (select 1 from public.interests i where i.session_id = p_session and i.user_id = p.id)
      when 'new_session' then p.notify_new
      when 'notes' then p.notify_notes
        and (exists (select 1 from public.attendance a where a.session_id = p_session and a.user_id = p.id)
          or exists (select 1 from public.interests i where i.session_id = p_session and i.user_id = p.id))
      else false end
    -- A session can be moved more than once, so "rescheduled" isn't limited to one message.
    and (p_kind = 'rescheduled'
      or not exists (select 1 from public.notify_log l where l.kind = p_kind and l.session_id = p_session and l.user_id = p.id));
$$;
