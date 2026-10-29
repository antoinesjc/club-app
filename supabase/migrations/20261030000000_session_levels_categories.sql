-- Levels and categories like the website calendar (30 Oct 2026): set by "Level:" / "Category:" lines in the
-- Google Calendar description, written by the session-meta edge function every 15 minutes.
alter table public.sessions add column skill_level text not null default '';
alter table public.sessions add column cats text[] not null default '{}';
select cron.schedule('club-session-meta', '2,17,32,47 * * * *', $$ select private.call_fn('session-meta') $$);
