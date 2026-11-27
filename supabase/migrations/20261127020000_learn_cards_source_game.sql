-- Flashcards added from an Arcade game's end screen.
alter table public.learn_cards drop constraint if exists learn_cards_source_check;
alter table public.learn_cards add constraint learn_cards_source_check check (source = any (array['session', 'hsk', 'own', 'book', 'letter', 'game']));
