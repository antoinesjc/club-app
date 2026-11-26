-- Magical Forest notice board 公告栏: the club's wins from the last 14 days, with 加油！ cheers,
-- plus short announcements pinned by hosts/admins. Members only (hosts and admins aren't posted).
-- A member can stay off the board: profiles.show_milestones = false.
alter table public.profiles add column if not exists show_milestones boolean not null default true;
grant update (show_milestones) on public.profiles to authenticated;

create table if not exists public.notices (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,  -- who it's about (or who wrote the announcement)
  kind text not null check (kind in ('tree', 'level', 'sticker', 'book', 'course', 'sessions', 'joined', 'announce')),
  key text not null default '',          -- one notice per member per kind+key (e.g. tree:30, sticker:letter)
  label text check (char_length(label) <= 200),
  until timestamptz,                     -- announcements: shown until then
  created_at timestamptz not null default now()
);
create unique index if not exists notices_once on public.notices (user_id, kind, key) where kind <> 'announce';
create index if not exists notices_recent on public.notices (created_at desc);
alter table public.notices enable row level security;
revoke all on public.notices from anon, authenticated;

create table if not exists public.notice_cheers (
  notice_id bigint not null references public.notices(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (notice_id, user_id)
);
alter table public.notice_cheers enable row level security;
revoke all on public.notice_cheers from anon, authenticated;

-- internal: add a milestone notice for a member (skips non-members and members who opted out)
create or replace function private.add_notice(p_user uuid, p_kind text, p_key text, p_label text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from auth.users u where u.id = p_user and public.access_role(u.email) = 'member') then return; end if;
  if exists (select 1 from public.profiles p where p.id = p_user and p.show_milestones = false) then return; end if;
  insert into public.notices (user_id, kind, key, label) values (p_user, p_kind, coalesce(p_key, ''), p_label) on conflict do nothing;
end $$;

-- from the app: streak-tree stage, level up, a whole book, the Oracle Bone course (the app knows these)
create or replace function public.post_notice(p_kind text, p_key text, p_label text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_kind not in ('tree', 'level', 'book', 'course') then raise exception 'not_allowed'; end if;
  perform private.add_notice(auth.uid(), p_kind, left(p_key, 60), left(p_label, 200));
end $$;

-- automatic: stickers, sessions attended (10/25/50/100), new members
create or replace function private.notice_sticker() returns trigger language plpgsql security definer set search_path = '' as $$
begin perform private.add_notice(new.user_id, 'sticker', new.sticker, new.sticker); return null; end $$;
drop trigger if exists sticker_notice on public.sticker_awards;
create trigger sticker_notice after insert on public.sticker_awards for each row execute function private.notice_sticker();

create or replace function private.notice_sessions() returns trigger language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  select count(*) into n from public.attendance a join public.sessions s on s.id = a.session_id where a.user_id = new.user_id and not s.cancelled;
  if n in (10, 25, 50, 100, 200) then perform private.add_notice(new.user_id, 'sessions', n::text, n::text); end if;
  return null;
end $$;
drop trigger if exists attendance_notice on public.attendance;
create trigger attendance_notice after insert on public.attendance for each row execute function private.notice_sessions();

create or replace function private.notice_joined() returns trigger language plpgsql security definer set search_path = '' as $$
begin perform private.add_notice(new.id, 'joined', '', null); return null; end $$;
drop trigger if exists profile_joined_notice on public.profiles;
create trigger profile_joined_notice after insert on public.profiles for each row execute function private.notice_joined();

-- the board: last 14 days (members who opted out are hidden, also retroactively) + current announcements
create or replace function public.notice_board()
returns table(id bigint, user_id uuid, name text, fruit text, kind text, key text, label text, until timestamptz, created_at timestamptz, cheers int, cheered boolean)
language sql stable security definer set search_path = '' as $$
  select n.id, n.user_id, coalesce(nullif(p.display_name, ''), 'A member'), p.fruit, n.kind, n.key, n.label, n.until, n.created_at,
    (select count(*)::int from public.notice_cheers c where c.notice_id = n.id),
    exists (select 1 from public.notice_cheers c where c.notice_id = n.id and c.user_id = auth.uid())
  from public.notices n left join public.profiles p on p.id = n.user_id
  where public.my_role() in ('member', 'host', 'admin')
    and ((n.kind = 'announce' and n.until > now()) or (n.kind <> 'announce' and n.created_at > now() - interval '14 days' and coalesce(p.show_milestones, true)))
  order by (n.kind = 'announce') desc, n.created_at desc
  limit 80;
$$;

create or replace function public.notice_cheer(p_id bigint)
returns void language sql security definer set search_path = '' as $$
  insert into public.notice_cheers (notice_id, user_id)
  select p_id, auth.uid() where public.my_role() in ('member', 'host', 'admin')
    and exists (select 1 from public.notices n where n.id = p_id and n.kind <> 'announce' and n.user_id <> auth.uid())
  on conflict do nothing;
$$;

-- cheers on my notices since a moment (for "4 people cheered you on")
create or replace function public.my_new_cheers(p_since timestamptz)
returns table(n int, names text[]) language sql stable security definer set search_path = '' as $$
  select count(*)::int, (array_agg(distinct coalesce(nullif(p.display_name, ''), 'A member')))[1:3]
  from public.notice_cheers c join public.notices n on n.id = c.notice_id left join public.profiles p on p.id = c.user_id
  where n.user_id = auth.uid() and c.created_at > p_since;
$$;

create or replace function public.notice_announce(p_text text, p_days int default 7)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if public.my_role() not in ('host', 'admin') then raise exception 'not_allowed'; end if;
  insert into public.notices (user_id, kind, key, label, until) values (auth.uid(), 'announce', '', left(btrim(p_text), 200), now() + make_interval(days => greatest(1, least(p_days, 60))));
end $$;

create or replace function public.notice_delete(p_id bigint)
returns void language sql security definer set search_path = '' as $$
  delete from public.notices where id = p_id and (public.my_role() = 'admin' or (kind = 'announce' and user_id = auth.uid()));
$$;

revoke all on function public.post_notice(text, text, text), public.notice_board(), public.notice_cheer(bigint), public.my_new_cheers(timestamptz), public.notice_announce(text, int), public.notice_delete(bigint) from public, anon;
grant execute on function public.post_notice(text, text, text), public.notice_board(), public.notice_cheer(bigint), public.my_new_cheers(timestamptz), public.notice_announce(text, int), public.notice_delete(bigint) to authenticated;
