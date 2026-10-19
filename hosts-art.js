// Host avatars: original illustrations, only hosts and admins can pick them.
// Same 64×64 flat style as the fruits (fruits.js), drawn over the avatar's background colour.

export const HOST_AVATARS = [
  { key: "host-confucius", en: "Confucius", zh: ["孔子", "孔子"], py: ["Kǒngzǐ", "Kǒngzǐ"] },
  { key: "host-empress", en: "Empress", zh: ["皇后", "皇后"], py: ["huánghòu", "huánghòu"] },
  { key: "host-poet", en: "Poet", zh: ["诗人", "詩人"], py: ["shīrén", "shīrén"] },
  { key: "host-general", en: "General", zh: ["将军", "將軍"], py: ["jiāngjūn", "jiāngjūn"] },
  { key: "host-calligrapher", en: "Calligrapher", zh: ["书法家", "書法家"], py: ["shūfǎjiā", "shūfǎjiā"] },
  { key: "host-opera", en: "Opera star", zh: ["京剧演员", "京劇演員"], py: ["jīngjù yǎnyuán", "jīngjù yǎnyuán"] },
];

const SKIN = "#f6d2b0", INK = "#2a2420";
const eyes = (y = 33, c = INK) => `<circle cx="27.5" cy="${y}" r="1.6" fill="${c}"/><circle cx="36.5" cy="${y}" r="1.6" fill="${c}"/>`;
const smile = (y = 37.5) => `<path d="M29 ${y} q3 2.6 6 0" stroke="${INK}" stroke-width="1.6" fill="none" stroke-linecap="round"/>`;
const cheeks = (y = 36) => `<circle cx="24.5" cy="${y}" r="2" fill="#f4a3a0" opacity=".7"/><circle cx="39.5" cy="${y}" r="2" fill="#f4a3a0" opacity=".7"/>`;
const robe = (fill, collar) => `<path d="M8 64 C9 52 18 47 32 47 C46 47 55 52 56 64 Z" fill="${fill}"/>` +
  (collar ? `<path d="M25 47.5 L32 57 L39 47.5" fill="none" stroke="${collar}" stroke-width="3" stroke-linejoin="round"/>` : "");
const neck = `<rect x="28.5" y="42" width="7" height="7" rx="3" fill="${SKIN}"/>`;
const face = (cy = 34, r = 11.5) => `<ellipse cx="32" cy="${cy}" rx="${r}" ry="${r + 0.5}" fill="${SKIN}"/>`;

