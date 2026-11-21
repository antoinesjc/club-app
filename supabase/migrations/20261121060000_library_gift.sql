-- Admins give a book to a member (e.g. they bought the PDF before): a purchase with source 'gift'. Gifts don't count as the member's free claim and don't unlock the 开卷 sticker.
create or replace function public.library_member_books(p_user uuid) returns table (book_id text, source text, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select p.book_id, p.source, p.created_at from public.library_purchases p where p.user_id = p_user and public.my_role() = 'admin' order by p.created_at;
$$;
create or replace function public.library_give_book(p_user uuid, p_book text) returns text
language plpgsql security definer set search_path = '' as $$
begin
  if public.my_role() <> 'admin' then return 'not_allowed'; end if;
  if not exists (select 1 from public.library_books where id = p_book) then return 'no_book'; end if;
  if exists (select 1 from public.library_purchases where user_id = p_user and book_id = p_book) then return 'already_owned'; end if;
  insert into public.library_purchases (user_id, book_id, source, amount_cents, currency) values (p_user, p_book, 'gift', 0, 'usd');
  return 'ok';
end $$;
create or replace function public.library_take_book(p_user uuid, p_book text) returns text
language plpgsql security definer set search_path = '' as $$
begin
  if public.my_role() <> 'admin' then return 'not_allowed'; end if;
  delete from public.library_purchases where user_id = p_user and book_id = p_book and source = 'gift';
  return case when found then 'ok' else 'not_a_gift' end;
end $$;
revoke all on function public.library_member_books(uuid), public.library_give_book(uuid, text), public.library_take_book(uuid, text) from public, anon;
grant execute on function public.library_member_books(uuid), public.library_give_book(uuid, text), public.library_take_book(uuid, text) to authenticated;
