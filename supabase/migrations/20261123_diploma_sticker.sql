-- Certificate sticker: finish the HSK 1 Intensive Bootcamp.
create or replace function public.sticker_ok(k text) returns boolean language sql immutable set search_path = ''
as $$ select k in ('boba', 'tones', 'lantern', 'dumpling', 'brush', 'mooncake', 'phone', 'heart', 'medal', 'founder', 'turkey', 'sprout', 'book', 'diploma') $$;

insert into public.bootcamp_rewards (bootcamp, xp, sticker)
values ('https://www.mandarinzest.com/hsk-1-intensive-bootcamp', 150, 'diploma')
on conflict (bootcamp) do update set xp = excluded.xp, sticker = excluded.sticker, updated_at = now();