export const HOST_ART = {
  // Confucius: scholar's cap, long white beard, brown robe
  "host-confucius":
    robe("#8a5a2b", "#efe6d2") + neck + face(33) +
    `<path d="M21.5 33 q-1 13 10.5 19 q11.5 -6 10.5 -19 q-2 6 -10.5 7.5 q-8.5 -1.5 -10.5 -7.5z" fill="#f4f1ea"/>` +
    `<path d="M26.5 38.2 q5.5 -2.4 11 0" stroke="#d8d2c4" stroke-width="2.2" fill="none" stroke-linecap="round"/>` +
    `<path d="M25.5 32.2 q2 -1.6 4 0 M34.5 32.2 q2 -1.6 4 0" stroke="${INK}" stroke-width="1.6" fill="none" stroke-linecap="round"/>` +
    `<path d="M23.5 28 q2 -2 5 -1.2 M35.5 26.8 q3 -0.8 5 1.2" stroke="#e8e2d4" stroke-width="1.8" fill="none" stroke-linecap="round"/>` +
    `<rect x="19" y="17" width="26" height="7.5" rx="2" fill="${INK}"/><rect x="26" y="10" width="12" height="8" rx="2.5" fill="${INK}"/>` +
    `<rect x="19" y="21.5" width="26" height="2.2" fill="#5c4f47"/>`,

  // Empress: black hair, golden phoenix crown with beads, red robe
  "host-empress":
    robe("#c8102e", "#f2b632") + neck +
    `<ellipse cx="32" cy="29" rx="15" ry="13" fill="#2a2420"/>` + face(34, 11) +
    `<path d="M21 31 q2 -9 11 -9 q9 0 11 9 q-4 -5 -11 -5 q-7 0 -11 5z" fill="#2a2420"/>` +
    `<path d="M17 20 L22 11 L27 17 L32 8 L37 17 L42 11 L47 20 Q32 25 17 20 Z" fill="#f2b632" stroke="#d18e14" stroke-width="1" stroke-linejoin="round"/>` +
    `<circle cx="32" cy="15.5" r="2.4" fill="#c8102e"/><circle cx="23" cy="18" r="1.6" fill="#1f8a70"/><circle cx="41" cy="18" r="1.6" fill="#1f8a70"/>` +
    `<path d="M18.5 21 v8 M45.5 21 v8" stroke="#f2b632" stroke-width="1.4"/><circle cx="18.5" cy="30.5" r="1.8" fill="#f2b632"/><circle cx="45.5" cy="30.5" r="1.8" fill="#f2b632"/>` +
    eyes(33.5) + cheeks(37) + `<path d="M30 39 q2 1.6 4 0" stroke="#c8102e" stroke-width="2" fill="none" stroke-linecap="round"/>` +
    `<circle cx="32" cy="27.8" r="1.1" fill="#c8102e"/>`,

  // Poet: topknot with a hairpin, blue robe, crescent moon
  "host-poet":
    `<path d="M50 10 a7 7 0 1 0 5 11 a5.5 5.5 0 1 1 -5 -11z" fill="#fff1c9"/>` +
    robe("#4f7a94", "#e3eef7") + neck + face(34) +
    `<path d="M20.5 33 q0 -13 11.5 -13 q11.5 0 11.5 13 q-3 -7 -11.5 -7 q-8.5 0 -11.5 7z" fill="${INK}"/>` +
    `<ellipse cx="32" cy="17" rx="5" ry="4.5" fill="${INK}"/><path d="M24 16 L41 18" stroke="#a8741f" stroke-width="1.8" stroke-linecap="round"/>` +
    `<path d="M37 19 q6 4 4 12" stroke="#e3eef7" stroke-width="2" fill="none" stroke-linecap="round"/>` +
    eyes(34) + smile(38.5) + cheeks(37.5),

  // General: gold-and-red armour, helmet with a red plume, determined brows
  "host-general":
    robe("#a63d2f") +
    `<path d="M16 52 q16 -8 32 0 v12 h-32z" fill="#d6a23a"/><path d="M20 56 h24 M20 60 h24" stroke="#a87a1f" stroke-width="1.4"/>` +
    `<circle cx="32" cy="53.5" r="2.6" fill="#a63d2f"/>` + neck + face(34) +
    `<path d="M19.5 33 q0 -14 12.5 -14 q12.5 0 12.5 14 l-3 0 q-1 -9 -9.5 -9 q-8.5 0 -9.5 9z" fill="#d6a23a"/>` +
    `<path d="M19.5 33 v6 q0 2 2.5 2 M44.5 33 v6 q0 2 -2.5 2" stroke="#d6a23a" stroke-width="3" fill="none" stroke-linecap="round"/>` +
    `<rect x="30.5" y="12" width="3" height="8" fill="#a87a1f"/><path d="M32 13 q-9 -6 -4 -11 q2 5 4 6 q2 -1 4 -6 q5 5 -4 11z" fill="#d7263d"/>` +
    `<path d="M25 30.2 l4.5 1.4 M39 30.2 l-4.5 1.4" stroke="${INK}" stroke-width="1.8" stroke-linecap="round"/>` +
    eyes(33.5) + `<path d="M29.5 38.5 h5" stroke="${INK}" stroke-width="1.6" stroke-linecap="round"/>` +
    `<path d="M27 37 q-2 4 1 6 M37 37 q2 4 -1 6" stroke="${INK}" stroke-width="1.4" fill="none" stroke-linecap="round"/>`,

  // Calligrapher: green robe, holding a big brush with an ink stroke
  "host-calligrapher":
    robe("#3f6d5e", "#e0f4e0") + neck + face(34) +
    `<path d="M20.5 32 q0 -12 11.5 -12 q11.5 0 11.5 12 q-2 -5 -6 -6 q-5 3 -11 3 q-4 0 -6 3z" fill="${INK}"/>` +
    `<path d="M22 22 q10 -8 20 0" fill="none" stroke="#3f6d5e" stroke-width="3" stroke-linecap="round"/>` +
    eyes(34) + smile(38.5) + cheeks(37.5) +
    `<path d="M45 58 L54 24" stroke="#8a5a2b" stroke-width="3.2" stroke-linecap="round"/><path d="M53 25 q4 -6 3 -11 q-5 3 -6 10z" fill="${INK}"/>` +
    `<ellipse cx="45" cy="57" rx="4" ry="3" fill="${SKIN}"/>` +
    `<path d="M6 30 q4 -6 8 -1 q3 4 6 -2" stroke="${INK}" stroke-width="2.4" fill="none" stroke-linecap="round" opacity=".55"/>`,

  // Peking opera: painted face (red, white, black), decorated headdress with pom-poms
  "host-opera":
    robe("#7d5a8c", "#f2b632") + neck +
    `<ellipse cx="32" cy="34" rx="12" ry="12.5" fill="#d7263d"/>` +
    `<path d="M21 33 q5 -5 9 -1 q-1 6 -9 4z M43 33 q-5 -5 -9 -1 q1 6 9 4z" fill="#fff"/>` +
    `<path d="M21.5 29.5 q4 -4 9 -1.5 M42.5 29.5 q-4 -4 -9 -1.5" stroke="${INK}" stroke-width="2.4" fill="none" stroke-linecap="round"/>` +
    `<path d="M32 26 v8" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/>` +
    `<circle cx="26" cy="33.5" r="1.6" fill="${INK}"/><circle cx="38" cy="33.5" r="1.6" fill="${INK}"/>` +
    `<path d="M28 41 q4 3 8 0" stroke="${INK}" stroke-width="2" fill="none" stroke-linecap="round"/>` +
    `<path d="M18 26 q14 -14 28 0 q-14 -5 -28 0z" fill="${INK}"/><path d="M19 22 q13 -12 26 0" fill="none" stroke="#f2b632" stroke-width="3" stroke-linecap="round"/>` +
    `<circle cx="20" cy="18" r="3.4" fill="#d7263d"/><circle cx="32" cy="12" r="3.4" fill="#1f8a70"/><circle cx="44" cy="18" r="3.4" fill="#d7263d"/>` +
    `<circle cx="26" cy="14" r="2.2" fill="#f2b632"/><circle cx="38" cy="14" r="2.2" fill="#f2b632"/>`,
};
