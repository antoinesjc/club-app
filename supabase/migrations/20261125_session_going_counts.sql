-- For the website's trial seats (Mandarin-Zest-Class-Calendar/seats.js): members who said "I'm in" per upcoming session.
-- Counts only, no names. Keys = the website's trial reference: trial-YYYY-MM-DDTHH-MM-utc. Applied 25 Nov 2026.
create or replace function public.session_going_counts()
returns json language sql stable security definer set search_path = '' as $$
  select coalesce(json_object_agg(k, n), '{}'::json) from (
    select 'trial-' || to_char(s.starts_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24-MI') || '-utc' as k, count(i.user_id) as n
    from public.sessions s join public.interests i on i.session_id = s.id
    where s.starts_at > now() - interval '1 day' and coalesce(s.cancelled, false) = false
    group by 1
  ) t;
$$;
revoke all on function public.session_going_counts() from public;
grant execute on function public.session_going_counts() to anon, authenticated;
