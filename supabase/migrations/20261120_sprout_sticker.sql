-- Sprout sticker: finish the Complete Beginner Bootcamp.
create or replace function public.sticker_ok(k text) returns boolean language sql immutable set search_path = ''
as $$ select k in ('boba', 'tones', 'lantern', 'dumpling', 'brush', 'mooncake', 'phone', 'heart', 'medal', 'founder', 'turkey', 'sprout') $$;

insert into public.bootcamp_rewards (bootcamp, xp, sticker)
values ('https://www.mandarinzest.com/complete-beginner-bootcamp', 150, 'sprout')
on conflict (bootcamp) do update set xp = excluded.xp, sticker = excluded.sticker, updated_at = now();
