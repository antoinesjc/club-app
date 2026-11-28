-- Plans (28 Nov 2026): Club member, Self-Study, 7-day free trial.
--   access_role(): 'member' (Club), 'host', 'admin' as before, + 'self' (Self-Study, from Stripe) and 'trial'
--   (first 7 days after signing up). An ended trial gets no role: start_session() says trial_over.
--   is_member() keeps meaning "may use the app" (any role). New is_club(): member / host / admin.
alter table public.members_stripe add column if not exists tier text not null default 'club' check (tier in ('club', 'self'));

create table if not exists public.trials (
  email text primary key,
  user_id uuid references auth.users(id) on delete set null,
  started_at timestamptz not null default now()
);
alter table public.trials enable row level security;
revoke all on public.trials from anon, authenticated;
insert into private.config (name, value) values ('open_signup', 'false') on conflict (name) do nothing;  -- free trial sign-up (off until launch)

create or replace function public.access_role(p_email text)
returns text language sql stable security definer set search_path = '' as $$
  with m as (select * from public.members_manual where email = lower(p_email)),
       s as (select * from public.members_stripe where email = lower(p_email) and active and (member_until is null or member_until > now()))
  select case
    when exists (select 1 from m where status = 'blocked') then null
    when exists (select 1 from m where status = 'active') then (select role from m)
    when exists (select 1 from s where tier = 'club') then 'member'
    when exists (select 1 from s where tier = 'self') then 'self'
    when exists (select 1 from public.trials t where t.email = lower(p_email) and t.started_at > now() - interval '7 days') then 'trial'
    else null
  end;
$$;

create or replace function public.is_club() returns boolean language sql stable security definer set search_path = '' as $$
  select public.my_role() in ('member', 'host', 'admin');
$$;
grant execute on function public.is_club() to authenticated;

-- Session start: role + plan details for the "My plan" card; an ended trial says so.
create or replace function public.start_session()
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_role  text := public.my_role();
  v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_name  text; v_start text; v_trial timestamptz; v_plan json;
begin
  select t.started_at into v_trial from public.trials t where t.email = v_email;
  if auth.uid() is null then return json_build_object('role', null); end if;
  if v_role is null then
    return json_build_object('role', null, 'trial_over', v_trial is not null, 'trial_ended', v_trial + interval '7 days');
  end if;
  if v_trial is not null then update public.trials set user_id = auth.uid() where email = v_email and user_id is null; end if;
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
  select json_build_object('tier', s.tier, 'plan', s.plan, 'until', s.member_until, 'stripe', s.customer_id is not null)
    into v_plan from public.members_stripe s where s.email = v_email and s.active order by (s.tier = 'club') desc limit 1;
  return json_build_object('role', v_role, 'plan', v_plan,
    'manual', exists (select 1 from public.members_manual m where m.email = v_email and m.status = 'active'),
    'trial_ends', case when v_role = 'trial' then v_trial + interval '7 days' end);
end $$;

-- Everyone who learns (Club, Self-Study, trial) earns XP, stickers, level-ups and appears on the forest.
do $$ declare f text; d text;
begin
  foreach f in array array['reward_level_ups', 'award_streak_stickers', 'letter_sticker', 'member_ids'] loop
    select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = f;
    if d is not null then
      d := regexp_replace(d, 'access_role\(([a-z_.]+)\) = ''member''', 'access_role(\1) in (''member'', ''self'', ''trial'')', 'g');
      execute d;
    end if;
  end loop;
  -- (the notice board stays Club-only)
  select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'qilin_claim';
  d := replace(d, 'not in (''member'', ''admin'')', 'not in (''member'', ''admin'', ''self'', ''trial'')');
  execute d;
end $$;

-- Policies: forest messages and the Library for everyone who learns; "I'm in" and bootcamp requests: Club only.
do $$ declare r record; q text; c text;
begin
  for r in select * from pg_policies where schemaname = 'public' and tablename in ('forest_messages', 'library_books') loop
    q := replace(r.qual, 'ARRAY[''member''::text, ''host''::text, ''admin''::text]', 'ARRAY[''member''::text, ''host''::text, ''admin''::text, ''self''::text, ''trial''::text]');
    c := replace(r.with_check, 'ARRAY[''member''::text, ''host''::text, ''admin''::text]', 'ARRAY[''member''::text, ''host''::text, ''admin''::text, ''self''::text, ''trial''::text]');
    if q is distinct from r.qual or c is distinct from r.with_check then
      execute format('alter policy %I on public.%I %s %s', r.policyname, r.tablename,
        case when q is not null then format('using (%s)', q) else '' end,
        case when c is not null then format('with check (%s)', c) else '' end);
    end if;
  end loop;
  for r in select * from pg_policies where schemaname = 'public' and ((tablename = 'interests' and cmd = 'INSERT') or (tablename = 'bootcamp_requests' and cmd = 'INSERT')) loop
    execute format('alter policy %I on public.%I with check (%s)', r.policyname, r.tablename, replace(r.with_check, '( SELECT is_member() AS is_member)', '(select public.is_club())'));
  end loop;
end $$;

-- Free books on the shelf for everyone who learns; the free book of your choice stays Club-only (library_claim_free).
create or replace function public.library_owns(p_book text)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.my_role() = 'admin'
      or exists (select 1 from public.library_purchases p where p.user_id = auth.uid() and p.book_id = p_book)
      or (public.my_role() in ('member', 'host', 'self', 'trial')
          and exists (select 1 from public.library_books b where b.id = p_book and b.price_cents = 0 and b.published));
