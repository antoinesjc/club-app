-- 17 Nov 2026 (Antoine): Idea box on the Me page. Members leave suggestions and feedback
-- (sessions, app features, Discord, something else). The ideas-export function hands them to the
-- "Club members" Google Sheet ("Ideas" tab), which the Apps Script fills every hour.

create table public.ideas (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade default auth.uid(),
  category     text not null check (category in ('sessions', 'app', 'discord', 'other')),
  message      text not null default '' check (char_length(message) <= 2000),   -- the idea, or the session topic
  level        text not null default '' check (char_length(level) <= 40),
  timezone     text not null default '' check (char_length(timezone) <= 60),
  days         text[] not null default '{}' check (cardinality(days) <= 7),
  times        text[] not null default '{}' check (cardinality(times) <= 3),
  created_at   timestamptz not null default now(),
  check (char_length(trim(message)) > 0)
);
create index ideas_created on public.ideas (created_at);
alter table public.ideas enable row level security;
create policy "Members send their own ideas" on public.ideas for insert to authenticated
  with check (public.is_member() and user_id = (select auth.uid()));
create policy "Members see their own ideas, admins all" on public.ideas for select to authenticated
  using (public.is_member() and (user_id = (select auth.uid()) or public.my_role() = 'admin'));
revoke all on public.ideas from anon, authenticated;
grant select on public.ideas to authenticated;
grant insert (category, message, level, timezone, days, times) on public.ideas to authenticated;

-- For the ideas-export function (service role only): ideas with the sender's name and email.
create or replace function public.ideas_for_sheet()
returns table (id uuid, created_at timestamptz, name text, email text, category text, message text,
               level text, timezone text, days text[], times text[])
language sql
stable
security definer
set search_path = ''
as $$
  select i.id, i.created_at, p.display_name, u.email, i.category, i.message, i.level, i.timezone, i.days, i.times
  from public.ideas i
  left join public.profiles p on p.id = i.user_id
  left join auth.users u on u.id = i.user_id
  order by i.created_at;
$$;
revoke all on function public.ideas_for_sheet() from public, anon, authenticated;
grant execute on function public.ideas_for_sheet() to service_role;
