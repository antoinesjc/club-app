-- 17 Nov 2026 (Antoine): word suggestions while hosts type session vocabulary.
-- pinyin_key = pinyin without tones, spaces or punctuation ("yèshì" → "yeshi", ü → u),
-- so "yeshi", "ye shi" and "ye4shi4" all find 夜市. Prefix indexes for characters and pinyin.
alter table public.hsk_words add column pinyin_key text generated always as (
  regexp_replace(lower(translate(pinyin,
    'āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜüĀÁǍÀĒÉĚÈĪÍǏÌŌÓǑÒŪÚǓÙ',
    'aaaaeeeeiiiioooouuuuuuuuuaaaaeeeeiiiioooouuuu')), '[^a-z]', '', 'g')) stored;
create index hsk_words_pinyin_key on public.hsk_words (pinyin_key text_pattern_ops);
create index hsk_words_hanzi_prefix on public.hsk_words (hanzi text_pattern_ops);
create index hsk_words_trad_prefix on public.hsk_words (hanzi_trad text_pattern_ops);
