-- Zest Town Post Office 郵局: short letters in Chinese between club people (members, hosts, admins).
-- Private between sender and recipient. 1–140 characters, Chinese characters + Chinese punctuation (+ spaces, line breaks).
-- At most 10 letters a day per person. A new letter calls the letter-notify edge function (push, email fallback).
create table if not exists public.letters (
  id uuid primary key default gen_random_uuid(),
  sender uuid not null default auth.uid() references auth.users(id) on delete cascade,
  recipient uuid not null references auth.users(id) on delete cascade,
  body text not null,
  reply_to uuid references public.letters(id) on delete set null,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  notified_at timestamptz,
  reported_at timestamptz,
  report_notified_at timestamptz,
  constraint letter_not_self check (sender <> recipient),
  constraint letter_chinese check (
    char_length(body) between 1 and 140
    and body ~ '^[㐀-䶿一-鿿　-〿！（），：；？～…—·“”‘’ \n]+$'
    and body ~ '[㐀-䶿一-鿿]'
  )
);
create index if not exists letters_recipient on public.letters (recipient, created_at desc);
create index if not exists letters_sender on public.letters (sender, created_at desc);
alter table public.letters enable row level security;
drop policy if exists "own letters" on public.letters;
create policy "own letters" on public.letters for select to authenticated using (sender = auth.uid() or recipient = auth.uid());
revoke all on public.letters from anon, authenticated;
grant select on public.letters to authenticated; -- writes only through the functions below

-- Everyone you can write to (and whose letters you can get): club people with a role, minus yourself.
create or replace function public.letter_people()
returns table(id uuid, name text, role text, fruit text)
language sql stable security definer set search_path = '' as $$
  select u.id, coalesce(nullif(p.display_name, ''), split_part(u.email, '@', 1)), public.access_role(u.email), p.fruit
  from auth.users u left join public.profiles p on p.id = u.id
  where public.my_role() in ('member', 'host', 'admin') and public.access_role(u.email) in ('member', 'host', 'admin') and u.id <> auth.uid()
  order by 2;
$$;

create or replace function public.send_letter(p_to uuid, p_body text, p_reply uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_body text := btrim(regexp_replace(coalesce(p_body, ''), '\r', '', 'g'));
begin
  if public.my_role() not in ('member', 'host', 'admin') then raise exception 'Only club members can send letters'; end if;
  if p_to = auth.uid() or not exists (select 1 from auth.users u where u.id = p_to and public.access_role(u.email) in ('member', 'host', 'admin'))
    then raise exception 'Unknown recipient'; end if;
  if (select count(*) from public.letters where sender = auth.uid() and created_at > now() - interval '24 hours') >= 10
    then raise exception 'daily_limit'; end if;
  if p_reply is not null and not exists (select 1 from public.letters where id = p_reply and recipient = auth.uid()) then p_reply := null; end if;
  insert into public.letters (sender, recipient, body, reply_to) values (auth.uid(), p_to, v_body, p_reply) returning id into v_id;
  return v_id;
end $$;

create or replace function public.letter_read(p_id uuid)
returns void language sql security definer set search_path = '' as $$
  update public.letters set read_at = now() where id = p_id and recipient = auth.uid() and read_at is null;
$$;

create or replace function public.letter_report(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.letters set reported_at = now() where id = p_id and recipient = auth.uid() and reported_at is null;
  if found then perform private.call_fn('letter-notify'); end if;
end $$;

-- Admins see reported letters (only those), with both names.
create or replace function public.admin_reported_letters()
returns table(id uuid, body text, created_at timestamptz, reported_at timestamptz, sender_name text, recipient_name text)
language sql stable security definer set search_path = '' as $$
  select l.id, l.body, l.created_at, l.reported_at, coalesce(ps.display_name, us.email)::text, coalesce(pr.display_name, ur.email)::text
  from public.letters l
  join auth.users us on us.id = l.sender left join public.profiles ps on ps.id = l.sender
  join auth.users ur on ur.id = l.recipient left join public.profiles pr on pr.id = l.recipient
  where public.my_role() = 'admin' and l.reported_at is not null
  order by l.reported_at desc limit 100;
$$;

-- Words in a letter: HSK words (any substring up to 4 characters) and single characters, for tap-to-see pinyin.
drop function if exists public.letter_words(text);
create function public.letter_words(p_text text)
returns table(src text, id bigint, level text, hanzi text, hanzi_trad text, pinyin text, meaning text)
language sql stable security definer set search_path = '' as $$
  with g as (
    select distinct substr(p_text, i, n) w from generate_series(1, least(char_length(p_text), 140)) i, generate_series(1, 4) n
    where i + n - 1 <= char_length(p_text))
  select 'hsk', h.id::bigint, h.level::text, h.hanzi, h.hanzi_trad, h.pinyin, h.meaning from public.hsk_words h
    where h.hanzi in (select w from g) or h.hanzi_trad in (select w from g)
  union all
  select 'char', null, null, c.ch, c.ch, c.pinyin, c.meaning from public.char_info c
    where c.ch in (select w from g where char_length(w) = 1);
$$;

create or replace function private.letter_new() returns trigger language plpgsql security definer set search_path = '' as $$
begin perform private.call_fn('letter-notify'); return null; end $$;
drop trigger if exists letters_notify on public.letters;
create trigger letters_notify after insert on public.letters for each row execute function private.letter_new();

revoke all on function public.letter_people(), public.send_letter(uuid, text, uuid), public.letter_read(uuid), public.letter_report(uuid), public.admin_reported_letters(), public.letter_words(text) from public, anon;
grant execute on function public.letter_people(), public.send_letter(uuid, text, uuid), public.letter_read(uuid), public.letter_report(uuid), public.admin_reported_letters(), public.letter_words(text) to authenticated;

-- Safety net: anything the trigger missed (function cold start, network) goes out within 5 minutes.
select cron.unschedule('club-letter-notify') where exists (select 1 from cron.job where jobname = 'club-letter-notify');
select cron.schedule('club-letter-notify', '*/5 * * * *', $$ select private.call_fn('letter-notify') where exists (select 1 from public.letters where (notified_at is null and created_at > now() - interval '2 days') or (reported_at is not null and report_notified_at is null)) $$);

-- For letter-notify (service role only): who the admins are.
create or replace function public.admin_ids() returns table(id uuid) language sql stable security definer set search_path = '' as $$
  select u.id from auth.users u where public.access_role(u.email) = 'admin';
$$;
revoke all on function public.admin_ids() from public, anon, authenticated;
grant execute on function public.admin_ids() to service_role;

-- Words added from a letter ("Add words to flashcards").
alter table public.learn_cards drop constraint if exists learn_cards_source_check;
alter table public.learn_cards add constraint learn_cards_source_check check (source = any (array['session', 'hsk', 'own', 'book', 'letter']));
