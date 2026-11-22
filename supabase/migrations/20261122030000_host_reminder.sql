-- Hosts get their own reminder 1 hour before each session they host ("You're hosting in 1 hour"),
-- matched like the app does: their private Google Meet name, else their display name, against the calendar's Host: line.
-- Uses the same "Session reminders" setting. A host who also said "I'm in" gets only the host reminder.
create or replace function public.notify_targets(p_kind text, p_session text)
 returns table(user_id uuid, email text, name text, timezone text, allow_email boolean)
 language sql stable security definer set search_path to ''
as $function$
  select p.id, u.email, p.display_name, p.timezone, p.notify_email
  from public.profiles p
  join auth.users u on u.id = p.id
  where public.access_role(u.email) is not null
    and case p_kind
      when 'host_reminder' then p.notify_reminders
        and public.access_role(u.email) in ('host', 'admin')
        and exists (select 1 from public.sessions s
          left join public.host_meet_names m on m.user_id = p.id and m.meet_name <> ''
          where s.id = p_session and btrim(coalesce(s.host_name, '')) <> ''
            and lower(btrim(s.host_name)) in (lower(btrim(m.meet_name)), lower(btrim(p.display_name))))
      when 'reminder' then p.notify_reminders
        and exists (select 1 from public.interests i where i.session_id = p_session and i.user_id = p.id)
        and not exists (select 1 from public.notify_log l where l.kind = 'host_reminder' and l.session_id = p_session and l.user_id = p.id)
      when 'cancelled' then p.notify_reminders
        and exists (select 1 from public.interests i where i.session_id = p_session and i.user_id = p.id)
      when 'rescheduled' then p.notify_reminders
        and exists (select 1 from public.interests i where i.session_id = p_session and i.user_id = p.id)
      when 'new_session' then p.notify_new
      when 'notes' then p.notify_notes
        and (exists (select 1 from public.attendance a where a.session_id = p_session and a.user_id = p.id)
          or exists (select 1 from public.interests i where i.session_id = p_session and i.user_id = p.id))
      else false end
    and (p_kind = 'rescheduled'
      or not exists (select 1 from public.notify_log l where l.kind = p_kind and l.session_id = p_session and l.user_id = p.id));
$function$;
