import { HOST_AVATARS, HOST_ART } from "./hosts-art.js?v=22";
export { HOST_AVATARS };
// Fruit avatars and the levels that unlock them (Antoine's table, 19 Oct 2026).
// To change levels or XP later, edit LEVELS and the `level` of each fruit.

export const LEVELS = [
  0, 50, 120, 220, 350, 500, 700, 950, 1250, 1600,
  2000, 2500, 3100, 3800, 4600, 5500, 6500, 7700,
]; // LEVELS[n-1] = total XP needed for level n

// zh = [simplified, traditional], py = [pinyin for simplified, pinyin for traditional]
export const FRUITS = [
  { key: "orange", level: 1, en: "Orange", zh: ["橙子", "柳橙"], py: ["chéngzi", "liǔchéng"] },
  { key: "apple", level: 1, en: "Apple", zh: ["苹果", "蘋果"], py: ["píngguǒ", "píngguǒ"] },
  { key: "peach", level: 1, en: "Peach", zh: ["桃子", "桃子"], py: ["táozi", "táozi"] },
  { key: "strawberry", level: 2, en: "Strawberry", zh: ["草莓", "草莓"], py: ["cǎoméi", "cǎoméi"] },
  { key: "lemon", level: 3, en: "Lemon", zh: ["柠檬", "檸檬"], py: ["níngméng", "níngméng"] },
  { key: "mango", level: 4, en: "Mango", zh: ["芒果", "芒果"], py: ["mángguǒ", "mángguǒ"] },
  { key: "watermelon", level: 5, en: "Watermelon", zh: ["西瓜", "西瓜"], py: ["xīguā", "xīguā"] },
  { key: "pineapple", level: 6, en: "Pineapple", zh: ["菠萝", "鳳梨"], py: ["bōluó", "fènglí"] },
  { key: "kiwi", level: 7, en: "Kiwi", zh: ["猕猴桃", "奇異果"], py: ["míhóutáo", "qíyìguǒ"] },
  { key: "cherry", level: 8, en: "Cherry", zh: ["樱桃", "櫻桃"], py: ["yīngtáo", "yīngtáo"] },
  { key: "coconut", level: 9, en: "Coconut", zh: ["椰子", "椰子"], py: ["yēzi", "yēzi"] },
  { key: "dragonfruit", level: 10, en: "Dragon fruit", zh: ["火龙果", "火龍果"], py: ["huǒlóngguǒ", "huǒlóngguǒ"] },
  { key: "lychee", level: 11, en: "Lychee", zh: ["荔枝", "荔枝"], py: ["lìzhī", "lìzhī"] },
  { key: "pomelo", level: 12, en: "Pomelo", zh: ["柚子", "柚子"], py: ["yòuzi", "yòuzi"] },
  { key: "starfruit", level: 13, en: "Star fruit", zh: ["杨桃", "楊桃"], py: ["yángtáo", "yángtáo"] },
  { key: "guava", level: 14, en: "Guava", zh: ["番石榴", "芭樂"], py: ["fānshíliu", "bālè"] },
  { key: "passionfruit", level: 15, en: "Passion fruit", zh: ["百香果", "百香果"], py: ["bǎixiāngguǒ", "bǎixiāngguǒ"] },
  { key: "persimmon", level: 16, en: "Persimmon", zh: ["柿子", "柿子"], py: ["shìzi", "shìzi"] },
  { key: "rambutan", level: 17, en: "Rambutan", zh: ["红毛丹", "紅毛丹"], py: ["hóngmáodān", "hóngmáodān"] },
  { key: "durian", level: 18, en: "Durian", zh: ["榴莲", "榴槤"], py: ["liúlián", "liúlián"] },
];

export const BACKGROUNDS = [
  ["#fdf1ea", "Peach"], ["#e0f4e0", "Mint"], ["#e3eef7", "Sky"],
  ["#f3e6f5", "Lilac"], ["#fff1c9", "Butter"], ["#f8dacd", "Apricot"],
];

const face = (y = 39, c = "#2a2420") =>
  `<circle cx="27" cy="${y}" r="1.8" fill="${c}"/><circle cx="37" cy="${y}" r="1.8" fill="${c}"/>` +
  `<path d="M28.5 ${y + 4.5} q3.5 3 7 0" stroke="${c}" stroke-width="1.8" fill="none" stroke-linecap="round"/>`;
const leaf = `<path d="M32 22 v-4" stroke="#6b4a2b" stroke-width="2.2" stroke-linecap="round"/><path d="M33 19 q8 -7 14 -1 q-7 6 -14 1z" fill="#1b6f1b"/>`;

function star(cx, cy, ro, ri) {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? ri : ro, a = -Math.PI / 2 + i * Math.PI / 5;
    pts.push(`${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`);
  }
  return pts.join(" ");
}

