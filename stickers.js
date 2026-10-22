// Stickers: collected from bootcamps (or given by an admin), worn at the bottom-left of the avatar.
// Keys must match public.sticker_ok() in the database (migration ..._stickers.sql).
// "bootcamp" is a word that, when found in a bootcamp's title, suggests this sticker to the admin.
export const STICKERS = [
  {
    key: "boba", how: "Finish the Taiwanese Mini Bootcamp.", zh: ["珍珠奶茶", "珍珠奶茶"], en: "Bubble tea", bootcamp: "taiwan",
    svg: `<path d="M37 3 l-4 19" stroke="#e8505b" stroke-width="4.5" stroke-linecap="round"/>
      <path d="M15 19 h34 l-4.2 38 a5 5 0 0 1 -5 4.5 h-15.6 a5 5 0 0 1 -5 -4.5z" fill="#fff" stroke="#6b4a2b" stroke-width="2.6" stroke-linejoin="round"/>
      <path d="M16.6 29 h30.8 l-2.9 27.4 a3.5 3.5 0 0 1 -3.5 3.1 h-18 a3.5 3.5 0 0 1 -3.5 -3.1z" fill="#d9a777"/>
      <path d="M12.5 19 h39" stroke="#6b4a2b" stroke-width="4" stroke-linecap="round"/>
      <g fill="#3b2516"><circle cx="24" cy="54" r="3.2"/><circle cx="32" cy="55.5" r="3.2"/><circle cx="40" cy="54" r="3.2"/><circle cx="27.5" cy="48" r="3.2"/><circle cx="36" cy="48.5" r="3.2"/></g>
      <path d="M20 34 v12" stroke="#fff" stroke-width="2.4" stroke-linecap="round" opacity=".55"/>`,
  },
  {
    key: "tones", how: "Finish the Chinese Pronunciation Bootcamp.", zh: ["四声", "四聲"], en: "Four tones", bootcamp: "pronunciation",
    svg: `<path d="M6 13 a7 7 0 0 1 7 -7 h38 a7 7 0 0 1 7 7 v26 a7 7 0 0 1 -7 7 h-21 l-12 10 v-10 h-5 a7 7 0 0 1 -7 -7z" fill="#7d5a8c"/>
      <g stroke="#fff" stroke-width="3.8" stroke-linecap="round" stroke-linejoin="round" fill="none">
        <path d="M13 19 h8"/><path d="M25 32 l6 -13"/><path d="M35 21 l3 8 l4 -8"/><path d="M47 19 l4 13"/>
      </g>`,
  },
  {
    key: "lantern", how: "Given during special sessions and initiatives.", zh: ["灯笼", "燈籠"], en: "Lantern", bootcamp: "festival",
    svg: `<path d="M32 2 v6" stroke="#6b4a2b" stroke-width="2.6" stroke-linecap="round"/>
      <rect x="22" y="7" width="20" height="6" rx="2" fill="#f2b631"/>
      <ellipse cx="32" cy="31" rx="22" ry="19" fill="#d8352a"/>
      <path d="M32 12 v38 M21 14 q-7 17 0 34 M43 14 q7 17 0 34" stroke="#a8241c" stroke-width="2.2" fill="none"/>
      <rect x="22" y="49" width="20" height="6" rx="2" fill="#f2b631"/>
      <path d="M27 55 v7 M32 55 v8 M37 55 v7" stroke="#f2b631" stroke-width="2.4" stroke-linecap="round"/>`,
  },
  {
    key: "dumpling", how: "Given during special sessions and initiatives.", zh: ["饺子", "餃子"], en: "Dumpling", bootcamp: "food",
    svg: `<path d="M4 44 q28 -44 56 0 q-28 15 -56 0z" fill="#fffaf0" stroke="#c9b28a" stroke-width="2.8" stroke-linejoin="round"/>
      <path d="M15 27 q2.5 5 0 9 M24 20 q2.5 5 0 10 M33 18 q2.5 5 0 10 M42 21 q2.5 5 0 10 M50 28 q2 4 0 8" stroke="#c9b28a" stroke-width="2.4" fill="none" stroke-linecap="round"/>
      <path d="M12 46 q20 7 40 0" stroke="#efe3c8" stroke-width="3" fill="none" stroke-linecap="round"/>`,
  },
  {
    key: "brush", how: "Given during special sessions and initiatives.", zh: ["毛笔", "毛筆"], en: "Brush", bootcamp: "character",
    svg: `<path d="M47 4 l13 13 l-24 24 l-13 -13z" fill="#a8431a"/>
      <path d="M47 4 l13 13" stroke="#2a2420" stroke-width="3.5" stroke-linecap="round"/>
      <path d="M38 30 l-4 -4" stroke="#f2b631" stroke-width="3" stroke-linecap="round"/>
      <path d="M23 28 l13 13 l-5 5 q-11 8 -24 14 q6 -13 14 -24z" fill="#2a2420"/>`,
  },
  {
    key: "mooncake", how: "Given during special sessions and initiatives.", zh: ["月饼", "月餅"], en: "Mooncake", bootcamp: "culture",
    svg: `<circle cx="32" cy="32" r="27" fill="#d99a4e" stroke="#9a6326" stroke-width="2.8"/>
      <circle cx="32" cy="32" r="16" fill="none" stroke="#9a6326" stroke-width="2.4"/>
      <g fill="#9a6326"><circle cx="32" cy="9" r="3"/><circle cx="32" cy="55" r="3"/><circle cx="9" cy="32" r="3"/><circle cx="55" cy="32" r="3"/>
      <circle cx="15.7" cy="15.7" r="3"/><circle cx="48.3" cy="15.7" r="3"/><circle cx="15.7" cy="48.3" r="3"/><circle cx="48.3" cy="48.3" r="3"/></g>
      <text x="32" y="39" text-anchor="middle" font-family="'Noto Sans SC',sans-serif" font-size="19" font-weight="700" fill="#9a6326">月</text>`,
  },
  {
    key: "phone", how: "Be active on the Club Discord: ask questions, help other students, share what you're learning. A host gives it to you.",
    zh: ["手机", "手機"], en: "Smartphone", bootcamp: "discord",
    svg: `<rect x="17" y="3" width="30" height="58" rx="7" fill="#2a2420"/>
      <rect x="20.5" y="10" width="23" height="42" rx="2.5" fill="#5865f2"/>
      <path d="M28 5.5 h8" stroke="#6f625a" stroke-width="2" stroke-linecap="round"/>
      <circle cx="32" cy="56.5" r="2" fill="#6f625a"/>
      <path d="M25 20 h14 a2.5 2.5 0 0 1 2.5 2.5 v7 a2.5 2.5 0 0 1 -2.5 2.5 h-7 l-4 3.5 v-3.5 h-3 a2.5 2.5 0 0 1 -2.5 -2.5 v-7 a2.5 2.5 0 0 1 2.5 -2.5z" fill="#fff"/>
      <path d="M26 40 h12 M26 45 h8" stroke="#fff" stroke-width="2.4" stroke-linecap="round" opacity=".8"/>`,
  },
  {
    key: "heart", how: "Bring a friend into the Club.",
    zh: ["爱心", "愛心"], en: "Orange heart", bootcamp: "friend",
    svg: `<path d="M32 57 C 12 43 4 32 4 21 C 4 12 11 6 19 6 C 25 6 29.5 9.5 32 14 C 34.5 9.5 39 6 45 6 C 53 6 60 12 60 21 C 60 32 52 43 32 57 Z" fill="#f37a48" stroke="#d9612f" stroke-width="2.4" stroke-linejoin="round"/>
      <path d="M14 18 q2 -6 8 -6" stroke="#fff" stroke-width="3.2" fill="none" stroke-linecap="round" opacity=".7"/>`,
  },
  {
    key: "medal", how: "Finish first on a monthly leaderboard. Given automatically on the 1st of the next month.",
    zh: ["奖牌", "獎牌"], en: "Medal", bootcamp: "leaderboard",
    svg: `<path d="M19 3 h10 l7 20 h-10z" fill="#d8352a"/><path d="M45 3 h-10 l-7 20 h10z" fill="#1b6f1b"/>
      <circle cx="32" cy="40" r="19" fill="#f2b631" stroke="#c98d12" stroke-width="2.8"/>
      <circle cx="32" cy="40" r="12.5" fill="none" stroke="#c98d12" stroke-width="2"/>
      <text x="32" y="46.5" text-anchor="middle" font-family="'Noto Sans SC',sans-serif" font-size="18" font-weight="800" fill="#9a6a08">1</text>`,
  },
  {
    key: "founder", how: "Given to the Club's founding members.",
    zh: ["元老", "元老"], en: "Founding member", bootcamp: "founding",
    svg: `<defs><filter id="sealRough" x="-10%" y="-10%" width="120%" height="120%"><feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="7" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="1.3"/></filter></defs>
      <g filter="url(#sealRough)"><rect x="10" y="10" width="44" height="44" rx="3.5" fill="#c4302b"/>
      <path transform="translate(13 29.7) scale(0.038 -0.019)" fill="#fff8f0" d="M33 501H751L829 603Q829 603 844 592Q858 581 880 564Q902 546 926 526Q951 506 971 489Q967 473 941 473H41ZM135 753H675L751 849Q751 849 765 838Q779 828 800 812Q822 795 846 776Q869 758 888 741Q884 725 859 725H143ZM547 487H695Q695 478 695 467Q695 456 695 448V97Q695 85 701 80Q707 76 725 76H793Q808 76 822 76Q835 76 845 77Q855 77 860 80Q866 83 871 93Q878 104 887 126Q896 148 906 178Q917 208 929 244H939L942 84Q970 72 978 58Q987 44 987 22Q987 -7 968 -26Q949 -46 903 -56Q857 -65 775 -65H687Q631 -65 600 -54Q570 -44 558 -18Q547 9 547 58ZM278 487H443Q438 386 417 296Q396 206 350 130Q304 55 224 -2Q145 -59 22 -95L18 -86Q101 -33 152 30Q203 94 230 167Q258 240 268 320Q278 401 278 487Z"/>
      <path transform="translate(13 49.2) scale(0.038 -0.019)" fill="#fff8f0" d="M341 855 518 841Q517 831 510 824Q504 818 486 815V475H341ZM108 684H512L580 774Q580 774 592 764Q605 754 624 738Q644 723 665 705Q686 687 703 672Q699 656 674 656H116ZM34 494H770L840 584Q840 584 852 574Q865 564 884 548Q904 533 926 515Q947 497 965 482Q961 466 937 466H42ZM712 390 856 278Q848 270 832 268Q815 267 789 274Q738 253 670 234Q601 214 524 198Q448 182 371 172L368 183Q415 203 464 228Q514 253 560 282Q607 310 646 338Q685 366 712 390ZM279 410 455 396Q454 386 446 379Q438 372 421 369V80Q421 70 426 64Q430 59 442 56Q453 54 475 54H628Q662 54 693 54Q724 55 741 56Q756 57 766 60Q775 64 782 72Q794 86 809 115Q824 144 844 191H854L857 69Q892 58 904 45Q915 32 915 12Q915 -12 902 -28Q889 -45 856 -55Q823 -65 764 -70Q706 -74 614 -74H463Q394 -74 354 -65Q313 -56 296 -30Q279 -5 279 46ZM780 837 935 736Q929 728 920 725Q910 722 891 727Q827 643 738 556Q650 469 540 388Q429 306 298 237Q167 168 17 121L10 133Q138 197 255 282Q372 367 472 462Q572 558 650 654Q729 750 780 837Z"/></g>`,
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
