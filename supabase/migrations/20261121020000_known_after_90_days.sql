-- A word counts as known (dark green in the HSK Temple) once its next review is 90+ days away.
-- Words marked "I already know this word" before this change (30-day interval) move to 90 days.
update public.learn_cards
set interval_days = 90, due = (coalesce(last_review, now()) at time zone 'UTC')::date + 90
where interval_days = 30 and reps = 1 and good_streak >= 3;
