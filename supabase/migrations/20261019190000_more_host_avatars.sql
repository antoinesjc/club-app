-- Two more host avatars: lady in a qipao, Tang dynasty lady.
create or replace function public.profiles_check_fruit()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.fruit is distinct from old.fruit then
    if new.fruit like 'host-%' then
      if new.fruit not in ('host-confucius', 'host-empress', 'host-poet', 'host-general', 'host-calligrapher',
                           'host-opera', 'host-qipao', 'host-tang') then
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

-- New hosts start with one of the eight host avatars (see start_session in 20261019180000, now with 8 options).
