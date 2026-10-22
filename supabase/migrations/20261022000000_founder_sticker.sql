-- 元老 founding member seal sticker (22 Oct 2026).
create or replace function public.sticker_ok(k text)
returns boolean
language sql
immutable
set search_path = ''
as $$ select k in ('boba', 'tones', 'lantern', 'dumpling', 'brush', 'mooncake', 'phone', 'heart', 'medal', 'founder') $$;
