-- Members map now includes hosts (shown as "Name (host)" in the app).
create or replace function public.country_counts()
returns table (country text, members integer)
language sql
stable
security definer
set search_path = ''
as $$
  select p.country, count(*)::int
  from public.profiles p
  join auth.users u on u.id = p.id
  where public.is_member() and p.country is not null and p.country <> ''
    and public.access_role(u.email) in ('member', 'host', 'admin')
  group by p.country;
$$;
