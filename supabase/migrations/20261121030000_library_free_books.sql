-- Free books (price_cents = 0) are unlocked for every member, host and admin, no purchase needed.
create or replace function public.library_owns(p_book text) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.my_role() = 'admin'
      or exists (select 1 from public.library_purchases p where p.user_id = auth.uid() and p.book_id = p_book)
      or (public.my_role() in ('member', 'host')
          and exists (select 1 from public.library_books b where b.id = p_book and b.price_cents = 0 and b.published));
$$;
