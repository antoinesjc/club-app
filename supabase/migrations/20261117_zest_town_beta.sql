-- Zest Town (Learning Universe) beta: flashcards, streak days, beta testers.
create table if not exists public.beta_testers (
  user_id uuid primary key references auth.users(id) on delete cascade,
  added_at timestamptz not null default now()
);
alter table public.beta_testers enable row level security;
create policy "Admins manage beta testers" on public.beta_testers for all
  using (public.my_role() = 'admin') with check (public.my_role() = 'admin');
create policy "Testers see themselves" on public.beta_testers for select
  using (user_id = (select auth.uid()));

create or replace function public.is_beta() returns boolean
  language sql stable security definer set search_path to ''
as $$ select public.my_role() = 'admin'
   or (public.my_role() is not null and exists (select 1 from public.beta_testers b where b.user_id = auth.uid())); $$;

create table if not exists public.learn_cards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  hanzi text not null,
  hanzi_trad text,
  pinyin text not null default '',
  meaning text not null default '',
  hsk_level text,
  session_id text references public.sessions(id) on delete set null,
  source text not null default 'session' check (source in ('session', 'hsk', 'own')),
  due date not null default current_date,
  interval_days int not null default 0,
  ease real not null default 2.5,
  reps int not null default 0,
  good_streak int not null default 0,
  lapses int not null default 0,
  last_review timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, hanzi)
);
create index if not exists learn_cards_user_due on public.learn_cards (user_id, due);
alter table public.learn_cards enable row level security;
create policy "Beta testers own their cards" on public.learn_cards for all
  using (user_id = (select auth.uid()) and public.is_beta())
  with check (user_id = (select auth.uid()) and public.is_beta());

-- A day counts for the streak tree: 'game' = played a game (flashcard review), 'water' = saved with the watering can.
-- Session days come from attendance, so they are not stored here.
create table if not exists public.learn_days (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  day date not null,
  kind text not null check (kind in ('game', 'water')),
  created_at timestamptz not null default now(),
  primary key (user_id, day, kind)
);
alter table public.learn_days enable row level security;
create policy "Beta testers read their days" on public.learn_days for select
  using (user_id = (select auth.uid()) and public.is_beta());
create policy "Beta testers log their days" on public.learn_days for insert
  with check (user_id = (select auth.uid()) and public.is_beta()
    and day between current_date - 3 and current_date + 1);
create policy "Beta testers remove their days" on public.learn_days for delete
  using (user_id = (select auth.uid()) and public.is_beta());

-- One watering can per calendar month (counted by the day it saves).
create or replace function public.learn_water_once() returns trigger
  language plpgsql set search_path to ''
as $$ begin
  if new.kind = 'water' and exists (select 1 from public.learn_days d where d.user_id = new.user_id and d.kind = 'water'
       and date_trunc('month', d.created_at) = date_trunc('month', now())) then
    raise exception 'You already used your watering can this month';
  end if;
  return new;
end $$;
create trigger learn_water_once before insert on public.learn_days for each row execute function public.learn_water_once();
