-- Google Meet links: Club only (Self-Study and trial users see the sessions but can't join).
create or replace function public.club_meet_urls()
returns table(id text, meet_url text) language sql stable security definer set search_path = '' as $$
  select s.id, s.meet_url from public.sessions s
  where (select public.is_club()) and coalesce(s.meet_url, '') <> '' and s.starts_at > now() - interval '35 days';
$$;
grant execute on function public.club_meet_urls() to authenticated;
