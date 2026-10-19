-- Phase 3: XP, levels, fruit unlocks, leaderboard.
-- XP rules (Antoine, 19 Oct 2026):
--   +20  each session a host ticked you as present
--   +50  every 4 weeks in a row with at least one session (weeks 4, 8, 12, ...; Monday-Sunday, Brussels time)
--   +150 per bootcamp, and any other bonus: given by an admin (xp_awards)
-- Levels and fruit levels must match fruits.js in the app.

create table public.xp_awards (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  points     integer not null check (points between -2000 and 2000 and points <> 0),
  kind       text not null default 'bonus' check (kind in ('bootcamp', 'bonus')),
  reason     text not null default '' check (char_length(reason) <= 120),
  awarded_at timestamptz not null default now(),
  awarded_by uuid references auth.users (id) on delete set null default auth.uid()
);
create index xp_awards_user on public.xp_awards (user_id);
alter table public.xp_awards enable row level security;

create policy "Own awards; admins see all" on public.xp_awards for select to authenticated
  using (public.is_member() and (user_id = (select auth.uid()) or public.my_role() = 'admin'));
create policy "Admins give XP" on public.xp_awards for insert to authenticated
  with check (public.my_role() = 'admin');
create policy "Admins take back XP" on public.xp_awards for delete to authenticated
  using (public.my_role() = 'admin');
revoke all on public.xp_awards from anon, authenticated;
grant select, insert, delete on public.xp_awards to authenticated;

-- Every XP event, for everyone (internal).
create or replace function public.xp_events()
returns table (user_id uuid, points integer, kind text, at timestamptz, session_id text)
language sql
stable
security definer
set search_path = ''
as $$
  with att as (
    select a.user_id, s.id as session_id, s.starts_at
    from public.attendance a join public.sessions s on s.id = a.session_id
    where not s.cancelled
  ),
  weeks as (
    select distinct att.user_id, date_trunc('week', att.starts_at at time zone 'Europe/Brussels')::date as wk from att
  ),
  islands as (
    select w.user_id, w.wk,
      (w.wk - date '2000-01-03') / 7 - row_number() over (partition by w.user_id order by w.wk) as grp
    from weeks w
  ),
  runs as (
    select i.user_id, i.wk, row_number() over (partition by i.user_id, i.grp order by i.wk) as rn from islands i
  )
  select att.user_id, 20, 'session', att.starts_at, att.session_id from att
  union all
  select r.user_id, 50, 'streak', (r.wk::timestamp at time zone 'Europe/Brussels'), null from runs r where r.rn % 4 = 0
  union all
  select x.user_id, x.points, x.kind, x.awarded_at, null from public.xp_awards x;
$$;
revoke all on function public.xp_events() from public, anon, authenticated;

create or replace function public.xp_level(p_total integer)
returns integer
language sql
immutable
set search_path = ''
as $$
  select count(*)::int from unnest(array[0, 50, 120, 220, 350, 500, 700, 950, 1250, 1600,
    2000, 2500, 3100, 3800, 4600, 5500, 6500, 7700]) t where t <= greatest(p_total, 0);
$$;

create or replace function public.fruit_level(p_fruit text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case p_fruit
    when 'orange' then 1 when 'apple' then 1 when 'peach' then 1
    when 'strawberry' then 2 when 'lemon' then 3 when 'mango' then 4 when 'watermelon' then 5
    when 'pineapple' then 6 when 'kiwi' then 7 when 'cherry' then 8 when 'coconut' then 9
    when 'dragonfruit' then 10 when 'lychee' then 11 when 'pomelo' then 12 when 'starfruit' then 13
    when 'guava' then 14 when 'passionfruit' then 15 when 'persimmon' then 16 when 'rambutan' then 17
    when 'durian' then 18 else 99 end;
$$;

create or replace function public.user_xp(p_user uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(e.points), 0)::int from public.xp_events() e where e.user_id = p_user;
$$;
revoke all on function public.user_xp(uuid) from public, anon;
grant execute on function public.user_xp(uuid) to authenticated;

-- Leaderboard: members only (hosts and admins don't earn XP). Hidden-from-directory
-- members still appear, as promised in the app.
create or replace function public.xp_board()
returns table (user_id uuid, name text, fruit text, bg text, country text, total integer, month integer, level integer)
language sql
stable
security definer
set search_path = ''
as $$
  with ev as (select * from public.xp_events()),
  sums as (
    select e.user_id,
      sum(e.points)::int as total,
      coalesce(sum(e.points) filter (where e.at >= (date_trunc('month', now() at time zone 'Europe/Brussels') at time zone 'Europe/Brussels')), 0)::int as month
    from ev e group by e.user_id
  )
  select p.id, p.display_name, p.fruit, p.bg, p.country,
    coalesce(s.total, 0), coalesce(s.month, 0), public.xp_level(coalesce(s.total, 0))
  from public.profiles p
  join auth.users u on u.id = p.id
  left join sums s on s.user_id = p.id
  where public.is_member() and public.access_role(u.email) = 'member';
$$;
revoke all on function public.xp_board() from public, anon;
grant execute on function public.xp_board() to authenticated;

-- Fruit picker: a fruit is yours once your level reaches it. Hosts and admins have them all.
create or replace function public.profiles_check_fruit()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.fruit is distinct from old.fruit then
    if public.fruit_level(new.fruit) = 99 then
      raise exception 'Unknown fruit';
    end if;
    if not public.is_host()
       and public.fruit_level(new.fruit) > public.xp_level(public.user_xp(new.id)) then
      raise exception 'This fruit is still locked';
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
