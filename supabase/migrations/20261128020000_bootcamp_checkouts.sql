-- 28 Nov 2026: Self-Study and trial users buy bootcamps in the app (regular price, Stripe Checkout).
-- billing function: started checkouts are kept here; once Stripe says paid, a bootcamp_requests row
-- ("Paid US$x in the app") is added so bootcamp-notify emails the team as for Club requests.
create table if not exists public.bootcamp_checkouts (
  session_id  text primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  bootcamp    text not null,
  title       text not null,
  amount_cents integer not null,
  currency    text not null default 'usd',
  status      text not null default 'open' check (status in ('open', 'paid', 'expired')),
  created_at  timestamptz not null default now()
);
alter table public.bootcamp_checkouts enable row level security;
revoke all on public.bootcamp_checkouts from anon, authenticated;
grant select on public.bootcamp_checkouts to authenticated;
create policy "own bootcamp checkouts" on public.bootcamp_checkouts for select to authenticated using (user_id = (select auth.uid()));
alter table public.bootcamp_requests drop constraint if exists bootcamp_requests_status_check;
alter table public.bootcamp_requests add constraint bootcamp_requests_status_check check (char_length(status) <= 80);
