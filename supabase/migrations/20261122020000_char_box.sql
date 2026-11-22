-- Calligraphy School: the Character box 漢字, a writing flashcard deck of its own (not linked to learn_cards,
-- the streak tree or XP). Each card moves through 3 stages: 0 = outline shown, 1 = only the radical shown,
-- 2 = from memory (spaced repetition on interval_days / ease, like the Flashcard Center).
create table if not exists public.char_box (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  ch text not null check (char_length(ch) = 1),
  pinyin text not null default '',
  meaning text not null default '',
  stage smallint not null default 0 check (stage between 0 and 2),
  interval_days integer not null default 0,
  ease real not null default 2.5,
  due date not null default current_date,
  reps integer not null default 0,
  lapses integer not null default 0,
  last_review timestamptz,
  created_at timestamptz not null default now(),
  primary key (user_id, ch)
);
alter table public.char_box enable row level security;
drop policy if exists char_box_own on public.char_box;
create policy char_box_own on public.char_box for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
