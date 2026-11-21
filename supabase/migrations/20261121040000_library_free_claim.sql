-- Each member can claim one paid book for free (once). Stored as a purchase with source 'claim'.
create unique index if not exists library_one_claim on public.library_purchases (user_id) where source = 'claim';
create or replace function public.library_claim_free(p_book text) returns text
language plpgsql security definer set search_path = '' as $$
declare r text := public.my_role();
begin
  if auth.uid() is null or r not in ('member', 'host', 'admin') then return 'not_allowed'; end if;
  if exists (select 1 from public.library_purchases where user_id = auth.uid() and source = 'claim') then return 'already_claimed'; end if;
  if not exists (select 1 from public.library_books b where b.id = p_book and b.price_cents > 0 and (b.published or r = 'admin')) then return 'not_available'; end if;
  if exists (select 1 from public.library_purchases where user_id = auth.uid() and book_id = p_book) then return 'already_owned'; end if;
  insert into public.library_purchases (user_id, book_id, source, amount_cents, currency) values (auth.uid(), p_book, 'claim', 0, 'usd');
  return 'ok';
end $$;
revoke all on function public.library_claim_free(text) from public, anon;
grant execute on function public.library_claim_free(text) to authenticated;
