-- Speed (27 Nov 2026): row-level security rules called is_member() / is_beta() / my_role() / auth.uid() once per
-- ROW (learn_cards: ~1 s per 1,000 cards; word_of_day: ~3 s, it scanned 11,000 HSK words calling is_member() twice
-- per word). Wrapping them in (select …) makes Postgres work them out once per query. Same rules, same results.
create or replace function private.rls_wrap(x text) returns text language sql immutable as $$
  select replace(
           regexp_replace(
             regexp_replace(
               replace(x, '( SELECT auth.uid() AS uid)', '§UID§'),
               '(^|[^a-z_.])(is_member|is_host|is_beta|my_role)\(\)', '\1(select public.\2())', 'g'),
             'auth\.uid\(\)', '(select auth.uid())', 'g'),
           '§UID§', '(select auth.uid())')
$$;
do $$ declare r record; q text; c text;
begin
  for r in select * from pg_policies where schemaname = 'public' loop
    q := private.rls_wrap(r.qual); c := private.rls_wrap(r.with_check);
    if q is distinct from r.qual or c is distinct from r.with_check then
      execute format('alter policy %I on public.%I %s %s', r.policyname, r.tablename,
        case when q is not null then format('using (%s)', q) else '' end,
        case when c is not null then format('with check (%s)', c) else '' end);
    end if;
  end loop;
end $$;

-- Word of the day: same word as before (same order), but the membership check runs once.
create or replace function public.word_of_day(p_day date)
returns table(id integer, level text, hanzi text, hanzi_trad text, pinyin text, types text, meaning text)
language sql stable security definer set search_path = '' as $$
  select w.id, w.level, w.hanzi, w.hanzi_trad, w.pinyin, w.types, w.meaning
  from public.hsk_words w
  where (select public.is_member())
  order by md5(w.id::text || ':' || p_day::text)
  limit 1;
$$;
