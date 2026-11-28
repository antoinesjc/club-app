-- APPLY AT GO-LIVE of the plans (after the app version that reads explicit columns is live for everyone):
-- hide the Google Meet links and Discord names from Self-Study and trial users at the column level.
-- The app reads them through club_meet_urls() and club_discords() instead.
revoke select on public.sessions from authenticated;
grant select (id, title, level, category, starts_at, ends_at, topic, about, host_name, cancelled, synced_at, skill_level, cats)
  on public.sessions to authenticated;
revoke select on public.profiles from authenticated;
grant select (id, display_name, fruit, bg, country, chinese_level, show_in_directory, script, created_at, updated_at, notify_reminders,
  notify_new, notify_notes, notify_email, timezone, bio, sticker, notify_rewards, notify_streak, phonetic, tour_seen, show_milestones)
  on public.profiles to authenticated;
