// Stickers: collected from bootcamps (or given by an admin), worn at the bottom-left of the avatar.
// Keys must match public.sticker_ok() in the database (migration ..._stickers.sql).
// "bootcamp" is a word that, when found in a bootcamp's title, suggests this sticker to the admin.
export const STICKERS = [
  {
    key: "boba", zh: ["珍珠奶茶", "珍珠奶茶"], en: "Bubble tea", bootcamp: "taiwan",
    svg: `<path d="M37 3 l-4 19" stroke="#e8505b" stroke-width="4.5" stroke-linecap="round"/>
      <path d="M15 19 h34 l-4.2 38 a5 5 0 0 1 -5 4.5 h-15.6 a5 5 0 0 1 -5 -4.5z" fill="#fff" stroke="#6b4a2b" stroke-width="2.6" stroke-linejoin="round"/>
      <path d="M16.6 29 h30.8 l-2.9 27.4 a3.5 3.5 0 0 1 -3.5 3.1 h-18 a3.5 3.5 0 0 1 -3.5 -3.1z" fill="#d9a777"/>
      <path d="M12.5 19 h39" stroke="#6b4a2b" stroke-width="4" stroke-linecap="round"/>
      <g fill="#3b2516"><circle cx="24" cy="54" r="3.2"/><circle cx="32" cy="55.5" r="3.2"/><circle cx="40" cy="54" r="3.2"/><circle cx="27.5" cy="48" r="3.2"/><circle cx="36" cy="48.5" r="3.2"/></g>
      <path d="M20 34 v12" stroke="#fff" stroke-width="2.4" stroke-linecap="round" opacity=".55"/>`,
  },
  {
    key: "tones", zh: ["四声", "四聲"], en: "Four tones", bootcamp: "pronunciation",
    svg: `<path d="M6 13 a7 7 0 0 1 7 -7 h38 a7 7 0 0 1 7 7 v26 a7 7 0 0 1 -7 7 h-21 l-12 10 v-10 h-5 a7 7 0 0 1 -7 -7z" fill="#7d5a8c"/>
      <g stroke="#fff" stroke-width="3.8" stroke-linecap="round" stroke-linejoin="round" fill="none">
        <path d="M13 19 h8"/><path d="M25 32 l6 -13"/><path d="M35 21 l3 8 l4 -8"/><path d="M47 19 l4 13"/>
      </g>`,
  },
  {
    key: "lantern", zh: ["灯笼", "燈籠"], en: "Lantern", bootcamp: "festival",
    svg: `<path d="M32 2 v6" stroke="#6b4a2b" stroke-width="2.6" stroke-linecap="round"/>
      <rect x="22" y="7" width="20" height="6" rx="2" fill="#f2b631"/>
      <ellipse cx="32" cy="31" rx="22" ry="19" fill="#d8352a"/>
      <path d="M32 12 v38 M21 14 q-7 17 0 34 M43 14 q7 17 0 34" stroke="#a8241c" stroke-width="2.2" fill="none"/>
      <rect x="22" y="49" width="20" height="6" rx="2" fill="#f2b631"/>
      <path d="M27 55 v7 M32 55 v8 M37 55 v7" stroke="#f2b631" stroke-width="2.4" stroke-linecap="round"/>`,
  },
  {
    key: "dumpling", zh: ["饺子", "餃子"], en: "Dumpling", bootcamp: "food",
    svg: `<path d="M4 44 q28 -44 56 0 q-28 15 -56 0z" fill="#fffaf0" stroke="#c9b28a" stroke-width="2.8" stroke-linejoin="round"/>
      <path d="M15 27 q2.5 5 0 9 M24 20 q2.5 5 0 10 M33 18 q2.5 5 0 10 M42 21 q2.5 5 0 10 M50 28 q2 4 0 8" stroke="#c9b28a" stroke-width="2.4" fill="none" stroke-linecap="round"/>
      <path d="M12 46 q20 7 40 0" stroke="#efe3c8" stroke-width="3" fill="none" stroke-linecap="round"/>`,
  },
  {
    key: "brush", zh: ["毛笔", "毛筆"], en: "Brush", bootcamp: "character",
    svg: `<path d="M47 4 l13 13 l-24 24 l-13 -13z" fill="#a8431a"/>
      <path d="M47 4 l13 13" stroke="#2a2420" stroke-width="3.5" stroke-linecap="round"/>
      <path d="M38 30 l-4 -4" stroke="#f2b631" stroke-width="3" stroke-linecap="round"/>
      <path d="M23 28 l13 13 l-5 5 q-11 8 -24 14 q6 -13 14 -24z" fill="#2a2420"/>`,
  },
  {
    key: "mooncake", zh: ["月饼", "月餅"], en: "Mooncake", bootcamp: "culture",
    svg: `<circle cx="32" cy="32" r="27" fill="#d99a4e" stroke="#9a6326" stroke-width="2.8"/>
      <circle cx="32" cy="32" r="16" fill="none" stroke="#9a6326" stroke-width="2.4"/>
      <g fill="#9a6326"><circle cx="32" cy="9" r="3"/><circle cx="32" cy="55" r="3"/><circle cx="9" cy="32" r="3"/><circle cx="55" cy="32" r="3"/>
      <circle cx="15.7" cy="15.7" r="3"/><circle cx="48.3" cy="15.7" r="3"/><circle cx="15.7" cy="48.3" r="3"/><circle cx="48.3" cy="48.3" r="3"/></g>
      <text x="32" y="39" text-anchor="middle" font-family="'Noto Sans SC',sans-serif" font-size="19" font-weight="700" fill="#9a6326">月</text>`,
  },
];

const BY_KEY = new Map(STICKERS.map((s) => [s.key, s]));
export const stickerInfo = (key) => BY_KEY.get(key) || null;
export function stickerSvg(key) {
  const s = BY_KEY.get(key);
  return s ? `<svg viewBox="0 0 64 64" aria-hidden="true">${s.svg}</svg>` : "";
}
// Suggest a sticker for a bootcamp title (admin can change it).
export function stickerForBootcamp(title) {
  const t = String(title || "").toLowerCase();
  return STICKERS.find((s) => t.includes(s.bootcamp))?.key || "";
}
