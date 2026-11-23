-- Welcome tour (5 slides) for new members: shown once, until tour_seen is set (finish or skip).
-- Everyone who already has a profile on 23 Nov 2026 counts as having seen it.
alter table public.profiles add column if not exists tour_seen timestamptz;
update public.profiles set tour_seen = now() where tour_seen is null;
grant update (tour_seen) on public.profiles to authenticated;
