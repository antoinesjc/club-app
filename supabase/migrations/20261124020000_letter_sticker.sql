-- 来信 sticker ("You've got mail"): a member who has sent a letter at the Post Office AND received one
-- (from anyone in the Club: members, hosts or admins). Members only (hosts and admins already have every sticker).
-- Awarded by a trigger on letters, for both people; rewards-notify sends the pop-up + phone notification.
create or replace function public.sticker_ok(k text) returns boolean language sql immutable set search_path = ''
as $$ select k in ('boba', 'tones', 'lantern', 'dumpling', 'brush', 'mooncake', 'phone', 'heart', 'medal', 'founder', 'turkey', 'sprout', 'book', 'diploma', 'letter') $$;

create or replace function public.letter_sticker() returns trigger
language plpgsql security definer set search_path = '' as $$
declare u uuid;
begin
  foreach u in array array[new.sender, new.recipient] loop
    if exists (select 1 from auth.users x where x.id = u and public.access_role(x.email) = 'member')
       and exists (select 1 from public.letters where sender = u)
       and exists (select 1 from public.letters where recipient = u) then
      insert into public.sticker_awards (user_id, sticker, reason) values (u, 'letter', 'Sent a letter at the Post Office and got one back')
      on conflict (user_id, sticker) do nothing;
    end if;
  end loop;
  return null;
end $$;
drop trigger if exists letters_sticker on public.letters;
create trigger letters_sticker after insert on public.letters for each row execute function public.letter_sticker();

-- members who already qualify
insert into public.sticker_awards (user_id, sticker, reason)
select u.id, 'letter', 'Sent a letter at the Post Office and got one back' from auth.users u
where public.access_role(u.email) = 'member'
  and exists (select 1 from public.letters where sender = u.id) and exists (select 1 from public.letters where recipient = u.id)
on conflict (user_id, sticker) do nothing;
