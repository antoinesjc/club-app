-- Members choose how pronunciation is shown everywhere in the app: pinyin (default) or zhuyin (bopomofo).
alter table public.profiles add column if not exists phonetic text not null default 'pinyin' check (phonetic in ('pinyin', 'zhuyin'));
grant update (phonetic) on public.profiles to authenticated;
