-- Background jobs: a shared secret for the sync function, and schedules.

grant execute on function public.access_role(text) to service_role;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.config (
  name  text primary key,
  value text not null
);
revoke all on private.config from public, anon, authenticated;

insert into private.config (name, value)
values ('sync_secret', encode(extensions.gen_random_bytes(24), 'hex'))
on conflict (name) do nothing;

-- Read by the Edge Functions (service role only).
create or replace function public.app_secret(p_name text)
returns text
language sql
stable
security definer
set search_path = ''
as $$ select value from private.config where name = p_name; $$;

revoke all on function public.app_secret(text) from public, anon, authenticated;
grant execute on function public.app_secret(text) to service_role;

create extension if not exists pg_cron;
create extension if not exists pg_net;

create or replace function private.call_sync(p_action text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform net.http_post(
    url := 'https://eypehvhcqzhwssydvrhn.supabase.co/functions/v1/sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-sync-secret', (select value from private.config where name = 'sync_secret')),
    body := jsonb_build_object('action', p_action),
    timeout_milliseconds := 60000);
end;
$$;

select cron.schedule('club-sync-calendar', '*/15 * * * *', $$ select private.call_sync('calendar') $$);
select cron.schedule('club-sync-stripe', '7 2 * * *', $$ select private.call_sync('stripe') $$);
