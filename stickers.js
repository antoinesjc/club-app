// Stickers: collected from bootcamps (or given by an admin), worn at the bottom-left of the avatar.
// Keys must match public.sticker_ok() in the database (migration ..._stickers.sql).
// "bootcamp" is a word that, when found in a bootcamp's title, suggests this sticker to the admin.
export const STICKERS = [
  {
    key: "boba", zh: ["珍珠奶茶", "珍珠奶茶"], en: "Bubble tea", bootcamp: "taiwan",
    svg: `<circle cx="32" cy="32" r="30" fill="#fde9d2"/>
      <path d="M36 6 l-4 20" stroke="#e8505b" stroke-width="4" stroke-linecap="round"/>
      <path d="M18 22 h28 l-3.5 32 a4 4 0 0 1 -4 3.5 h-13 a4 4 0 0 1 -4 -3.5z" fill="#fff" stroke="#6b4a2b" stroke-width="2.4" stroke-linejoin="round"/>
      <path d="M19.3 31 h25.4 l-2.4 22.6 a3 3 0 0 1 -3 2.7 h-14.6 a3 3 0 0 1 -3 -2.7z" fill="#d9a777"/>
      <path d="M16 22 h32" stroke="#6b4a2b" stroke-width="3.4" stroke-linecap="round"/>
      <g fill="#3b2516"><circle cx="25" cy="50" r="2.8"/><circle cx="31.5" cy="51.5" r="2.8"/><circle cx="38" cy="50" r="2.8"/><circle cx="28" cy="45" r="2.8"/><circle cx="35" cy="45.5" r="2.8"/></g>
      <circle cx="27" cy="37" r="1.5" fill="#3b2516"/><circle cx="37" cy="37" r="1.5" fill="#3b2516"/>
      <path d="M29.5 40 q2.5 2 5 0" stroke="#3b2516" stroke-width="1.6" fill="none" stroke-linecap="round"/>`,
  },
  {
    key: "tones", zh: ["四声", "四聲"], en: "Four tones", bootcamp: "pronunciation",
    svg: `<circle cx="32" cy="32" r="30" fill="#efe3f7"/>
      <path d="M12 18 a6 6 0 0 1 6 -6 h28 a6 6 0 0 1 6 6 v20 a6 6 0 0 1 -6 6 h-16 l-9 8 v-8 h-3 a6 6 0 0 1 -6 -6z" fill="#7d5a8c"/>
      <g stroke="#fff" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" fill="none">
        <path d="M17 22 h6"/><path d="M27 32 l5 -10"/><path d="M36 24 l2.5 6 l3 -6"/><path d="M45 22 l3 10"/>
      </g>`,
  },
  {
    key: "lantern", zh: ["灯笼", "燈籠"], en: "Lantern", bootcamp: "festival",
    svg: `<circle cx="32" cy="32" r="30" fill="#fde2dc"/>
      <path d="M32 6 v6" stroke="#6b4a2b" stroke-width="2.4" stroke-linecap="round"/>
      <rect x="24" y="11" width="16" height="5" rx="1.5" fill="#f2b631"/>
      <ellipse cx="32" cy="32" rx="17" ry="16" fill="#d8352a"/>
      <path d="M32 16 v32 M24 18 q-5 14 0 28 M40 18 q5 14 0 28" stroke="#a8241c" stroke-width="2" fill="none"/>
      <rect x="24" y="47" width="16" height="5" rx="1.5" fill="#f2b631"/>
      <path d="M29 52 v7 M32 52 v8 M35 52 v7" stroke="#f2b631" stroke-width="2" stroke-linecap="round"/>`,
  },
  {
    key: "dumpling", zh: ["饺子", "餃子"], en: "Dumpling", bootcamp: "food",
    svg: `<circle cx="32" cy="32" r="30" fill="#e3f1e6"/>
      <path d="M10 40 q22 -34 44 0 q-22 12 -44 0z" fill="#fffaf0" stroke="#c9b28a" stroke-width="2.4" stroke-linejoin="round"/>
      <path d="M20 26 q2 4 0 7 M27 21 q2 4 0 8 M34 20 q2 4 0 8 M41 24 q2 4 0 7" stroke="#c9b28a" stroke-width="2" fill="none" stroke-linecap="round"/>
      <circle cx="26" cy="38" r="1.6" fill="#2a2420"/><circle cx="38" cy="38" r="1.6" fill="#2a2420"/>
      <path d="M29.5 41 q2.5 2 5 0" stroke="#2a2420" stroke-width="1.6" fill="none" stroke-linecap="round"/>
      <circle cx="21" cy="41" r="2.4" fill="#f6a6a0" opacity=".7"/><circle cx="43" cy="41" r="2.4" fill="#f6a6a0" opacity=".7"/>`,
  },
  {
    key: "brush", zh: ["毛笔", "毛筆"], en: "Brush", bootcamp: "character",
    svg: `<circle cx="32" cy="32" r="30" fill="#e6eef3"/>
      <path d="M44 10 l8 8 l-20 20 l-8 -8z" fill="#a8431a"/>
      <path d="M44 10 l8 8" stroke="#2a2420" stroke-width="3" stroke-linecap="round"/>
      <path d="M24 30 l8 8 l-4 4 q-8 6 -16 10 q4 -8 10 -16z" fill="#2a2420"/>
      <path d="M12 52 q8 -2 14 2" stroke="#2a2420" stroke-width="2.6" fill="none" stroke-linecap="round"/>`,
  },
  {
    key: "mooncake", zh: ["月饼", "月餅"], en: "Mooncake", bootcamp: "culture",
    svg: `<circle cx="32" cy="32" r="30" fill="#fff1c9"/>
      <circle cx="32" cy="33" r="20" fill="#d99a4e" stroke="#9a6326" stroke-width="2.4"/>
      <circle cx="32" cy="33" r="12" fill="none" stroke="#9a6326" stroke-width="2"/>
      <g fill="#9a6326"><circle cx="32" cy="15" r="2.4"/><circle cx="32" cy="51" r="2.4"/><circle cx="14" cy="33" r="2.4"/><circle cx="50" cy="33" r="2.4"/>
      <circle cx="19.3" cy="20.3" r="2.4"/><circle cx="44.7" cy="20.3" r="2.4"/><circle cx="19.3" cy="45.7" r="2.4"/><circle cx="44.7" cy="45.7" r="2.4"/></g>
      <text x="32" y="38.5" text-anchor="middle" font-family="'Noto Sans SC',sans-serif" font-size="14" font-weight="700" fill="#9a6326">月</text>`,
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
