-- 17 Nov 2026 (Antoine): the New HSK vocabulary lists (levels 1–6 and 7–9, 11,015 words),
-- taken from the Mandarin Zest PDF lists, for flashcards and future learning games.
-- level: '1'…'6' or '7-9'; num: the word's number in that list; sense: 1/2 when the list
-- splits one character into two meanings (花1, 花2); types: parts of speech (levels 1–6);
-- idiom: marked 成语 in the 7–9 list. Members can read it; only admins (or migrations) change it.

create table public.hsk_words (
  id       integer generated always as identity primary key,
  level    text not null check (level in ('1', '2', '3', '4', '5', '6', '7-9')),
  num      integer not null,
  hanzi    text not null,
  sense    smallint,
  pinyin   text not null,
  types    text[] not null default '{}',
  meaning  text not null,
  idiom    boolean not null default false,
  unique (level, num)
);
create index hsk_words_hanzi on public.hsk_words (hanzi);
alter table public.hsk_words enable row level security;
create policy "Members read the HSK lists" on public.hsk_words for select to authenticated using (public.is_member());
revoke all on public.hsk_words from anon, authenticated;
grant select on public.hsk_words to authenticated;

-- Parts of speech as plain text ("noun, verb") so the list can be imported from a CSV file.
alter table public.hsk_words alter column types drop default;
alter table public.hsk_words alter column types type text using array_to_string(types, ', ');
alter table public.hsk_words alter column types set default '';

-- Traditional characters (Taiwan standard forms) for each HSK word.
alter table public.hsk_words add column hanzi_trad text not null default '';
alter table public.hsk_words alter column hanzi_trad drop default;
