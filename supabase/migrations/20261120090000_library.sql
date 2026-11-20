-- Library (Zest Town): digital workbooks members own and read in the app, bought in the in-app Bookshop (Stripe Checkout).
-- Book texts live only in library_book_content (never in this public repo); readable by admins and by members who bought the book.
create table if not exists public.library_books (
  id text primary key,
  title text not null,
  title_zh text,
  subtitle text,
  level text,                       -- HSK level for the shelf filter: '1'…'6', '7-9'
  summary text,
  color text,
  cover text,                       -- path of the cover image in the app (icons/books/…)
  price_cents integer not null,
  currency text not null default 'usd',
  published boolean not null default false,   -- false = beta: admins only
  sort integer not null default 0,
  created_at timestamptz not null default now()
);
create table if not exists public.library_book_content (
  book_id text primary key references public.library_books(id) on delete cascade,
  content jsonb not null,
  updated_at timestamptz not null default now()
);
create table if not exists public.library_purchases (
  user_id uuid not null references auth.users(id) on delete cascade,
  book_id text not null references public.library_books(id) on delete cascade,
  source text not null default 'stripe',      -- stripe / gift
  stripe_session text unique,
  amount_cents integer,
  currency text,
  created_at timestamptz not null default now(),
  primary key (user_id, book_id)
);
create table if not exists public.library_checkouts (   -- started checkouts, checked until paid (service role only)
  session_id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  book_id text not null references public.library_books(id) on delete cascade,
  status text not null default 'open',
  created_at timestamptz not null default now()
);
create table if not exists public.library_progress (     -- chapters read, quick checks, exercise answers
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  book_id text not null references public.library_books(id) on delete cascade,
  state jsonb not null default '{}',
  updated_at timestamptz not null default now(),
  primary key (user_id, book_id)
);

alter table public.library_books enable row level security;
alter table public.library_book_content enable row level security;
alter table public.library_purchases enable row level security;
alter table public.library_checkouts enable row level security;
alter table public.library_progress enable row level security;

create or replace function public.library_owns(p_book text) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.my_role() = 'admin'
      or exists (select 1 from public.library_purchases p where p.user_id = auth.uid() and p.book_id = p_book);
$$;
revoke all on function public.library_owns(text) from public, anon;
grant execute on function public.library_owns(text) to authenticated;

drop policy if exists "books visible" on public.library_books;
create policy "books visible" on public.library_books for select to authenticated
  using ((published and public.my_role() in ('member', 'host', 'admin')) or public.my_role() = 'admin');
drop policy if exists "content for owners" on public.library_book_content;
create policy "content for owners" on public.library_book_content for select to authenticated using (public.library_owns(book_id));
drop policy if exists "own purchases" on public.library_purchases;
create policy "own purchases" on public.library_purchases for select to authenticated using (user_id = auth.uid());
drop policy if exists "own progress" on public.library_progress;
create policy "own progress" on public.library_progress for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select on public.library_books, public.library_book_content, public.library_purchases to authenticated;
grant select, insert, update, delete on public.library_progress to authenticated;
