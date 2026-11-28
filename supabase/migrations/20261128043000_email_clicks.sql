-- Clicks on links in Mandarin Zest emails (welcome email). Written and read only by the edge function "go"
-- (service role). rid = random id per email sent (stored in the Start Here sheet), no email address here.
create table if not exists public.email_clicks (
  id bigint generated always as identity primary key,
  rid text not null,
  link text not null,
  ua text,
  clicked_at timestamptz not null default now()
);
create index if not exists email_clicks_rid on public.email_clicks (rid);
alter table public.email_clicks enable row level security;
revoke all on public.email_clicks from anon, authenticated;
