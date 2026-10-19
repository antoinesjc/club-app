-- Mandarin Zest Club app, phase 1
-- Who can log in, member profiles, sessions from Google Calendar, "I'm in".

-- ---------------------------------------------------------------------------
-- Access lists (filled by the Edge Functions, never by the app)
-- ---------------------------------------------------------------------------

-- Rows from the "Members" tab of the Google Sheet (edited by hand).
create table public.members_manual (
  email      text primary key check (email = lower(email)),
  name       text not null default '',
  role       text not null default 'member' check (role in ('member', 'host', 'admin')),
  status     text not null default 'active' check (status in ('active', 'blocked')),
  note       text not null default '',
  synced_at  timestamptz not null default now()
);

-- Paying members found in Stripe.
create table public.members_stripe (
  email        text primary key check (email = lower(email)),
  name         text not null default '',
  plan         text not null check (plan in ('monthly', 'yearly')),
  member_until timestamptz,          -- yearly: end of paid year; monthly: end of current period
  active       boolean not null default false,
  customer_id  text,
  checked_at   timestamptz not null default now()
);

alter table public.members_manual enable row level security;
alter table public.members_stripe enable row level security;
-- No policies: only the service role (Edge Functions) can read or write them.

-- Role of an email if that person may use the app, otherwise null.
create or replace function public.access_role(p_email text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  with m as (select * from public.members_manual where email = lower(p_email)),
       s as (select * from public.members_stripe where email = lower(p_email))
  select case
    when exists (select 1 from m where status = 'blocked') then null
    when exists (select 1 from m where status = 'active') then (select role from m)
    when exists (select 1 from s where active and (member_until is null or member_until > now())) then 'member'
    else null
  end;
$$;

revoke all on function public.access_role(text) from public, anon, authenticated;

-- Role of the logged-in user (null = not allowed).
create or replace function public.my_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select public.access_role(coalesce(auth.jwt() ->> 'email', ''));
$$;

create or replace function public.is_member()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.my_role() is not null;
$$;

create or replace function public.is_host()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.my_role() in ('host', 'admin');
$$;

revoke all on function public.my_role(), public.is_member(), public.is_host() from public, anon;
grant execute on function public.my_role(), public.is_member(), public.is_host() to authenticated;

-- ---------------------------------------------------------------------------
-- Profiles
-- ---------------------------------------------------------------------------

create table public.profiles (
  id                uuid primary key references auth.users (id) on delete cascade,
  display_name      text not null default '' check (char_length(display_name) <= 40),
  fruit             text not null default 'orange',
  bg                text not null default '#fdf1ea' check (bg ~ '^#[0-9a-fA-F]{6}$'),
  country           text not null default '' check (country ~ '^([a-z]{2})?$'),
  chinese_level     text not null default '' check (char_length(chinese_level) <= 20),
  discord           text not null default '' check (char_length(discord) <= 40),
  show_in_directory boolean not null default true,
  script            text not null default 'simplified' check (script in ('simplified', 'traditional')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "Members see visible profiles, their own, and hosts see all"
  on public.profiles for select to authenticated
  using (public.is_member() and (show_in_directory or id = (select auth.uid()) or public.is_host()));

create policy "Members edit their own profile"
  on public.profiles for update to authenticated
  using (id = (select auth.uid()) and public.is_member())
  with check (id = (select auth.uid()));

-- Role shown next to names (host badge). Members only.
create or replace function public.member_roles()
returns table (id uuid, role text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, public.access_role(u.email)
  from public.profiles p
  join auth.users u on u.id = p.id
  where public.is_member()
    and public.access_role(u.email) is not null;
$$;

revoke all on function public.member_roles() from public, anon;
grant execute on function public.member_roles() to authenticated;

-- Called by the app right after login: creates the profile on first login,
-- returns the role (null = not a member).
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
begin
  if v_role is null or auth.uid() is null then
    return json_build_object('role', null);
  end if;
  select coalesce(nullif(m.name, ''), nullif(s.name, ''), split_part(v_email, '@', 1))
    into v_name
    from (select 1) x
    left join public.members_manual m on m.email = v_email
    left join public.members_stripe s on s.email = v_email;
  insert into public.profiles (id, display_name, fruit)
  values (auth.uid(), left(split_part(coalesce(v_name, ''), ' ', 1), 40),
          (array['orange', 'apple', 'peach'])[1 + floor(random() * 3)::int])
  on conflict (id) do nothing;
  return json_build_object('role', v_role);
end;
$$;

revoke all on function public.start_session() from public, anon;
grant execute on function public.start_session() to authenticated;

-- Fruits a member may pick. Phase 1: the level-1 fruits only (XP comes in phase 3).
create or replace function public.profiles_check_fruit()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.fruit not in ('orange', 'apple', 'peach') and new.fruit is distinct from old.fruit then
    raise exception 'This fruit is still locked';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_check_fruit
  before update on public.profiles
  for each row execute function public.profiles_check_fruit();

-- ---------------------------------------------------------------------------
-- Sessions (from Google Calendar) and "I'm in"
-- ---------------------------------------------------------------------------

create table public.sessions (
  id          text primary key,              -- calendar UID + start time
  title       text not null,
  level       text not null default '',
  category    text not null default 'general',
  starts_at   timestamptz not null,
  ends_at     timestamptz,
  topic       text not null default '',
  about       text not null default '',
  host_name   text not null default '',
  meet_url    text not null default '',
  cancelled   boolean not null default false,
  synced_at   timestamptz not null default now()
);

create index sessions_starts_at on public.sessions (starts_at);

alter table public.sessions enable row level security;

create policy "Members see sessions"
  on public.sessions for select to authenticated
  using (public.is_member());

create table public.interests (
  session_id text not null references public.sessions (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade default auth.uid(),
  created_at timestamptz not null default now(),
  primary key (session_id, user_id)
);

create index interests_user on public.interests (user_id);

alter table public.interests enable row level security;

create policy "Members see who is in"
  on public.interests for select to authenticated
  using (public.is_member());

create policy "Members say they're in"
  on public.interests for insert to authenticated
  with check (user_id = (select auth.uid()) and public.is_member()
              and exists (select 1 from public.sessions s
                          where s.id = session_id and s.starts_at > now() - interval '1 hour'));

create policy "Members take it back"
  on public.interests for delete to authenticated
  using (user_id = (select auth.uid()));

-- Table privileges (RLS still applies on top).
revoke all on public.members_manual, public.members_stripe from anon, authenticated;
revoke all on public.profiles, public.sessions, public.interests from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (display_name, fruit, bg, country, chinese_level, discord, show_in_directory, script)
  on public.profiles to authenticated;
grant select on public.sessions to authenticated;
grant select, insert, delete on public.interests to authenticated;
