-- 16 Nov 2026 (Antoine): "Email only" option for admin notifications.
alter table public.admin_broadcasts drop constraint admin_broadcasts_channel_check;
alter table public.admin_broadcasts add constraint admin_broadcasts_channel_check check (channel in ('push', 'fallback', 'both', 'email'));
