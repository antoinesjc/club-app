-- Two more host characters (2 Nov 2026): Mulan (woman warrior) and Qing lady.
create or replace function public.start_session()
 returns json
 language plpgsql
 security definer
 set search_path to ''
as $function$
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
    v_start := (array['host-confucius', 'host-empress', 'host-poet', 'host-general', 'host-calligrapher',
                      'host-opera', 'host-qipao', 'host-tang', 'host-mulan', 'host-qing'])[1 + floor(random() * 10)::int];
  else
    v_start := (array['orange', 'apple', 'peach'])[1 + floor(random() * 3)::int];
  end if;
  insert into public.profiles (id, display_name, fruit)
  values (auth.uid(), left(split_part(coalesce(v_name, ''), ' ', 1), 40), v_start)
  on conflict (id) do nothing;
  return json_build_object('role', v_role);
end;
$function$;

create or replace function public.profiles_check_fruit()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.fruit is distinct from old.fruit then
    if new.fruit like 'host-%' then
      if new.fruit not in ('host-confucius', 'host-empress', 'host-poet', 'host-general', 'host-calligrapher',
                           'host-opera', 'host-qipao', 'host-tang', 'host-mulan', 'host-qing') then
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
  if new.sticker is distinct from old.sticker and new.sticker is not null then
    if not public.sticker_ok(new.sticker) then
      raise exception 'Unknown sticker';
    end if;
    if not public.is_host()
       and not exists (select 1 from public.sticker_awards a where a.user_id = new.id and a.sticker = new.sticker) then
      raise exception 'This sticker is not in your collection';
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
