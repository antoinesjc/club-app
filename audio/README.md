# Audio for the Great Chinese University

- `py/` pinyin and zhuyin recordings, copied from the free tools (repos antoinesjc/pinyin and antoinesjc/learn-bopomofo):
  `s-<sound>.mp3` (pinyin sounds), `l-<sound>.mp3` (zhuyin symbols), `y-<syllable>.mp3` (syllables, said in the 1st tone); ü is written v, ê is eh.
  Source: CNS11643 全字庫, Government Open Data License.
- `tones/t-<syllable><tone>.mp3` (tone 5 = neutral): made from the `y-` recordings above by changing only the pitch
  (Praat overlap-add resynthesis, script `tools/uni/tones.py`), not text-to-speech. Replace with real recordings when available.
