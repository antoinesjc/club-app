-- Short bio, host-only illustrated avatars, and session counts for member cards.

alter table public.profiles
  add column bio text not null default '' check (char_length(bio) <= 140);
grant update (bio) on public.profiles to authenticated;

-- Host illustrations ("host-..." keys) are for hosts and admins only.
create or replace function public.profiles_check_fruit()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.fruit is distinct from old.fruit then
    if new.fruit like 'host-%' then
      if new.fruit not in ('host-confucius', 'host-empress', 'host-poet', 'host-general', 'host-calligrapher', 'host-opera') then
        raise exception 'Unknown avatar';
      end if;
      if not public.is_host() then
        raise exception 'This avatar is for hosts';
      end if;
    else
      if public.fruit_level(new.fruit) = 99 then
        raise exception 'Unknown fruit';
      end if;
      if not public.is_host()
         and public.fruit_level(new.fruit) > public.xp_level(public.user_xp(new.id)) then
        raise exception 'This fruit is still locked';
      end if;
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

-- Sessions each person was ticked present for (shown on member cards).
create or replace function public.member_stats()
returns table (user_id uuid, sessions integer)
language sql
stable
security definer
set search_path = ''
as $$
  select a.user_id, count(*)::int
  from public.attendance a
  join public.sessions s on s.id = a.session_id and not s.cancelled
  where public.is_member()
  group by a.user_id;
$$;
revoke all on function public.member_stats() from public, anon;
grant execute on function public.member_stats() to authenticated;

-- New hosts start with a host illustration instead of a fruit.
create or replace function public.start_session()
returns json
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_role  text := public.my_role();
  v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_name  text;
  v_start text;
begin
  if v_role is null or auth.uid() is null then
    return json_build_object('role', null);
  end if;
  select coalesce(nullif(m.name, ''), nullif(s.name, ''), split_part(v_email, '@', 1))
    into v_name
    from (select 1) x
    left join public.members_manual m on m.email = v_email
    left join public.members_stripe s on s.email = v_email;
  if v_role in ('host', 'admin') then
    v_start := (array['host-confucius', 'host-empress', 'host-poet', 'host-general', 'host-calligrapher', 'host-opera'])[1 + floor(random() * 6)::int];
  else
    v_start := (array['orange', 'apple', 'peach'])[1 + floor(random() * 3)::int];
  end if;
  insert into public.profiles (id, display_name, fruit)
  values (auth.uid(), left(split_part(coalesce(v_name, ''), ' ', 1), 40), v_start)
  on conflict (id) do nothing;
  return json_build_object('role', v_role);
end;
$$;
