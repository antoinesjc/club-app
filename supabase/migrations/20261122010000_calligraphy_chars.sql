-- Calligraphy School (beta): character info for the stroke-order checker.
-- 9,574 characters from Make Me a Hanzi's dictionary (pinyin, meaning, radical), the same set the stroke data covers,
-- with simplified/traditional partners from OpenCC (s2tw / t2s). Loaded once; readable by anyone logged in.
create table if not exists public.char_info (
  ch text primary key,
  pinyin text not null default '',
  meaning text not null default '',
  radical text not null default '',
  trad text not null default '',   -- traditional form when it differs (学 → 學)
  simp text not null default ''    -- simplified form when it differs (學 → 学)
);
alter table public.char_info enable row level security;
drop policy if exists char_info_read on public.char_info;
create policy char_info_read on public.char_info for select to authenticated using (true);

-- Everything the stroke-order page shows for a character or a word, in one call.
create or replace function public.char_lookup(p_text text)
returns jsonb language sql stable security definer set search_path to '' as $$
  with cs as (
    select c, min(o) o
    from regexp_split_to_table(left(coalesce(p_text, ''), 12), '') with ordinality as t(c, o) group by c
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
grant execute on function public.char_lookup(text) to authenticated;
