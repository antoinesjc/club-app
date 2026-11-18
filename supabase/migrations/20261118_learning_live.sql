-- Zest Town / Learning is live for every member (beta_testers kept for future betas).
-- Off switch: update private.config set value = 'false' where name = 'learning_live';
update private.config set value = 'true' where name = 'learning_live';

create or replace function public.is_beta() returns boolean
  language sql stable security definer set search_path to ''
as $$ select public.my_role() is not null and (
    public.my_role() = 'admin'
    or coalesce((select c.value = 'true' from private.config c where c.name = 'learning_live'), false)
    or exists (select 1 from public.beta_testers b where b.user_id = auth.uid())); $$;

-- streak_reminders(): same as before, but for everyone who has Learning (public.learning_on).
