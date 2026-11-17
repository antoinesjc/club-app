-- Link session-note vocabulary to the official HSK lists: each vocab item that matches an HSK word
-- (simplified or traditional) gets "hsk": {"id": .., "level": ..}. Items that don't match are left as they are.
create or replace function public.link_vocab_hsk(p jsonb) returns jsonb
language sql stable set search_path to ''
as $$
  select coalesce(jsonb_agg(
    case when h.id is null then t.e - 'hsk' else (t.e - 'hsk') || jsonb_build_object('hsk', jsonb_build_object('id', h.id, 'level', h.level)) end
    order by t.o), '[]'::jsonb)
  from jsonb_array_elements(case when jsonb_typeof(p) = 'array' then p else '[]'::jsonb end) with ordinality as t(e, o)
  left join lateral (
    select w.id, w.level from public.hsk_words w
    where btrim(coalesce(t.e->>'hanzi', '')) <> '' and (w.hanzi = btrim(t.e->>'hanzi') or w.hanzi_trad = btrim(t.e->>'hanzi'))
    order by w.level, w.sense nulls first, w.id limit 1
  ) h on true;
$$;

create or replace function public.session_notes_link_hsk() returns trigger
language plpgsql set search_path to ''
as $$ begin new.vocab := public.link_vocab_hsk(new.vocab); return new; end $$;
drop trigger if exists session_notes_link_hsk on public.session_notes;
create trigger session_notes_link_hsk before insert or update of vocab on public.session_notes
  for each row execute function public.session_notes_link_hsk();

-- Existing notes (keep their "last edited" info untouched).
alter table public.session_notes disable trigger session_notes_touch;
update public.session_notes set vocab = vocab where vocab is not null;
alter table public.session_notes enable trigger session_notes_touch;

-- Existing flashcards: fill in the HSK level when the word is on the lists.
update public.learn_cards c set
  hsk_level = (select w.level from public.hsk_words w where w.hanzi = c.hanzi or w.hanzi_trad = c.hanzi order by w.level, w.sense nulls first, w.id limit 1),
  hanzi_trad = coalesce(c.hanzi_trad, (select w.hanzi_trad from public.hsk_words w where w.hanzi = c.hanzi or w.hanzi_trad = c.hanzi order by w.level, w.sense nulls first, w.id limit 1))
where c.hsk_level is null and exists (select 1 from public.hsk_words w where w.hanzi = c.hanzi or w.hanzi_trad = c.hanzi);
