-- 开卷 sticker: unlocked by a member's first book bought in the Bookshop (Stripe). Claimed free books and free books don't count.
create or replace function public.sticker_ok(k text) returns boolean language sql immutable set search_path = ''
as $$ select k in ('boba', 'tones', 'lantern', 'dumpling', 'brush', 'mooncake', 'phone', 'heart', 'medal', 'founder', 'turkey', 'sprout', 'book') $$;
create or replace function public.library_first_book_sticker() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.source = 'stripe' then
    insert into public.sticker_awards (user_id, sticker, reason) values (new.user_id, 'book', 'First book bought in the Bookshop')
    on conflict (user_id, sticker) do nothing;
  end if;
  return new;
end $$;
drop trigger if exists library_first_book_sticker on public.library_purchases;
create trigger library_first_book_sticker after insert on public.library_purchases for each row execute function public.library_first_book_sticker();
-- anyone who already bought one
insert into public.sticker_awards (user_id, sticker, reason)
select distinct user_id, 'book', 'First book bought in the Bookshop' from public.library_purchases where source = 'stripe'
on conflict (user_id, sticker) do nothing;
