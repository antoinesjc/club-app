-- Letters: any text (emoji, Latin letters…), still 1–140 characters.
alter table public.letters drop constraint if exists letter_chinese;
alter table public.letters drop constraint if exists letter_length;
alter table public.letters add constraint letter_length check (char_length(btrim(body)) between 1 and 140);

-- What members do in Zest Town, for the admin activity board (Learning): a finished flashcard session, a Library
-- chapter read, a letter sent, a character box round, an Oracle Bone chapter, words added, a qilin challenge…
create table if not exists public.town_events (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  at timestamptz not null default now(),
  kind text not null check (char_length(kind) between 1 and 40),
  label text check (char_length(label) <= 160)
);
create index if not exists town_events_at on public.town_events (at desc);
alter table public.town_events enable row level security; -- no direct access: written by town_event(), read by admin_activity_feed()
revoke all on public.town_events from anon, authenticated;

create or replace function public.town_event(p_kind text, p_label text default null)
returns void language sql security definer set search_path = '' as $$
  insert into public.town_events (user_id, kind, label) select auth.uid(), left(p_kind, 40), left(p_label, 160) where auth.uid() is not null;
$$;
revoke all on function public.town_event(text, text) from public, anon;
grant execute on function public.town_event(text, text) to authenticated;

-- Activity board: Zest Town events (town_events) in the live feed, under Learning.
create or replace function public.admin_activity_feed(p_group text default 'all', p_before timestamptz default null, p_limit integer default 30)
returns table(at timestamptz, user_id uuid, name text, kind text, label text, grp text)
language sql stable security definer set search_path to ''
as $function$
  with m as (select * from public.member_ids()),
  ev as (
    select v.at, v.user_id, 'open' as kind,
      case v.device when 'phone-app' then 'on the phone app' when 'phone-browser' then 'on a phone browser' when 'tablet' then 'on a tablet' when 'computer' then 'on a computer' else '' end as label,
      'community' as grp
    from public.member_visits(coalesce(p_before, now()) - interval '60 days') v
    union all
    select e.at, e.user_id, 'cant', coalesce(s.title, 'a session') || coalesce(' · ' || to_char(s.starts_at at time zone 'Asia/Taipei', 'Dy DD Mon HH24:MI'), ''), 'sessions'
    from public.app_events e left join public.sessions s on s.id = e.session_id where e.kind = 'cant'
    union all
    select i.created_at, i.user_id, 'imin', coalesce(s.title, 'a session') || coalesce(' · ' || to_char(s.starts_at at time zone 'Asia/Taipei', 'Dy DD Mon HH24:MI'), ''), 'sessions'
    from public.interests i left join public.sessions s on s.id = i.session_id
    union all
    select greatest(s.starts_at, a.created_at), a.user_id, 'attended', s.title, 'sessions'
    from public.attendance a join public.sessions s on s.id = a.session_id where not s.cancelled
    union all
    select h.created_at, h.giver, 'hongbao', coalesce(p.display_name, 'a member'), 'community'
    from public.hongbaos h left join public.profiles p on p.id = h.receiver
    union all
    select i.created_at, i.user_id, 'idea', case i.category when 'sessions' then 'Sessions' when 'app' then 'App features' when 'discord' then 'Discord' else 'Something else' end, 'community'
    from public.ideas i
    union all
    select b.created_at, b.user_id, 'bootcamp', b.title, 'learning'
    from public.bootcamp_requests b
    union all
    select a.awarded_at, a.user_id, 'sticker', a.sticker, 'community'
    from public.sticker_awards a
    union all
    select x.awarded_at, x.user_id, 'xp', x.points::text || coalesce(' · ' || nullif(x.reason, ''), ''), 'learning'
    from public.xp_awards x
    union all
    select lp.created_at, lp.user_id, 'book_' || lp.source,
      coalesce(nullif(bk.title_zh, ''), bk.title, lp.book_id) || case when lp.source = 'stripe' and lp.amount_cents > 0 then ' · ' || to_char(lp.amount_cents / 100.0, 'FM999990.00') || ' ' || upper(coalesce(lp.currency, 'usd')) else '' end,
      'learning'
    from public.library_purchases lp left join public.library_books bk on bk.id = lp.book_id
    union all
    select t.at, t.user_id, 'town_' || t.kind, coalesce(t.label, ''), 'learning'
    from public.town_events t
  )
  select ev.at, ev.user_id, m.name, ev.kind, ev.label, ev.grp
  from ev join m on m.user_id = ev.user_id
  where public.my_role() = 'admin' and ev.at <= now() + interval '1 day'
    and (p_group = 'all' or ev.grp = p_group)
    and (p_before is null or ev.at < p_before)
  order by ev.at desc
  limit least(greatest(p_limit, 1), 100);
$function$;
