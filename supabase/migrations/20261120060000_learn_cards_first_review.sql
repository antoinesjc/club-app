-- When a card was first studied, so the daily new-card limit is the same on every device.
alter table public.learn_cards add column if not exists first_review timestamptz;
update public.learn_cards set first_review = last_review where reps > 0 and first_review is null and reps <= 2;
update public.learn_cards set first_review = created_at where reps > 0 and first_review is null;
