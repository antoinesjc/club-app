// Pinyin → zhuyin (bopomofo), for members who chose zhuyin in their profile.
// Handles tone marks (xuéxiào), tone numbers (xue2 xiao4), spaces, apostrophes and punctuation;
// anything that isn't pinyin is left as it is. Syllables come out separated by spaces, tone marks after
// (ˊ ˇ ˋ), the neutral tone as ˙ before, the first tone unmarked (Taiwan style).
const INI = { b: "ㄅ", p: "ㄆ", m: "ㄇ", f: "ㄈ", d: "ㄉ", t: "ㄊ", n: "ㄋ", l: "ㄌ", g: "ㄍ", k: "ㄎ", h: "ㄏ", j: "ㄐ", q: "ㄑ", x: "ㄒ",
  zh: "ㄓ", ch: "ㄔ", sh: "ㄕ", r: "ㄖ", z: "ㄗ", c: "ㄘ", s: "ㄙ" };
const FIN = { a: "ㄚ", o: "ㄛ", e: "ㄜ", "ê": "ㄝ", ai: "ㄞ", ei: "ㄟ", ao: "ㄠ", ou: "ㄡ", an: "ㄢ", en: "ㄣ", ang: "ㄤ", eng: "ㄥ", ong: "ㄨㄥ", er: "ㄦ",
  i: "ㄧ", ia: "ㄧㄚ", ie: "ㄧㄝ", iao: "ㄧㄠ", iu: "ㄧㄡ", ian: "ㄧㄢ", in: "ㄧㄣ", iang: "ㄧㄤ", ing: "ㄧㄥ", iong: "ㄩㄥ",
  u: "ㄨ", ua: "ㄨㄚ", uo: "ㄨㄛ", uai: "ㄨㄞ", ui: "ㄨㄟ", uan: "ㄨㄢ", un: "ㄨㄣ", uang: "ㄨㄤ",
  "ü": "ㄩ", "üe": "ㄩㄝ", "üan": "ㄩㄢ", "ün": "ㄩㄣ" };
const YW = { yi: "ㄧ", ya: "ㄧㄚ", yo: "ㄧㄛ", ye: "ㄧㄝ", yai: "ㄧㄞ", yao: "ㄧㄠ", you: "ㄧㄡ", yan: "ㄧㄢ", yin: "ㄧㄣ", yang: "ㄧㄤ", ying: "ㄧㄥ", yong: "ㄩㄥ",
  yu: "ㄩ", yue: "ㄩㄝ", yuan: "ㄩㄢ", yun: "ㄩㄣ", wu: "ㄨ", wa: "ㄨㄚ", wo: "ㄨㄛ", wai: "ㄨㄞ", wei: "ㄨㄟ", wan: "ㄨㄢ", wen: "ㄨㄣ", wang: "ㄨㄤ", weng: "ㄨㄥ",
  a: "ㄚ", o: "ㄛ", e: "ㄜ", ai: "ㄞ", ei: "ㄟ", ao: "ㄠ", ou: "ㄡ", an: "ㄢ", en: "ㄣ", ang: "ㄤ", eng: "ㄥ", er: "ㄦ", "ê": "ㄝ" };
const NOFIN = new Set(["zh", "ch", "sh", "r", "z", "c", "s"]); // zhi chi shi ri zi ci si
// Which finals each kind of initial takes (keeps the splitting of "xian" vs "xi an" honest).
const OK = (ini, fin) => {
  if ("jqx".includes(ini)) return fin.startsWith("i") || fin.startsWith("ü");
  if (fin.startsWith("ü")) return ini === "n" || ini === "l";
  if (NOFIN.has(ini) && fin === "i") return true;
  if (fin === "er" || fin === "ê") return false;
  if ("gkhfzcsr".includes(ini) || ["zh", "ch", "sh"].includes(ini)) { if (fin.startsWith("i")) return false; }
  if ("bpmf".includes(ini) && /^(u[a-z]|ong)/.test(fin)) return false;
  return true;
};
const TONED = { "ā": "a1", "á": "a2", "ǎ": "a3", "à": "a4", "ē": "e1", "é": "e2", "ě": "e3", "è": "e4", "ī": "i1", "í": "i2", "ǐ": "i3", "ì": "i4",
  "ō": "o1", "ó": "o2", "ǒ": "o3", "ò": "o4", "ū": "u1", "ú": "u2", "ǔ": "u3", "ù": "u4", "ǖ": "ü1", "ǘ": "ü2", "ǚ": "ü3", "ǜ": "ü4", "ü": "ü0",
  "ê": "ê0", "ế": "ê2", "ề": "ê4" };