function spikes(cx, cy, r1, r2, n, color) {
  let d = "";
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    d += `M${(cx + r1 * Math.cos(a)).toFixed(1)} ${(cy + r1 * Math.sin(a)).toFixed(1)} q${(Math.cos(a + 0.6) * 3).toFixed(1)} ${(Math.sin(a + 0.6) * 3).toFixed(1)} ${((r2 - r1) * Math.cos(a)).toFixed(1)} ${((r2 - r1) * Math.sin(a)).toFixed(1)} `;
  }
  return `<path d="${d}" stroke="${color}" stroke-width="2.2" fill="none" stroke-linecap="round"/>`;
}

function kiwiSeeds() {
  let s = "";
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    s += `<ellipse cx="${(32 + 8.5 * Math.cos(a)).toFixed(1)}" cy="${(33 + 8.5 * Math.sin(a)).toFixed(1)}" rx="0.9" ry="1.6" transform="rotate(${(a * 180 / Math.PI + 90).toFixed(0)} ${(32 + 8.5 * Math.cos(a)).toFixed(1)} ${(33 + 8.5 * Math.sin(a)).toFixed(1)})" fill="#2a2420"/>`;
  }
  return s;
}

const ART = {
  orange: `<circle cx="32" cy="38" r="17" fill="#f7941d"/><circle cx="25" cy="31" r="3.5" fill="#ffc27a"/>${leaf}${face()}`,
  apple: `<path d="M32 25 c-6 -5 -18 -3 -18 11 c0 10 8 18 13 18 c2 0 3 -1 5 -1 s3 1 5 1 c5 0 13 -8 13 -18 c0 -14 -12 -16 -18 -11z" fill="#e5484d"/><path d="M32 25 v-6" stroke="#6b4a2b" stroke-width="2.2" stroke-linecap="round"/><path d="M33 20 q7 -6 12 -1 q-6 5 -12 1z" fill="#1b6f1b"/><circle cx="24" cy="31" r="3" fill="#f58a8d"/>${face()}`,
  peach: `<circle cx="32" cy="38" r="17" fill="#f9a8a0"/><path d="M32 22 q-6 8 -1 16" stroke="#e97f78" stroke-width="2" fill="none" stroke-linecap="round"/><path d="M32 22 q-9 -7 -14 -1 q7 5 14 1z" fill="#1b6f1b"/><circle cx="42" cy="32" r="3" fill="#fcc9c3"/>${face(40)}`,
  strawberry: `<path d="M32 55 C19 47 14 35 18 28 C21 23 27 23 32 25 C37 23 43 23 46 28 C50 35 45 47 32 55z" fill="#e8394b"/><path d="M22 25 q4 -6 10 -3 q6 -3 10 3 q-5 0 -10 2 q-5 -2 -10 -2z" fill="#2f8a3a"/><path d="M32 22 v-5" stroke="#2f8a3a" stroke-width="2.2" stroke-linecap="round"/>` +
    `<g fill="#ffe08a"><ellipse cx="22" cy="33" rx=".9" ry="1.4"/><ellipse cx="42" cy="33" rx=".9" ry="1.4"/><ellipse cx="24" cy="44" rx=".9" ry="1.4"/><ellipse cx="40" cy="44" rx=".9" ry="1.4"/><ellipse cx="32" cy="50" rx=".9" ry="1.4"/><ellipse cx="32" cy="31" rx=".9" ry="1.4"/></g>${face(38)}`,
  lemon: `<ellipse cx="32" cy="38" rx="19" ry="15" fill="#f5d442"/><ellipse cx="12.5" cy="38" rx="3" ry="2.5" fill="#e8c32a"/><ellipse cx="51.5" cy="38" rx="3" ry="2.5" fill="#e8c32a"/><path d="M34 23 q6 -7 12 -2 q-6 5 -12 2z" fill="#1b6f1b"/><circle cx="24" cy="32" r="3" fill="#fbe89a"/>${face(38)}`,
  mango: `<ellipse cx="32" cy="38" rx="15" ry="18" transform="rotate(-28 32 38)" fill="#f7a531"/><ellipse cx="38" cy="30" rx="8" ry="7" transform="rotate(-28 38 30)" fill="#f26b3a" opacity=".55"/><path d="M40 21 q8 -6 13 1 q-7 4 -13 -1z" fill="#1b6f1b"/>${face(40)}`,
  watermelon: `<path d="M11 28 h42 a21 21 0 0 1 -42 0z" fill="#2e8b3a"/><path d="M14.5 28 h35 a17.5 17.5 0 0 1 -35 0z" fill="#ef4b5c"/><ellipse cx="20" cy="33" rx="1.2" ry="2" fill="#2a2420"/><ellipse cx="44" cy="33" rx="1.2" ry="2" fill="#2a2420"/><ellipse cx="32" cy="44" rx="1.2" ry="2" fill="#2a2420"/>${face(33)}`,
  pineapple: `<path d="M32 28 l-9 -14 l7 5 l2 -9 l2 9 l7 -5z" fill="#1b6f1b"/><ellipse cx="32" cy="42" rx="13" ry="15" fill="#f2b632"/><path d="M22 33 l20 20 M20 42 l14 14 M27 28 l18 18 M42 33 l-20 20 M44 42 l-14 14 M37 28 l-18 18" stroke="#d18e14" stroke-width="1.3" fill="none"/>${face(42)}`,
  kiwi: `<circle cx="32" cy="38" r="18" fill="#8b6b3d"/><circle cx="32" cy="38" r="15.5" fill="#9ccc3c"/><circle cx="32" cy="33" r="5.5" fill="#f1f5c4"/>${kiwiSeeds()}${face(45)}`,
  cherry: `<path d="M23 34 q4 -14 13 -20 M41 36 q-2 -12 -5 -22" stroke="#6b4a2b" stroke-width="2" fill="none" stroke-linecap="round"/><path d="M36 14 q8 -5 13 1 q-7 4 -13 -1z" fill="#1b6f1b"/><circle cx="23" cy="42" r="10" fill="#d7263d"/><circle cx="41" cy="44" r="10" fill="#c81d34"/><circle cx="19" cy="38" r="2.4" fill="#f1707f"/><circle cx="37" cy="40" r="2.4" fill="#ea5a6c"/>` +
    `<circle cx="20" cy="43" r="1.5" fill="#2a2420"/><circle cx="26" cy="43" r="1.5" fill="#2a2420"/><path d="M21.2 46.5 q1.8 1.6 3.6 0" stroke="#2a2420" stroke-width="1.5" fill="none" stroke-linecap="round"/><circle cx="38" cy="45" r="1.5" fill="#2a2420"/><circle cx="44" cy="45" r="1.5" fill="#2a2420"/><path d="M39.2 48.5 q1.8 1.6 3.6 0" stroke="#2a2420" stroke-width="1.5" fill="none" stroke-linecap="round"/>`,
  coconut: `<circle cx="32" cy="40" r="17" fill="#7a4e2d"/><ellipse cx="32" cy="27" rx="12.5" ry="4.5" fill="#fbf6ec"/><ellipse cx="32" cy="27" rx="12.5" ry="4.5" fill="none" stroke="#5c3a20" stroke-width="1.6"/><path d="M36 26 l7 -14" stroke="#f06a8c" stroke-width="2.6" stroke-linecap="round"/><path d="M42 13 l3 -3" stroke="#f06a8c" stroke-width="2.6" stroke-linecap="round"/><circle cx="24" cy="36" r="2.6" fill="#94643c"/>${face(42, "#fff")}`,
  dragonfruit: `<path d="M32 18 q-3 -6 -8 -7 q3 5 3 9z M32 18 q3 -6 8 -7 q-3 5 -3 9z" fill="#5aa832"/><ellipse cx="32" cy="38" rx="15" ry="18" fill="#e0367d"/><path d="M17 30 q-5 -2 -7 -6 q6 0 9 3z M47 30 q5 -2 7 -6 q-6 0 -9 3z M18 45 q-5 1 -8 5 q6 1 9 -2z M46 45 q5 1 8 5 q-6 1 -9 -2z" fill="#5aa832"/>${face(38)}`,
  lychee: `<circle cx="32" cy="38" r="16.5" fill="#e2566b"/><g fill="#b8344b"><circle cx="22" cy="32" r="1.4"/><circle cx="42" cy="31" r="1.4"/><circle cx="20" cy="42" r="1.4"/><circle cx="44" cy="43" r="1.4"/><circle cx="32" cy="27" r="1.4"/><circle cx="27" cy="50" r="1.4"/><circle cx="38" cy="50" r="1.4"/></g><path d="M32 22 v-4" stroke="#6b4a2b" stroke-width="2.2" stroke-linecap="round"/><path d="M31 19 q-8 -6 -13 0 q6 5 13 0z" fill="#1b6f1b"/>${face(38)}`,
  pomelo: `<path d="M32 18 q-15 2 -18 18 q-2 19 18 20 q20 -1 18 -20 q-3 -16 -18 -18z" fill="#d6e05a"/><circle cx="23" cy="31" r="4" fill="#eef3a6"/><path d="M32 19 v-4" stroke="#6b4a2b" stroke-width="2.2" stroke-linecap="round"/><path d="M33 16 q8 -7 14 -1 q-7 6 -14 1z" fill="#1b6f1b"/>${face(40)}`,
  starfruit: `<polygon points="${star(32, 38, 20, 10)}" fill="#f4c430" stroke="#e0a91c" stroke-width="1.5" stroke-linejoin="round"/><path d="M32 18 v-4" stroke="#6b4a2b" stroke-width="2.2" stroke-linecap="round"/>${face(39)}`,
  guava: `<ellipse cx="32" cy="39" rx="16.5" ry="17" fill="#8cc152"/><circle cx="24" cy="31" r="3.5" fill="#b6dc84"/><path d="M32 22 v-4" stroke="#6b4a2b" stroke-width="2.2" stroke-linecap="round"/><path d="M33 19 q8 -7 14 -1 q-7 6 -14 1z" fill="#1b6f1b"/><path d="M30 56 l2 -2 l2 2" stroke="#5f8a2f" stroke-width="1.6" fill="none" stroke-linecap="round"/>${face(40)}`,
  passionfruit: `<circle cx="32" cy="38" r="17" fill="#5b2a5e"/><g fill="#8d5a90"><circle cx="21" cy="33" r="1.2"/><circle cx="43" cy="31" r="1.2"/><circle cx="22" cy="46" r="1.2"/><circle cx="42" cy="46" r="1.2"/><circle cx="32" cy="27" r="1.2"/><circle cx="32" cy="52" r="1.2"/></g><circle cx="25" cy="30" r="3" fill="#7e4882"/><path d="M32 22 v-4" stroke="#6b4a2b" stroke-width="2.2" stroke-linecap="round"/><path d="M33 19 q8 -7 14 -1 q-7 6 -14 1z" fill="#1b6f1b"/>${face(39, "#fff")}`,
  persimmon: `<ellipse cx="32" cy="39" rx="18.5" ry="15" fill="#ee7a2a"/><path d="M32 26 l-9 -3 l6 -2 l-2 -6 l5 4 l5 -4 l-2 6 l6 2z" fill="#1b6f1b"/><circle cx="24" cy="33" r="3" fill="#f6a066"/>${face(40)}`,
  rambutan: `${spikes(32, 39, 13.5, 19.5, 22, "#e65c5c")}<circle cx="32" cy="39" r="14" fill="#d63b3b"/>${spikes(32, 39, 18.5, 20, 22, "#7fbf3f")}<circle cx="26" cy="33" r="2.8" fill="#ec7272"/>${face(39)}`,
  durian: `<polygon points="32.0,16.0 36.1,21.5 42.5,18.8 43.3,25.7 50.2,26.5 47.5,32.9 53.0,37.0 47.5,41.1 50.2,47.5 43.3,48.3 42.5,55.2 36.1,52.5 32.0,58.0 27.9,52.5 21.5,55.2 20.7,48.3 13.8,47.5 16.5,41.1 11.0,37.0 16.5,32.9 13.8,26.5 20.7,25.7 21.5,18.8 27.9,21.5" fill="#8f9a2e"/><circle cx="32" cy="37" r="16" fill="#a9b43e"/><circle cx="27" cy="37" r="1.8" fill="#2a2420"/><circle cx="37" cy="37" r="1.8" fill="#2a2420"/><path d="M28.5 42.5 q3.5 -2.5 7 0" stroke="#2a2420" stroke-width="1.8" fill="none" stroke-linecap="round"/>`,
};

