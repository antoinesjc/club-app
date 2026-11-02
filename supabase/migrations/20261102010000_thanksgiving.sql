-- Thanksgiving special (2 Nov 2026): corn special avatar + turkey sticker, unlocked by opening the app
-- between 25 and 30 November (Taiwan time). Special avatars are recorded in avatar_awards.
create or replace function public.sticker_ok(k text)
returns boolean
language sql
immutable
set search_path = ''
as $$ select k in ('boba', 'tones', 'lantern', 'dumpling', 'brush', 'mooncake', 'phone', 'heart', 'medal', 'founder', 'turkey') $$;

create or replace function public.special_avatar_ok(k text)
returns boolean
language sql
immutable
set search_path = ''
as $$ select k in ('corn') $$;

create table public.avatar_awards (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  avatar     text not null check (public.special_avatar_ok(avatar)),
  reason     text not null default '' check (char_length(reason) <= 120),
  awarded_at timestamptz not null default now(),
  unique (user_id, avatar)
);
alter table public.avatar_awards enable row level security;
create policy "Members see special avatars" on public.avatar_awards for select to authenticated using (public.is_member());
create policy "Hosts give special avatars" on public.avatar_awards for insert to authenticated with check (public.is_host());
create policy "Admins take back special avatars" on public.avatar_awards for delete to authenticated using (public.my_role() = 'admin');
revoke all on public.avatar_awards from anon, authenticated;
grant select, insert, delete on public.avatar_awards to authenticated;

-- Opening the app during a seasonal window unlocks its items (safe to call on every app start).
create or replace function public.claim_seasonal()
returns json
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  t timestamp := now() at time zone 'Asia/Taipei';
  v_new int := 0;
  n int;
begin
  if auth.uid() is null or not public.is_member() then return json_build_object('new', 0); end if;
  if extract(month from t) = 11 and extract(day from t) between 25 and 30 then
    insert into public.sticker_awards (user_id, sticker, reason, awarded_by)
      values (auth.uid(), 'turkey', 'Opened the app for Thanksgiving ' || extract(year from t)::int, null)
      on conflict (user_id, sticker) do nothing;
    get diagnostics n = row_count; v_new := v_new + n;
    insert into public.avatar_awards (user_id, avatar, reason)
      values (auth.uid(), 'corn', 'Opened the app for Thanksgiving ' || extract(year from t)::int)
      on conflict (user_id, avatar) do nothing;
    get diagnostics n = row_count; v_new := v_new + n;
    return json_build_object('new', v_new, 'event', 'thanksgiving');
  end if;
  return json_build_object('new', 0);
end;
$$;
revoke all on function public.claim_seasonal() from public, anon;
grant execute on function public.claim_seasonal() to authenticated;

-- Avatar checks: fruits by level, host characters for hosts, special avatars once awarded (hosts have all).
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
    elsif public.special_avatar_ok(new.fruit) then
      if not public.is_host()
         and not exists (select 1 from public.avatar_awards a where a.user_id = new.id and a.avatar = new.fruit) then
        raise exception 'This special avatar is not unlocked';
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
