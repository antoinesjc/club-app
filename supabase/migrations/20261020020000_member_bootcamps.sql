-- Bootcamps joined per member (shown on member cards): one per positive "Bootcamp" XP award.
create or replace function public.member_bootcamps()
returns table (user_id uuid, bootcamps integer)
language sql
stable
security definer
set search_path = ''
as $$
  select x.user_id, count(*)::int
  from public.xp_awards x
  where public.is_member() and x.kind = 'bootcamp' and x.points > 0
  group by x.user_id;
$$;
revoke all on function public.member_bootcamps() from public, anon;
grant execute on function public.member_bootcamps() to authenticated;
