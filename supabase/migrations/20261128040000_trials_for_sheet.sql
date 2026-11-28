-- Free trials for the "Free trials" tab of the Club members sheet (Apps Script, through trials-export).
-- Lists trial users who haven't moved to a paid plan yet (running or ended). Once someone pays (Stripe, any plan)
-- or is added by hand, they leave this list; Stripe payers then appear in the Members tab ("via Stripe").
create or replace function public.trials_for_sheet()
returns table(email text, name text, started_at timestamptz, ends_at timestamptz, status text, last_opened timestamptz)
language sql stable security definer set search_path = '' as $$
  select t.email, coalesce(nullif(p.display_name, ''), split_part(t.email, '@', 1)), t.started_at, t.started_at + interval '7 days',
    case when t.started_at > now() - interval '7 days' then 'running' else 'ended' end,
    (select max(e.at) from public.app_events e where e.user_id = t.user_id and e.kind = 'open')
  from public.trials t
  left join public.profiles p on p.id = t.user_id
  where not exists (select 1 from public.members_stripe s where s.email = t.email and s.active and (s.member_until is null or s.member_until > now()))
    and not exists (select 1 from public.members_manual m where m.email = t.email and m.status = 'active')
  order by t.started_at desc;
$$;
revoke all on function public.trials_for_sheet() from public, anon, authenticated;
