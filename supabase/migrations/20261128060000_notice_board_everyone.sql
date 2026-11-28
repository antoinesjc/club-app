-- 28 Nov 2026: the Magical Forest notice board is visible to everyone who learns (Club, Self-Study, trial), and
-- everyone can cheer 加油. Only Club members' wins are posted (private.add_notice checks access_role = 'member').
do $$ declare f text; d text;
begin
  foreach f in array array['notice_board', 'notice_cheer'] loop
    select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = f;
    d := replace(d, 'public.my_role() in (''member'', ''host'', ''admin'')', 'public.my_role() in (''member'', ''host'', ''admin'', ''self'', ''trial'')');
    execute d;
  end loop;
end $$;
