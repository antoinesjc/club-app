-- Stickers (Antoine, 20 Oct 2026): a bootcamp can unlock a sticker (e.g. Taiwanese Mini Bootcamp -> bubble tea).
-- Admins give stickers; members wear one at the bottom-left of their avatar.
-- Members only see stickers they've collected; hosts and admins see and can wear all of them.
-- Keys must match stickers.js in the app.

create or replace function public.sticker_ok(k text)
returns boolean
language sql
immutable
set search_path = ''
as $$ select k in ('boba', 'tones', 'lantern', 'dumpling', 'brush', 'mooncake') $$;

create table public.sticker_awards (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  sticker    text not null check (public.sticker_ok(sticker)),
  reason     text not null default '' check (char_length(reason) <= 120),
  awarded_at timestamptz not null default now(),
  awarded_by uuid references auth.users (id) on delete set null default auth.uid(),
  unique (user_id, sticker)
);
create index sticker_awards_user on public.sticker_awards (user_id);
alter table public.sticker_awards enable row level security;

create policy "Members see collected stickers" on public.sticker_awards for select to authenticated
  using (public.is_member());
create policy "Admins give stickers" on public.sticker_awards for insert to authenticated
  with check (public.my_role() = 'admin');
create policy "Admins take back stickers" on public.sticker_awards for delete to authenticated
  using (public.my_role() = 'admin');
revoke all on public.sticker_awards from anon, authenticated;
grant select, insert, delete on public.sticker_awards to authenticated;

alter table public.profiles add column sticker text;

-- Avatar checks (fruit + sticker).
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

-- Taking a sticker back also takes it off the avatar.
create or replace function public.sticker_award_removed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles p set sticker = null
  where p.id = old.user_id and p.sticker = old.sticker
    and public.access_role((select u.email from auth.users u where u.id = old.user_id)) = 'member';
  return old;
end;
$$;
revoke all on function public.sticker_award_removed() from public, anon, authenticated;
create trigger sticker_award_removed after delete on public.sticker_awards
  for each row execute function public.sticker_award_removed();

-- Stickers worn by members, for avatars on the leaderboard (members hidden from the directory included).
create or replace function public.board_stickers()
returns table (user_id uuid, sticker text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.sticker from public.profiles p
  where public.is_member() and p.sticker is not null;
$$;
revoke all on function public.board_stickers() from public, anon;
grant execute on function public.board_stickers() to authenticated;

-- Members can change which sticker they wear (the trigger checks it's in their collection).
grant update (sticker) on public.profiles to authenticated;
