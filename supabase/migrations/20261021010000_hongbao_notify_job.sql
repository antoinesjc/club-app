-- Background call to any edge function with the sync secret; hongbao notifications every 5 minutes.
create or replace function private.call_fn(p_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform net.http_post(
    url := 'https://eypehvhcqzhwssydvrhn.supabase.co/functions/v1/' || p_name,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-sync-secret', (select value from private.config where name = 'sync_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000);
end;
$$;
revoke all on function private.call_fn(text) from public, anon, authenticated;

select cron.schedule('club-hongbao-notify', '*/5 * * * *', $$ select private.call_fn('hongbao-notify') $$);