$$;

-- Magical Forest: who opened the app in the last HOUR (was 24 h), Club, Self-Study and trial; club flag for the sparkles.
drop function if exists public.forest_members();
create function public.forest_members()
returns table(user_id uuid, name text, fruit text, bg text, country text, last_seen timestamptz, streak integer, club boolean)
language sql stable security definer set search_path = '' as $$
  with seen as (
    select x.uid, max(x.at) as at from (
      select e.user_id as uid, e.at from public.app_events e where e.kind = 'open' and e.at >= now() - interval '1 hour'
      union all
      select r.user_id::uuid, greatest(r.created_at, r.updated_at) from auth.refresh_tokens r
        where r.updated_at >= now() - interval '1 hour' and r.user_id ~ '^[0-9a-f-]{36}$'
    ) x group by x.uid
  ), mem as (
    select p.id, p.display_name, p.fruit, p.bg, p.country, s.at, public.access_role(u.email) as role,
      coalesce(nullif(p.timezone, ''), 'Asia/Taipei') as tz
    from seen s join public.profiles p on p.id = s.uid join auth.users u on u.id = p.id
    where public.access_role(u.email) in ('member', 'self', 'trial')
  ), days as (
    select distinct m.id, (se.starts_at at time zone m.tz)::date as d
      from mem m join public.attendance a on a.user_id = m.id join public.sessions se on se.id = a.session_id
      where not se.cancelled and se.starts_at <= now()
    union
    select l.user_id, l.day from public.learn_days l join mem m on m.id = l.user_id
  ), isl as (
    select d.id, d.d, d.d - (row_number() over (partition by d.id order by d.d))::int as grp from days d
  ), runs as (
    select i.id, max(i.d) as last_day, count(*)::int as len from isl i group by i.id, i.grp
  )
  select m.id, m.display_name, m.fruit, m.bg, m.country, m.at,
    coalesce((select r.len from runs r where r.id = m.id and r.last_day >= (now() at time zone m.tz)::date - 1 order by r.last_day desc limit 1), 0),
    m.role = 'member'
  from mem m
  where (select public.is_beta())
  order by m.at desc;
$$;
grant execute on function public.forest_members() to authenticated;

-- Post Office: everyone can write; Club, Self-Study and trial users are listed (not hosts). Admins can write and
-- receive replies but aren't listed.
drop function if exists public.letter_people();
create function public.letter_people()
returns table(id uuid, name text, role text, fruit text, country text, level text, club boolean)
language sql stable security definer set search_path = '' as $$
  select u.id, coalesce(nullif(p.display_name, ''), split_part(u.email, '@', 1)), public.access_role(u.email), p.fruit,
    p.country, p.chinese_level, public.access_role(u.email) = 'member'
  from auth.users u left join public.profiles p on p.id = u.id
  where (select public.my_role()) in ('member', 'admin', 'self', 'trial') and public.access_role(u.email) in ('member', 'self', 'trial') and u.id <> auth.uid()
  order by 2;
$$;
grant execute on function public.letter_people() to authenticated;
do $$ declare d text;
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'send_letter';
  d := replace(d, 'if public.my_role() not in (''member'', ''host'', ''admin'') then raise exception ''Only club members can send letters''',
                  'if public.my_role() not in (''member'', ''admin'', ''self'', ''trial'') then raise exception ''not_allowed''');
  d := replace(d, 'public.access_role(u.email) in (''member'', ''host'', ''admin''))', 'public.access_role(u.email) in (''member'', ''admin'', ''self'', ''trial''))');
  execute d;
end $$;

-- XP board for everyone who learns (Members tab = Club only, filtered by the club flag); forest cards need levels.
drop function if exists public.xp_board();
create function public.xp_board()
returns table(user_id uuid, name text, fruit text, bg text, country text, total integer, month integer, level integer, club boolean)
language sql stable security definer set search_path = '' as $$
  with ev as (select * from public.xp_events()),
  sums as (
    select e.user_id,
      sum(e.points)::int as total,
      coalesce(sum(e.points) filter (where e.at >= (date_trunc('month', now() at time zone 'Europe/Brussels') at time zone 'Europe/Brussels')), 0)::int as month
    from ev e group by e.user_id
  )
  select p.id, p.display_name, p.fruit, p.bg, p.country,
    coalesce(s.total, 0), coalesce(s.month, 0), public.xp_level(coalesce(s.total, 0)), public.access_role(u.email) = 'member'
  from public.profiles p
  join auth.users u on u.id = p.id
  left join sums s on s.user_id = p.id
  where (select public.is_member()) and public.access_role(u.email) in ('member', 'self', 'trial');
$$;
grant execute on function public.xp_board() to authenticated;

-- Discord names: Club only (Self-Study and trial users don't have the Discord). The column itself is hidden from
-- non-Club users in a later migration, once the app reads profiles with explicit columns.
create or replace function public.club_discords()
returns table(id uuid, discord text) language sql stable security definer set search_path = '' as $$
  select p.id, p.discord from public.profiles p join auth.users u on u.id = p.id
  where (select public.is_club()) and (p.id = auth.uid() or public.access_role(u.email) in ('member', 'host', 'admin')) and coalesce(p.discord, '') <> '';
$$;
grant execute on function public.club_discords() to authenticated;
