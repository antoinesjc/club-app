-- Qilin 麒麟 challenges in Zest Town: one daily (+1 XP), weekly (+2) and monthly (+5) challenge, the same for everyone.
-- The challenge lists live in app.js (QL_DAILY / QL_WEEKLY / QL_MONTHLY). Progress comes from town_log
-- (what a member did in town, per local day) and the streak-tree days. Members tap Claim; unclaimed XP is lost.

-- What a member did in Zest Town, counted per local day and kind (e.g. fc_review, cg_write, visit:library, letterto:<id>).
create table if not exists public.town_log (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  day date not null,
  kind text not null check (char_length(kind) between 1 and 80),
  n int not null default 0,
  primary key (user_id, day, kind)
);
alter table public.town_log enable row level security;
drop policy if exists "own town log" on public.town_log;
create policy "own town log" on public.town_log for select to authenticated using (user_id = auth.uid());
revoke all on public.town_log from anon, authenticated;
grant select on public.town_log to authenticated;

create or replace function public.town_log_add(p_day date, p_kind text, p_n int default 1)
returns void language sql security definer set search_path = '' as $$
  insert into public.town_log (user_id, day, kind, n)
  select auth.uid(), p_day, p_kind, greatest(1, least(coalesce(p_n, 1), 500))
  where auth.uid() is not null and p_day between current_date - 2 and current_date + 2
  on conflict (user_id, day, kind) do update set n = public.town_log.n + excluded.n;
$$;

create table if not exists public.qilin_claims (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  period text not null check (period in ('day', 'week', 'month')),
  period_key text not null,
  challenge text not null,
  xp int not null,
  claimed_at timestamptz not null default now(),
  primary key (user_id, period, period_key)
);
alter table public.qilin_claims enable row level security;
drop policy if exists "own qilin claims" on public.qilin_claims;
create policy "own qilin claims" on public.qilin_claims for select to authenticated using (user_id = auth.uid());
revoke all on public.qilin_claims from anon, authenticated;
grant select on public.qilin_claims to authenticated;

-- Claim: only the current day / week (Monday) / month, give or take the member's time zone.
create or replace function public.qilin_claim(p_period text, p_key text, p_challenge text)
returns int language plpgsql security definer set search_path = '' as $$
declare v_xp int := case p_period when 'day' then 1 when 'week' then 2 when 'month' then 5 end; d date;
begin
  if v_xp is null or public.my_role() not in ('member', 'admin') then raise exception 'not_allowed'; end if;
  if p_period = 'month' then d := to_date(p_key || '-01', 'YYYY-MM-DD'); else d := p_key::date; end if;
  if (p_period = 'day' and d not between current_date - 1 and current_date + 1)
     or (p_period = 'week' and (extract(isodow from d) <> 1 or current_date not between d - 1 and d + 7))
     or (p_period = 'month' and current_date not between d - 1 and (d + interval '1 month')::date)
    then raise exception 'period_over'; end if;
  insert into public.qilin_claims (user_id, period, period_key, challenge, xp) values (auth.uid(), p_period, p_key, left(p_challenge, 60), v_xp)
  on conflict do nothing;
  if not found then raise exception 'already_claimed'; end if;
  return v_xp;
end $$;

revoke all on function public.town_log_add(date, text, int), public.qilin_claim(text, text, text) from public, anon;
grant execute on function public.town_log_add(date, text, int), public.qilin_claim(text, text, text) to authenticated;

-- Qilin XP counts like any other XP.
CREATE OR REPLACE FUNCTION public.xp_events()
 RETURNS TABLE(user_id uuid, points integer, kind text, at timestamp with time zone, session_id text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  ),
  tdays as (select * from public.tree_days()),
  tisl as (select t.user_id, t.d, t.d - (row_number() over (partition by t.user_id order by t.d))::int as grp from tdays t),
  truns as (select t.user_id, t.d, row_number() over (partition by t.user_id, t.grp order by t.d) as rn from tisl t)
  select att.user_id, 20, 'session', att.starts_at, att.session_id from att
  union all
  select r.user_id, 50, 'streak', (r.wk::timestamp at time zone 'Europe/Brussels'), null from runs r where r.rn % 4 = 0
  union all
  select x.user_id, x.points, x.kind, x.awarded_at, null from public.xp_awards x
  union all
  select h.receiver, 30, 'hongbao', h.created_at, null from public.hongbaos h
  union all
  select l.user_id, 1, 'game', l.created_at, null from public.learn_days l where l.kind = 'game' and public.learning_on(l.user_id)
  union all
  select t.user_id, 2, 'tree', (t.d + time '12:00')::timestamp at time zone 'Asia/Taipei', null from truns t where t.rn % 10 = 0
  union all
  select q.user_id, q.xp, 'qilin', q.claimed_at, null from public.qilin_claims q where public.learning_on(q.user_id);
$function$;

CREATE OR REPLACE FUNCTION public.member_activity(p_user uuid)
 RETURNS TABLE(at timestamp with time zone, kind text, points integer, title text, detail text, by_name text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select t.at, t.kind, t.points, t.title, t.detail, t.by_name from (
    select s.starts_at as at, 'session'::text as kind, 20 as points, s.title, nullif(s.host_name, '') as detail, null::text as by_name
    from public.attendance a join public.sessions s on s.id = a.session_id
    where a.user_id = p_user and not s.cancelled
    union all
    select e.at, e.kind, e.points, case e.kind when 'streak' then '4 weeks in a row' when 'game' then 'Zest Town game' else '10-day streak tree' end, null, null
    from public.xp_events() e where e.user_id = p_user and e.kind in ('streak', 'game', 'tree')
    union all
    select q.claimed_at, 'qilin', q.xp, 'Qilin challenge', case q.period when 'day' then 'Daily' when 'week' then 'Weekly' else 'Monthly' end || ' · ' || q.challenge, null
    from public.qilin_claims q where q.user_id = p_user
    union all
    select x.awarded_at, x.kind, x.points, case x.kind when 'bootcamp' then 'Bootcamp' else 'Bonus' end, nullif(x.reason, ''), g.display_name
    from public.xp_awards x left join public.profiles g on g.id = x.awarded_by where x.user_id = p_user
    union all
    select h.created_at, 'hongbao', 30, 'Hongbao', g.display_name, null
    from public.hongbaos h left join public.profiles g on g.id = h.giver where h.receiver = p_user
    union all
    select a.awarded_at, 'sticker', 0, a.sticker, nullif(a.reason, ''), g.display_name
    from public.sticker_awards a left join public.profiles g on g.id = a.awarded_by where a.user_id = p_user
    union all
    select a.awarded_at, 'avatar', 0, a.avatar, nullif(a.reason, ''), null
    from public.avatar_awards a where a.user_id = p_user
  ) t
  where public.my_role() = 'admin'
  order by t.at desc;
$function$;