const MARK = ["˙", "", "ˊ", "ˇ", "ˋ", "˙"];

// One toneless syllable → zhuyin letters, or null if it isn't one.
function syl(s) {
  s = s.replace(/v/g, "ü");
  if (YW[s]) return YW[s];
  const m = /^(zh|ch|sh|[bpmfdtnlgkhjqxrzcs])(.+)$/.exec(s);
  if (!m) return null;
  let [, ini, fin] = m;
  if (fin === "i" && NOFIN.has(ini)) return INI[ini];
  if ("jqx".includes(ini) && fin.startsWith("u")) fin = "ü" + fin.slice(1);
  if (!FIN[fin] || !OK(ini, fin)) return null;
  return INI[ini] + FIN[fin];
}

// A run of pinyin letters (one word, maybe several syllables): best split into syllables, each with at most one tone.
function word(letters, tones) {
  const n = letters.length, best = Array(n + 1).fill(null); best[0] = [];
  for (let i = 0; i < n; i++) {
    if (!best[i]) continue;
    for (let j = Math.min(n, i + 6); j > i; j--) {
      const z = syl(letters.slice(i, j)); if (!z) continue;
      const ts = tones.slice(i, j).filter((t) => t > 0);
      if (ts.length > 1) continue;
      const cand = [...best[i], [z, ts[0] || 0]];
      if (!best[j] || cand.length < best[j].length) best[j] = cand;
    }
  }
  return best[n];
}

const NEUTRAL = new Set(["de", "le", "ma", "ne", "ba", "me", "men", "zi", "zhe", "la", "ya", "wa", "na", "ge"]);
const HAS_TONE = /[āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜếề]|[a-zü][1-5](?![0-9])/i;

export function toZhuyin(text) {
  const src = String(text ?? ""), anyTone = HAS_TONE.test(src.normalize("NFC"));
  return src.replace(/[A-Za-zÀ-ɏüÜêỀ-ͯ]+(?:[1-5](?![0-9]))?/g, (tok) => {
    const num = /[1-5]$/.test(tok) ? +tok.slice(-1) : 0;
    const raw = (num ? tok.slice(0, -1) : tok).normalize("NFC").toLowerCase();
    let letters = "", tones = [];
    for (const ch of raw) { const t = TONED[ch]; if (t) { letters += t[0]; tones.push(+t[1]); } else { letters += ch; tones.push(0); } }
    if (/[^a-zü ê]/.test(letters)) return tok;
    // Erhua: a final r after a full syllable (wánr) becomes ㄦ.
    let er = "";
    if (letters.length > 2 && letters.endsWith("r") && !letters.endsWith("er") && word(letters.slice(0, -1), tones.slice(0, -1))) { er = "ㄦ"; letters = letters.slice(0, -1); tones = tones.slice(0, -1); }
    const parts = word(letters, tones);
    if (!parts) return tok;
    if (num && parts.length === 1) parts[0][1] = num;
    // Unmarked syllable: neutral tone when the text marks tones elsewhere (HSK lists mark the 1st tone: mā),
    // or a lone particle like "de"; otherwise (toneless pinyin) no tone sign at all.
    const lone = !anyTone && parts.length === 1 && NEUTRAL.has(letters);
    return parts.map(([z, t], i) => {
      const tone = t || (anyTone || lone ? 5 : 1);
      const out = tone === 5 ? MARK[5] + z : z + MARK[tone];
      return i === parts.length - 1 ? out + er : out;
    }).join(" ");
  }).replace(/([ㄅ-ㄩˊˇˋ˙])['’]([˙ㄅ-ㄩ])/g, "$1 $2");
}
