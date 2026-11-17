-- Word of the day: one HSK word per calendar day, the same for everyone (the app passes the member's local date).
create or replace function public.word_of_day(p_day date)
returns table(id int, level text, hanzi text, hanzi_trad text, pinyin text, types text, meaning text)
language sql stable security invoker set search_path to ''
as $$
  select w.id, w.level, w.hanzi, w.hanzi_trad, w.pinyin, w.types, w.meaning
  from public.hsk_words w
  where public.is_member()
  order by md5(w.id::text || ':' || p_day::text)
  limit 1;
$$;
revoke all on function public.word_of_day(date) from public, anon;
grant execute on function public.word_of_day(date) to authenticated;
