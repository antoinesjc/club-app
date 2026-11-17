-- 17 Nov 2026 (Antoine): ranked HSK word suggestions for the session notes editor, with paging
-- ("Show more"). Ranking: exact match first, then shorter words, then lower HSK level.
-- p_kind: 'hanzi' (prefix on simplified or traditional) or 'pinyin' (p_q is already a pinyin_key).
create or replace function public.hsk_suggest(p_q text, p_kind text, p_limit integer default 6, p_offset integer default 0)
returns table (id integer, level text, hanzi text, hanzi_trad text, pinyin text, meaning text)
language sql
stable
security definer
set search_path = ''
as $$
  select w.id, w.level, w.hanzi, w.hanzi_trad, w.pinyin, w.meaning
  from public.hsk_words w
  where public.is_member() and char_length(p_q) > 0 and (
    (p_kind = 'hanzi' and (w.hanzi like p_q || '%' or w.hanzi_trad like p_q || '%'))
    or (p_kind = 'pinyin' and w.pinyin_key like p_q || '%'))
  order by
    case when p_kind = 'hanzi' then (w.hanzi <> p_q and w.hanzi_trad <> p_q) else w.pinyin_key <> p_q end,
    case when p_kind = 'hanzi' then char_length(w.hanzi) else char_length(w.pinyin_key) end,
    case w.level when '7-9' then 7 else w.level::int end,
    w.num
  limit least(greatest(p_limit, 1), 50) offset greatest(p_offset, 0);
$$;
revoke all on function public.hsk_suggest(text, text, integer, integer) from public, anon;
grant execute on function public.hsk_suggest(text, text, integer, integer) to authenticated;
