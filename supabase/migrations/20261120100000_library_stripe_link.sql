-- Each book can point at its Stripe payment link; the in-app checkout reuses that link's price (same product in Stripe).
alter table public.library_books add column if not exists stripe_link text, add column if not exists stripe_price text;
update public.library_books set price_cents = 250, stripe_link = 'https://buy.stripe.com/00w5kDdkR5r76DC3hP6oo0u' where id = 'mz-partner';
