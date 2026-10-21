-- 21 Oct 2026 (Antoine):
--  * Hongbao 红包: once a month, each member can give another member (not a host) a hongbao worth +30 XP.
--    The receiver gets a notification and a small animation in the app.
--  * New stickers: phone (active on Discord), heart (brought a friend), medal (#1 on a monthly leaderboard).
--  * Hosts can give stickers (XP stays admin-only).
--  * Medal sticker given automatically to last month's #1 (ties included) on the 1st of each month.

create or replace function public.sticker_ok(k text)
returns boolean
language sql
immutable
set search_path = ''
as $$ select k in ('boba', 'tones', 'lantern', 'dumpling', 'brush', 'mooncake', 'phone', 'heart', 'medal') $$;

alter policy "Admins give stickers" on public.sticker_awards with check (public.is_host());
alter policy "Admins give stickers" on public.sticker_awards rename to "Hosts give stickers";

-- Hongbaos
create table public.hongbaos (
  id          uuid primary key default gen_random_uuid(),
  giver       uuid not null references auth.users (id) on delete cascade,
  receiver    uuid not null references auth.users (id) on delete cascade,
  month       date not null,               -- first day of the month (Brussels time)
  created_at  timestamptz not null default now(),
  seen_at     timestamptz,                 -- receiver saw the animation
  notified_at timestamptz,                 -- notification sent
  unique (giver, month),
  check (giver <> receiver)
);
create index hongbaos_receiver on public.hongbaos (receiver);
alter table public.hongbaos enable row level security;
create policy "Giver, receiver and admins see a hongbao" on public.hongbaos for select to authenticated
  using (public.is_member() and (giver = (select auth.uid()) or receiver = (select auth.uid()) or public.my_role() = 'admin'));
revoke all on public.hongbaos from anon, authenticated;
grant select on public.hongbaos to authenticated;

create or replace function public.give_hongbao(p_to uuid)
returns json
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_month date := date_trunc('month', now() at time zone 'Europe/Brussels')::date;
  v_role text;
begin
  if public.my_role() is distinct from 'member' then raise exception 'Only members can give a hongbao'; end if;
  if p_to = auth.uid() then raise exception 'You can''t give a hongbao to yourself'; end if;
  select public.access_role(u.email) into v_role from auth.users u where u.id = p_to;
  if v_role is distinct from 'member' then raise exception 'Hongbaos go to members, not hosts'; end if;
  if exists (select 1 from public.hongbaos h where h.giver = auth.uid() and h.month = v_month) then
    raise exception 'You already gave your hongbao this month';
  end if;
  insert into public.hongbaos (giver, receiver, month) values (auth.uid(), p_to, v_month);
  return json_build_object('ok', true, 'month', v_month);
end;
$$;
revoke all on function public.give_hongbao(uuid) from public, anon;
grant execute on function public.give_hongbao(uuid) to authenticated;

-- Hongbaos I received, with the giver's name and avatar (even if they're hidden from the directory).
create or replace function public.hongbao_inbox()
returns table (id uuid, giver uuid, name text, fruit text, bg text, created_at timestamptz, seen_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select h.id, h.giver, p.display_name, p.fruit, p.bg, h.created_at, h.seen_at
  from public.hongbaos h left join public.profiles p on p.id = h.giver
  where h.receiver = auth.uid() and public.is_member()
  order by h.created_at desc;
$$;
revoke all on function public.hongbao_inbox() from public, anon;
grant execute on function public.hongbao_inbox() to authenticated;

create or replace function public.hongbao_seen()
returns void
language sql
volatile
security definer
set search_path = ''
as $$ update public.hongbaos set seen_at = now() where receiver = auth.uid() and seen_at is null; $$;
revoke all on function public.hongbao_seen() from public, anon;
grant execute on function public.hongbao_seen() to authenticated;

-- XP events now include hongbaos (+30 to the receiver).
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
  select x.user_id, x.points, x.kind, x.awarded_at, null from public.xp_awards x
  union all
  select h.receiver, 30, 'hongbao', h.created_at, null from public.hongbaos h;
$$;
revoke all on function public.xp_events() from public, anon, authenticated;

-- Medal sticker for last month's #1 (members only, ties included).
create or replace function public.award_monthly_medal()
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_end   timestamptz := date_trunc('month', now() at time zone 'Europe/Brussels') at time zone 'Europe/Brussels';
  v_start timestamptz := (date_trunc('month', now() at time zone 'Europe/Brussels') - interval '1 month') at time zone 'Europe/Brussels';
  v_label text := to_char((now() at time zone 'Europe/Brussels') - interval '1 month', 'FMMonth YYYY');
  v_n integer;
begin
  with sums as (
    select e.user_id, sum(e.points)::int as total
    from public.xp_events() e
    join auth.users u on u.id = e.user_id
    where e.at >= v_start and e.at < v_end and public.access_role(u.email) = 'member'
    group by e.user_id
  ), top as (
    select user_id from sums where total > 0 and total = (select max(total) from sums)
  )
  insert into public.sticker_awards (user_id, sticker, reason, awarded_by)
  select user_id, 'medal', 'Top of the leaderboard · ' || v_label, null from top
  on conflict (user_id, sticker) do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke all on function public.award_monthly_medal() from public, anon, authenticated;

select cron.schedule('club-monthly-medal', '10 0 1 * *', $$ select public.award_monthly_medal() $$);
