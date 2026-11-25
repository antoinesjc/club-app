-- Activity board: the HSK Temple shows once a day per member ("used the HSK Temple") instead of one line per word.
-- Run once on 25 Nov: older hsk_add / hsk_known rows folded into one hsk_temple row per member per day (Taiwan time).
with keep as (
  select distinct on (user_id, (at at time zone 'Asia/Taipei')::date) id from public.town_events
  where kind in ('hsk_add', 'hsk_known') order by user_id, (at at time zone 'Asia/Taipei')::date, at
), del as (
  delete from public.town_events where kind in ('hsk_add', 'hsk_known') and id not in (select id from keep) returning 1
)
update public.town_events set kind = 'hsk_temple', label = null where id in (select id from keep);
