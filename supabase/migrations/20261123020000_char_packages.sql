-- Calligraphy School: character packages (ready-made sets to import into the Character box),
-- a daily limit on new characters in the box (needs first_review), and char_lookup for longer lists.
alter table public.char_box add column if not exists first_review date;

create table if not exists public.char_packages (
  id text primary key,
  title text not null,
  title_zh text not null default '',
  subtitle text not null default '',
  chars text not null,
  sort integer not null default 0,
  published boolean not null default true
);
alter table public.char_packages enable row level security;
drop policy if exists char_packages_read on public.char_packages;
create policy char_packages_read on public.char_packages for select to authenticated using (published or public.my_role() = 'admin');

-- First package: the 100 most frequent characters in modern Chinese (Jun Da's Modern Chinese Character Frequency List).
insert into public.char_packages (id, title, title_zh, subtitle, chars, sort) values
('top100', 'The 100 most common characters', '最常用的一百个字', 'Know these and you can read about 40% of everyday Chinese text',
 '的一是不了在人有我他这个们中来上大为和国地到以说时要就出会可也你对生能而子那得于着下自之年过发后作里用道行所然家种事成方多经么去法学如都同现当没动面起看定天分还进好小部其些主样理心她本前开但因只从想实', 10)
on conflict (id) do update set title = excluded.title, title_zh = excluded.title_zh, subtitle = excluded.subtitle, chars = excluded.chars, sort = excluded.sort;

-- char_lookup: up to 200 characters (packages), same output as before.
create or replace function public.char_lookup(p_text text)
returns jsonb language sql stable security definer set search_path to '' as $$
  with cs as (
    select c, min(o) o
    from regexp_split_to_table(left(coalesce(p_text, ''), 200), '') with ordinality as t(c, o) group by c
  ),
  hsk1 as (
    select distinct on (h) h, w.pinyin, w.meaning, w.level from (
      select w.hanzi h, w.* from public.hsk_words w where char_length(w.hanzi) = 1
      union all select w.hanzi_trad, w.* from public.hsk_words w where char_length(w.hanzi_trad) = 1
    ) w order by h, w.level, w.sense nulls first
  ),
  word as (
    select w.pinyin, w.meaning, w.level from public.hsk_words w
    where char_length(p_text) > 1 and (w.hanzi = p_text or w.hanzi_trad = p_text)
    order by w.level, w.sense nulls first limit 1
  )
  select jsonb_build_object(
    'chars', coalesce((select jsonb_agg(jsonb_build_object(
        'ch', i.ch, 'pinyin', coalesce(h.pinyin, i.pinyin), 'meaning', coalesce(h.meaning, split_part(i.meaning, ';', 1)),
        'radical', i.radical, 'radical_meaning', split_part(split_part(r.meaning, ';', 1), ',', 1),
        'trad', i.trad, 'simp', i.simp, 'hsk', h.level) order by cs.o)
      from cs join public.char_info i on i.ch = cs.c
      left join hsk1 h on h.h = i.ch
      left join public.char_info r on r.ch = i.radical and i.radical <> i.ch), '[]'::jsonb),
    'word', (select to_jsonb(word) from word));
$$;