export function fruitSvg(key) {
  return `<svg viewBox="0 0 64 64" aria-hidden="true">${ART[key] || HOST_ART[key] || ART.orange}</svg>`;
}

export function fruitInfo(key) {
  return FRUITS.find((f) => f.key === key) || HOST_AVATARS.find((h) => h.key === key) || FRUITS[0];
}

export const STARTER_FRUITS = FRUITS.filter((f) => f.level === 1).map((f) => f.key);

// XP rules (also in the database: public.xp_events, xp_level, fruit_level).
export const XP_SESSION = 20, XP_STREAK = 50, XP_BOOTCAMP = 150;

export function levelFor(xp) {
  let lv = 1;
  for (let i = 0; i < LEVELS.length; i++) if (xp >= LEVELS[i]) lv = i + 1;
  return lv;
}

// Progress toward the next level and the fruit it unlocks.
export function progress(xp) {
  const lv = levelFor(xp);
  if (lv >= LEVELS.length) return { level: lv, max: true, pct: 100, toNext: 0, next: null };
  const from = LEVELS[lv - 1], to = LEVELS[lv];
  return {
    level: lv, max: false,
    pct: Math.round(((xp - from) / (to - from)) * 100),
    toNext: to - xp,
    next: FRUITS.find((f) => f.level === lv + 1) || null,
  };
}
