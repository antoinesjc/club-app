import { createClient } from "./vendor/supabase.js?v=147";
import { FRUITS, HOST_AVATARS, SPECIAL_AVATARS, BACKGROUNDS, fruitSvg, fruitInfo, levelFor, progress, XP_SESSION, XP_STREAK, XP_BOOTCAMP } from "./fruits.js?v=147";
import { COUNTRIES } from "./countries.js?v=147";
import { toZhuyin } from "./zhuyin.js?v=147";
import { ORACLE, ORACLE_T } from "./course-oracle.js?v=147";
const XP_HONGBAO = 30;
const MEMBER_CODE = "MZCLUB_8634D";                    // 70% off materials in the shop (Antoine, 24 Oct 2026)
const SHOP_URL = "https://www.mandarinzest.com/shop";
import { STICKERS, STICKER_PAGES, MYSTERY_STICKERS, stickerInfo, stickerSvg, stickerForBootcamp } from "./stickers.js?v=147";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------
const SUPABASE_URL = "https://eypehvhcqzhwssydvrhn.supabase.co";
const SUPABASE_KEY = "sb_publishable_sFnX5WLyN96IvLDDRY96mw_6dJaG6BG";
const CLUB_PAGE = "https://www.mandarinzest.com/mandarin-zest-club";
const DISCORD_CHAT = "https://discord.com/channels/1560844923874443297/1561210422533820587";
// Same feed as the website's bootcamp cards (built daily from the bootcamp pages).
const BOOTCAMPS_FEED = "https://antoinesjc.github.io/Mandarin-Zest-Class-Calendar/bootcamps.json";
const BOOTCAMPS_PAGE = "https://www.mandarinzest.com/bootcamps";

const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: "mz-club-auth" },
});

// Session levels and categories: same as the website calendar (categories.js in Mandarin-Zest-Class-Calendar).
// Hosts set them per session in the Google Calendar description ("Level: Beginner", "Category: Conversation, Culture",
// "Host: Dorota"); the session-meta function writes them to sessions.skill_level and sessions.cats.
const SESSION_LEVELS = ["Beginner", "Intermediate", "Advanced", "All levels"];
const CATEGORIES = {
  conversation: { label: "Conversation", color: "#b4512a" },
  culture:      { label: "Culture",      color: "#a63d6b" },
  grammar:      { label: "Grammar",      color: "#3f63a3" },
  characters:   { label: "Characters",   color: "#7d5a8c" },
  bookclub:     { label: "Book club",    color: "#8a5a2b" },
  listening:    { label: "Listening",    color: "#2a7480" },
  reading:      { label: "Reading",      color: "#3f6d5e" },
  vocabulary:   { label: "Vocabulary",   color: "#8f6418" },
  noagenda:     { label: "No agenda",    color: "#6b6559" },
};
const LEVEL_OPTIONS = ["", "Complete beginner", "Beginner", "Lower intermediate", "Intermediate", "Upper intermediate", "Advanced", "Heritage learner", "Native"];
const BIO_MAX = 140;

const APP_BUILD = "v=123"; // bump with the other ?v= numbers (sed "s/v=N/v=N+1/g" catches this line too)
const state = {
  user: null,
  role: null,
  me: null,
  sessions: [],
  interests: new Map(), // session_id -> Set(user_id)
  profiles: new Map(),
  roles: new Map(),
  open: new Set(),      // expanded session ids
  login: { step: "email", email: "", error: "", busy: false },
  draft: null,          // unsaved profile edits
  loaded: false,
  installPrompt: null,
  attendance: new Map(), // session_id -> Set(user_id) (own rows for members, all for hosts)
  notes: new Map(),      // session_id -> session_notes row (published, or drafts for hosts)
  noteDraft: new Map(),  // host editing: session_id -> {vocab, body}
  push: { supported: false, subscribed: false, permission: "default" },
  board: [],             // leaderboard rows (members only, not hosts)
  awards: [],            // XP given by admins (own rows; all rows for admins)
  membersTab: "lb",      // "lb" leaderboard | "all" directory
  lbPeriod: "month",     // "month" | "all"
  stats: new Map(),      // user_id -> sessions attended
  view: (() => { try { return localStorage.getItem("mz-view") || "list"; } catch { return "list"; } })(),
  lvFilter: (() => { try { return localStorage.getItem("mz-lv") || ""; } catch { return ""; } })(),
  catFilters: (() => { try { return JSON.parse(localStorage.getItem("mz-cats") || "[]").filter((k) => typeof k === "string"); } catch { return []; } })(),
  calMonth: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  calPick: null,         // session id selected in the calendar
  bootcamps: null,       // null = not loaded, [] = none, "error"
};
const wide = () => matchMedia("(min-width: 900px)").matches;
const VAPID_PUBLIC = "BDzM2jJc6wlM2C39lLVzvrPCdUgr45MEH_3zRZIxetGlzAeJqmyCl5YGsAc2QozO-ECD38lJWeyQJD3lvOzrNY4";

const app = document.getElementById("app");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const trad = () => state.me?.script === "traditional";
// Pronunciation as each member chose it in their profile: pinyin (default) or zhuyin (bopomofo).
const zhuyin = () => state.me?.phonetic === "zhuyin";
const py = (s) => zhuyin() ? toZhuyin(s) : (s ?? "");
const pyName = () => zhuyin() ? "zhuyin" : "pinyin";
const zh = (pair) => (trad() ? pair[1] : pair[0]);
const tint = (hex, a) => {
  const n = parseInt(hex.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  const m = (c) => Math.round(c * a + 255 * (1 - a));
  return `rgb(${m(r)},${m(g)},${m(b)})`;
};
const catsOf = (s) => { const k = (s.cats || []).filter((x) => CATEGORIES[x]); return k.length ? k : ["noagenda"]; };
const cat = (s) => CATEGORIES[catsOf(s)[0]];
const catBadges = (s) => catsOf(s).map((k) => `<span class="chip" style="background:${CATEGORIES[k].color}">${esc(CATEGORIES[k].label)}</span>`).join("");
const levelBadge = (s) => (s.skill_level ? `<span class="chip lv">${esc(s.skill_level)}</span>` : "");
// Filters, like the website: one level ("All levels" sessions always match) + any number of categories.
function matchesFilter(s) {
  const lv = state.lvFilter, cs = state.catFilters;
  if (lv && s.skill_level && s.skill_level !== lv && s.skill_level !== "All levels") return false;
  if (cs.length && !catsOf(s).some((c) => cs.includes(c))) return false;
  return true;
}
const isHost = () => state.role === "host" || state.role === "admin";
const isAdmin = () => state.role === "admin";

// ---------- XP ----------
const myRow = () => state.board.find((r) => r.user_id === state.user?.id);
const myXp = () => myRow()?.total ?? 0;
const myLevel = () => (isHost() ? 18 : levelFor(myXp()));
const weekKey = (d) => {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); // back to Monday
  return Math.round(x.getTime() / 6048e5);
};
function myStreak() {
  const weeks = new Set(state.sessions.filter((s) => attended(s)).map((s) => weekKey(new Date(s.starts_at))));
  let w = weekKey(new Date());
  if (!weeks.has(w)) w -= 1; // this week isn't over yet
  let n = 0;
  while (weeks.has(w)) { n++; w--; }
  return n;
}
function rankList(period) {
  const k = period === "month" ? "month" : "total";
  return [...state.board].sort((a, b) => b[k] - a[k] || (a.name || "").localeCompare(b.name || ""));
}
function myRank(period) {
  const list = rankList(period), i = list.findIndex((r) => r.user_id === state.user.id);
  return i < 0 ? null : i + 1;
}

function toast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove("show"), 2600);
}

const ICON = {
  shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3 l8 3 v6 c0 4.5 -3.4 8 -8 9 c-4.6 -1 -8 -4.5 -8 -9 v-6z"/><path d="M9 12 l2 2 l4 -4"/></svg>',
  gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 11 l9 -7 l9 7 v9 a1 1 0 0 1 -1 1 h-5 v-6 h-6 v6 h-5 a1 1 0 0 1 -1 -1z"/></svg>',
  cal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10 h18 M8 3 v4 M16 3 v4"/></svg>',
  people: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20 a6.5 6.5 0 0 1 13 0"/><circle cx="17" cy="9" r="2.5"/><path d="M16 14 a5 5 0 0 1 6 5"/></svg>',
  me: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21 a8 8 0 0 1 16 0"/></svg>',
  video: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="6" width="12" height="12" rx="2"/><path d="M15 10 l6 -3 v10 l-6 -3"/></svg>',
  lock: '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11 V8 a4 4 0 0 1 8 0 v3"/></svg>',
  file: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3 H7 a2 2 0 0 0 -2 2 v14 a2 2 0 0 0 2 2 h10 a2 2 0 0 0 2 -2 V8z"/><path d="M14 3 v5 h5"/></svg>',
  download: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3 v12 M7 10 l5 5 l5 -5 M5 21 h14"/></svg>',
  chat: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12 a8 8 0 0 1 -11.6 7.1 L4 20.5 l1.4 -4.6 A8 8 0 1 1 21 12z"/><path d="M8.5 12 h.01 M12 12 h.01 M15.5 12 h.01"/></svg>',
  star: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3 l2.6 5.4 l5.9 .9 l-4.3 4.1 l1 5.9 l-5.2 -2.8 l-5.2 2.8 l1 -5.9 l-4.3 -4.1 l5.9 -.9z"/></svg>',
  notebook: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3 h11 a2 2 0 0 1 2 2 v14 a2 2 0 0 1 -2 2 h-11z"/><path d="M6 3 v18 M4 7 h4 M4 12 h4 M4 17 h4"/><path d="M10 8 h6 M10 12 h6"/></svg>',
  unlock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11 V7 a4 4 0 0 1 7.6 -1.7"/><path d="M12 15 v2"/></svg>',
  seedling: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21 v-9"/><path d="M12 12 C12 7.5 8.5 5 4 5 C4 9.5 7.5 12 12 12z"/><path d="M12 14 C12 10 15 7.5 20 7.5 C20 11.5 17 14 12 14z"/><path d="M8 21 h8"/></svg>',
  bell: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8 a6 6 0 0 1 12 0 c0 7 3 9 3 9 H3 s3 -2 3 -9"/><path d="M10.3 21 a1.94 1.94 0 0 0 3.4 0"/></svg>',
  phone: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="6" y="2" width="12" height="20" rx="3"/><path d="M11 18 h2"/></svg>',
};

// Tap (phone) or hover (desktop) explanations for stickers and special avatars.
const tipAttrs = (title, body) => ` data-tip="${esc(title)}" data-tip-body="${esc(body || "")}" tabindex="0" role="button" aria-label="${esc(title)}"`;
function stickerTip(key, uid) {
  const t = stickerInfo(key);
  if (!t) return "";
  const award = (state.stickerAwards || []).find((a) => a.user_id === uid && a.sticker === key);
  const isHostUser = uid && ["host", "admin"].includes(state.roles?.get(uid));
  const body = award?.reason ? `Given for: ${award.reason}.` : isHostUser ? "Hosts can wear every sticker." : t.how || "";
  return tipAttrs(`${t.en} ${zh(t.zh)}`, body);
}

function avatar(p, size, { locked = false, flag = true, fruit, bg, sticker } = {}) {
  const f = fruit || p?.fruit || "orange";
  const c = flag && !locked ? p?.country : "";
  const st = sticker !== undefined ? sticker : flag && !locked ? p?.sticker : "";
  const uid = p?.id || p?.user_id;
  const special = SPECIAL_AVATARS.find((x) => x.key === f);
  const hostTip = flag && !locked && size >= 64 && f.startsWith("host-") ? fruitInfo(f) : null;
  const specialTip = flag && !locked && size >= 64 && special ? special : null;
  return `<span class="av${locked ? " locked" : ""}" style="--s:${size}px;--bg-av:${esc(bg || p?.bg || "#fdf1ea")}">` +
    `<span class="disc"${hostTip ? tipAttrs(`${hostTip.en} ${zh(hostTip.zh)}`, "A special character only Club hosts can use.")
      : specialTip ? tipAttrs(`${specialTip.en} ${zh(specialTip.zh)}`, (state.avatarAwards || []).find((a) => a.user_id === uid && a.avatar === f)?.reason ? `Given for: ${(state.avatarAwards || []).find((a) => a.user_id === uid && a.avatar === f).reason}.` : specialTip.how) : ""}>${fruitSvg(f)}</span>` +
    (c ? `<img class="flag" src="flags/${esc(c)}.svg" alt="${esc(countryName(c))}" loading="lazy">` : "") +
    (st && stickerInfo(st) ? `<span class="stk"${stickerTip(st, uid)}>${stickerSvg(st)}</span>` : "") +
    (locked ? `<span class="lock">${ICON.lock}</span>` : "") + `</span>`;
}

const countryName = (code) => COUNTRIES.find((c) => c[0] === code)?.[1] || "";

// ---------- Dates ----------
const tzCity = (() => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone.split("/").pop().replace(/_/g, " "); } catch { return ""; }
})();
const fmtTime = (d) => d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const dayKey = (d) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
function dayName(d) {
  const today = new Date(), tom = new Date(Date.now() + 864e5);
  if (dayKey(d) === dayKey(today)) return "Today";
  if (dayKey(d) === dayKey(tom)) return "Tomorrow";
  return d.toLocaleDateString([], { weekday: "long", day: "numeric", month: "short" });
}
function relative(d) {
  const mins = Math.round((d - Date.now()) / 60000);
  if (mins <= 0) return "";
  if (mins < 60) return `in ${mins} min`;
  if (mins < 60 * 24) return `in ${Math.round(mins / 60)} h`;
  return "";
}
const isLive = (s) => {
  const now = Date.now(), a = Date.parse(s.starts_at), b = s.ends_at ? Date.parse(s.ends_at) : a + 3600e3;
  return now >= a - 10 * 60e3 && now < b;
};
const ended = (s) => (s.ends_at ? Date.parse(s.ends_at) : Date.parse(s.starts_at) + 3600e3) < Date.now();

function greeting() {
  const h = new Date().getHours();
  if (h < 11) return zh(["早上好", "早安"]);
  if (h < 18) return zh(["下午好", "午安"]);
  return zh(["晚上好", "晚上好"]);
}

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------
async function loadAll() {
  const since = new Date(Date.now() - 35 * 864e5).toISOString();
  const [ses, ints, profs, roles] = await Promise.all([
    sb.from("sessions").select("*").eq("cancelled", false).gte("starts_at", since).order("starts_at"),
    sb.from("interests").select("session_id, user_id"),
    sb.from("profiles").select("*"),
    sb.rpc("member_roles"),
  ]);
  for (const r of [ses, ints, profs, roles]) if (r.error) throw r.error;
  state.sessions = ses.data;

  let stats;
  let stk, worn;
  const [att, notes, board, awards] = await Promise.all([
    sb.from("attendance").select("session_id, user_id"),
    sb.from("session_notes").select("*"),
    sb.rpc("xp_board"),
    sb.from("xp_awards").select("*").order("awarded_at", { ascending: false }),
    sb.rpc("member_stats"),
    sb.from("sticker_awards").select("*").order("awarded_at", { ascending: false }),
    sb.rpc("board_stickers"),
    sb.from("bootcamp_rewards").select("*"),
    sb.rpc("member_bootcamps"),
    sb.rpc("session_hosts"),
    sb.from("host_meet_names").select("meet_name").eq("user_id", state.user.id).maybeSingle(),
    sb.rpc("hongbao_inbox"),
    sb.from("avatar_awards").select("*"),
    sb.from("hongbaos").select("*").eq("giver", state.user.id).order("created_at", { ascending: false }).limit(1),
  ]).then((r) => { const hg = r.pop(), aa = r.pop(), hi = r.pop(); state.avatarAwards = aa.error ? [] : aa.data; state.hbIn = hi.error ? [] : hi.data; state.hbGiven = hg.error ? null : hg.data[0] || null; const mn = r.pop(), sh = r.pop(); state.meetName = mn.error ? "" : mn.data?.meet_name || ""; state.sessionHost = new Map(sh.error ? [] : sh.data.map((x) => [x.session_id, x.host_id])); const mb = r.pop(); state.bootcampsJoined = new Map(mb.error ? [] : mb.data.map((x) => [x.user_id, x.bootcamps])); const rw = r.pop(); state.rewards = new Map(rw.error ? [] : rw.data.map((x) => [x.bootcamp, x])); worn = r.pop(); stk = r.pop(); stats = r.pop(); return r; });
  for (const r of [att, notes, board, awards]) if (r.error) throw r.error;
  if (!stats.error) state.stats = new Map(stats.data.map((x) => [x.user_id, x.sessions]));
  state.board = board.data;
  state.awards = awards.data;
  state.stickerAwards = stk.error ? [] : stk.data;
  state.worn = new Map(worn.error ? [] : worn.data.map((x) => [x.user_id, x.sticker]));
  for (const r of state.board) r.sticker = state.worn.get(r.user_id) || null;
  state.attendance = new Map();
  for (const a of att.data) {
    if (!state.attendance.has(a.session_id)) state.attendance.set(a.session_id, new Set());
    state.attendance.get(a.session_id).add(a.user_id);
  }
  state.notes = new Map(notes.data.map((n) => [n.session_id, n]));
  // Older sessions you attended or joined (for My sessions).
  const known = new Set(state.sessions.map((s) => s.id));
  const mine = new Set([...ints.data.filter((i) => i.user_id === state.user.id).map((i) => i.session_id),
    ...att.data.filter((a) => a.user_id === state.user.id).map((a) => a.session_id)]);
  const missing = [...mine].filter((id) => !known.has(id));
  if (missing.length) {
    const old = await sb.from("sessions").select("*").in("id", missing.slice(0, 300));
    if (!old.error) state.sessions = [...old.data, ...state.sessions].sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  }
  state.interests = new Map();
  for (const i of ints.data) {
    if (!state.interests.has(i.session_id)) state.interests.set(i.session_id, new Set());
    state.interests.get(i.session_id).add(i.user_id);
  }
  state.profiles = new Map(profs.data.map((p) => [p.id, p]));
  state.roles = new Map(roles.data.map((r) => [r.id, r.role]));
  state.me = state.profiles.get(state.user.id) || state.me;
  state.loaded = true;
  claimSeasonal();
  logOpen();
  ztCheckBeta();
  if (!isHost()) { rewardCheck(); nbCheersCheck(); }
}

// Reward pop-ups: level up (new fruit), new sticker, new character, XP given by the team.
// Each shows once per device; the first run on a device only sets the starting point.
function rewardCheck() {
  const q = state.rewardQueue = state.rewardQueue || [];
  const uid = state.user.id;
  try {
    const lv = myLevel(), seen = +(lsGet("mz-level") || 0);
    if (seen && lv > seen) { q.push({ kind: "level", lv, fruits: FRUITS.filter((x) => x.level > seen && x.level <= lv) }); nbPost("level", lv, String(lv)); }
    lsSet("mz-level", String(lv));
    const mine = myStickers(), raw = lsGet("mz-stickers"), had = raw ? JSON.parse(raw) : null;
    if (had) for (const k of mine.filter((k) => !had.includes(k))) q.push({ kind: "sticker", key: k });
    lsSet("mz-stickers", JSON.stringify(mine));
    const av = (state.avatarAwards || []).filter((a) => a.user_id === uid && a.avatar !== "corn"), avRaw = lsGet("mz-avatars");
    if (avRaw) { const hadAv = JSON.parse(avRaw); for (const a of av.filter((a) => !hadAv.includes(a.id))) q.push({ kind: "avatar", key: a.avatar, reason: a.reason }); }
    lsSet("mz-avatars", JSON.stringify(av.map((a) => a.id)));
    const xp = (state.awards || []).filter((a) => a.user_id === uid), mark = lsGet("mz-xpseen");
    if (mark) for (const a of xp.filter((a) => a.awarded_at > mark).reverse()) q.push({ kind: "xp", points: a.points, reason: a.reason });
    if (xp.length) lsSet("mz-xpseen", xp.reduce((m, a) => (a.awarded_at > m ? a.awarded_at : m), mark || ""));
    else if (!mark) lsSet("mz-xpseen", new Date().toISOString());
  } catch { /* storage off: no pop-ups */ }
}
function rewardOverlay() {
  const r = state.rewardQueue?.[0];
  if (!r) return "";
  let art, title, body;
  if (r.kind === "level") {
    const f = r.fruits.at(-1);
    art = f ? `<span class="av" style="--s:84px;--bg-av:#fff1c9"><span class="disc">${fruitSvg(f.key)}</span></span>` : "";
    title = `Level ${r.lv}! 🎉`;
    body = r.fruits.length ? `You unlocked ${r.fruits.map((x) => `<b>${esc(x.en)}</b> ${esc(zh(x.zh))}`).join(", ")}. Choose ${r.fruits.length > 1 ? "one" : "it"} in Me → Avatar customization.` : "Keep going!";
  } else if (r.kind === "sticker") {
    const i = stickerInfo(r.key);
    art = `<span class="stkbig" style="--z:84px">${stickerSvg(r.key)}</span>`;
    title = "New sticker!";
    body = `You got the <b>${esc(i?.en || r.key)}</b> sticker. It's now in your Sticker Gallery in Zest Town. Wear it on your avatar in Me → Avatar customization.`;
  } else if (r.kind === "avatar") {
    art = `<span class="av" style="--s:84px;--bg-av:#e0f4e0"><span class="disc">${fruitSvg(r.key)}</span></span>`;
    title = "New character unlocked!";
    body = `${r.reason ? esc(r.reason) + ". " : ""}Choose it in Me → Avatar customization.`;
  } else {
    art = `<span class="rwxp">+${r.points} XP</span>`;
    title = "You got XP!";
    body = r.reason ? esc(r.reason) : "A gift from the Mandarin Zest team.";
  }
  return `<div class="hbover" role="dialog" aria-modal="true" aria-labelledby="rwtitle"><div class="hbbox">
    <div class="rwart">${art}</div><h2 id="rwtitle">${title}</h2><p class="muted" style="margin:0">${body}</p>
    <button type="button" class="btn block" data-act="reward-ok">${state.rewardQueue.length > 1 ? "Next" : "太棒了！ Great"}</button></div></div>`;
}

// Seasonal unlocks (Thanksgiving: corn avatar + turkey sticker, 25-30 Nov, Taiwan time): the database decides.
async function claimSeasonal() {
  if (state.seasonalChecked) return;
  state.seasonalChecked = true;
  const { data, error } = await sb.rpc("claim_seasonal");
  if (error || !data?.new) return;
  const [st, av] = await Promise.all([sb.from("sticker_awards").select("*").order("awarded_at", { ascending: false }), sb.from("avatar_awards").select("*")]);
  if (!st.error) state.stickerAwards = st.data;
  if (!av.error) state.avatarAwards = av.data;
  if (!isHost()) state.seasonalPopup = data.event;
  render();
}
const myAvatars = (id = state.user?.id) => (state.avatarAwards || []).filter((a) => a.user_id === id).map((a) => a.avatar);
function seasonalOverlay() {
  if (state.seasonalPopup !== "thanksgiving") return "";
  return `<div class="hbover" role="dialog" aria-modal="true" aria-labelledby="sztitle">
    <div class="hbbox">
      <div class="row" style="gap:12px;justify-content:center"><span class="av" style="--s:72px;--bg-av:#e0f4e0"><span class="disc">${fruitSvg("corn")}</span></span><span class="stkbig" style="--z:64px">${stickerSvg("turkey")}</span></div>
      <h2 id="sztitle">Happy Thanksgiving!</h2>
      <p class="muted" style="margin:0">You unlocked the <b>corn</b> character and the <b>turkey</b> sticker. Find them in Me → Avatar customization.</p>
      <button type="button" class="btn block" data-act="seasonal-ok">Thanks!</button>
    </div></div>`;
}

const myStickers = (id = state.user?.id) => (state.stickerAwards || []).filter((a) => a.user_id === id).map((a) => a.sticker).filter((k) => stickerInfo(k));

async function startSession(user) {
  state.user = user;
  const { data, error } = await sb.rpc("start_session");
  if (error) throw error;
  state.role = data?.role ?? null;
  if (!state.role) return render();
  await loadAll();
  render();
  // Remember the member's time zone so notifications show the right time.
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz && state.me && state.me.timezone !== tz) {
      await sb.from("profiles").update({ timezone: tz }).eq("id", state.user.id);
      state.me.timezone = tz;
    }
  } catch { /* not important */ }
  checkPush();
}

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------
function loginView() {
  const L = state.login;
  const code = L.step === "code";
  return `<main class="login">
    <div class="hero">
      <img class="mascot" src="icons/mascot.svg" alt="Mandarin Zest mascot" width="190" height="190">
      <div class="eyebrow">Mandarin Zest Club</div>
      <h1>${code ? "Check your inbox" : "Welcome to the Club"}</h1>
      <p class="muted">${code
        ? `We sent a code to <b>${esc(L.email)}</b>. You stay logged in on this device afterwards.`
        : "Log in with the email of your Club membership."}</p>
    </div>
    ${code ? `
    <form class="stack" data-form="code" novalidate>
      <label class="field" for="code">Code from the email</label>
      <input id="code" class="input code-input" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]*" maxlength="10" required>
      ${L.error ? `<div class="error" role="alert">${L.error}</div>` : ""}
      <button class="btn block" ${L.busy ? "disabled" : ""}>${L.busy ? "Checking…" : "Log in"}</button>
      <div class="row between">
        <button type="button" class="linkbtn" data-act="login-back">Use another email</button>
        <button type="button" class="linkbtn" data-act="login-resend">Send a new code</button>
      </div>
      <p class="small muted">Can't find it? Check your spam folder. The email comes from Mandarin Zest Club.</p>
    </form>` : `
    <form class="stack" data-form="email" novalidate>
      <label class="field" for="email">Email</label>
      <input id="email" class="input" type="email" autocomplete="email" inputmode="email" value="${esc(L.email)}" required>
      ${L.error ? `<div class="error" role="alert">${L.error}</div>` : ""}
      <button class="btn block" ${L.busy ? "disabled" : ""}>${L.busy ? "Sending…" : "Send me a code"}</button>
      <p class="small muted" style="text-align:center">No password needed. Only for Club members.</p>
    </form>`}
    ${installHint()}
    <p class="small" style="text-align:center;margin:0">Not a member yet? <a href="${CLUB_PAGE}" target="_blank" rel="noopener">See the Club</a></p>
  </main>`;
}

async function sendCode(email) {
  const L = state.login;
  L.busy = true; L.error = ""; render();
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/send-code`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: SUPABASE_KEY },
      body: JSON.stringify({ email }),
    });
    const body = await res.json().catch(() => ({}));
    if (body.ok) { L.step = "code"; L.email = email; }
    else if (body.reason === "not_member") L.error = `This email isn't on the Club list. Use the email you paid with, or <a href="${CLUB_PAGE}" target="_blank" rel="noopener">join the Club</a>.`;
    else if (body.reason === "wait") { L.step = "code"; L.email = email; L.error = "A code was sent less than a minute ago. Use that one, or wait a minute and ask again."; }
    else if (body.reason === "bad_email") L.error = "That doesn't look like an email address.";
    else L.error = "Something went wrong. Please try again in a minute.";
  } catch {
    L.error = "No connection. Check your internet and try again.";
  }
  L.busy = false; render();
  document.getElementById(L.step === "code" ? "code" : "email")?.focus();
}

async function verifyCode(token) {
  const L = state.login;
  L.busy = true; L.error = ""; render();
  const { data, error } = await sb.auth.verifyOtp({ email: L.email, token, type: "email" });
  L.busy = false;
  if (error) {
    L.error = /expired/i.test(error.message) ? "That code has expired. Ask for a new one." : "That code doesn't match. Check the latest email and try again.";
    render(); document.getElementById("code")?.focus();
    return;
  }
  await startSession(data.user);
}

function notMemberView() {
  return `<main class="login">
    <div class="hero">
      <img class="mascot" src="icons/mascot.svg" alt="Mandarin Zest mascot" width="190" height="190">
      <h1>Your membership isn't active</h1>
      <p class="muted">${esc(state.user?.email)} isn't on the Club list right now. If you just renewed, wait a minute and try again, or contact us and we'll sort it out.</p>
    </div>
    <a class="btn block" href="${CLUB_PAGE}" target="_blank" rel="noopener">See the Club</a>
    <button class="btn ghost block" data-act="retry">Try again</button>
    <button class="linkbtn" data-act="logout">Log out</button>
  </main>`;
}

// ---------------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------------
const route = () => (location.hash.replace(/^#\/?/, "") || "home").split("/")[0];
const routeArg = () => decodeURIComponent((location.hash.replace(/^#\/?/, "").split("/").slice(1).join("/")) || "");
const hostLink = (s) => `#/host/${encodeURIComponent(s.id)}`;

function nav() {
  const r = route() === "host" ? "sessions" : route() === "member" ? "members" : route();
  const item = (id, label, icon) => `<a href="#/${id}" ${r === id ? 'aria-current="page"' : ""}>${icon}<span>${label}</span></a>`;
  return `<nav class="nav ${isBeta() ? "five" : ""}" aria-label="Main">
    <div class="brand"><img src="icons/logo.png" alt=""><span>MANDARIN ZEST CLUB</span></div>
    ${item("home", "Home", ICON.home)}${item("sessions", "My sessions", ICON.cal)}${item("notes", "My notes", ICON.notebook).replace("<a ", '<a class="deskonly" ')}${isBeta() ? item("learn", "Learning", ICON.tree) : ""}${item("members", "Members", ICON.people)}${item("bootcamps", "Bootcamps", ICON.seedling).replace("<a ", '<a class="deskonly" ')}${item("me", "Me", ICON.me)}${item("settings", "Settings", ICON.gear).replace("<a ", '<a class="deskonly" ')}${isAdmin() ? item("admin", "Admin", ICON.shield).replace("<a ", '<a class="deskonly" ') : ""}
    <a class="navchat" href="${DISCORD_CHAT}" target="_blank" rel="noopener">${ICON.chat}<span>Chat on Discord</span></a>
  </nav>`;
}

function render() {
  if (!state.user) { app.innerHTML = loginView(); return; }
  if (!state.role) { app.innerHTML = notMemberView(); return; }
  if (!state.loaded) return;
  const views = { home: homeView, sessions: mySessionsView, members: membersView, me: profileView, host: hostView, member: memberView, bootcamps: bootcampsView, unlocks: unlocksView, notes: notesView, settings: settingsView, admin: adminView, learn: learnView };
  const blocked = route() === "host" && !isHost();
  const view = blocked ? homeView : (views[route()] || homeView);
  const tour = tourOn(); // the welcome tour comes first; other pop-ups wait until it's closed
  app.innerHTML = `<div class="shell ${trad() ? "zh-trad" : ""}">${nav()}<main class="main" id="main">${view()}</main></div>${tour ? tourOverlay() : seasonalOverlay() || hongbaoOverlay()}`;
  if (!tour && state.pushAsk && !app.querySelector(".hbover")) app.insertAdjacentHTML("beforeend", pushOverlay());
  if (state.scrollTo) { const t = document.getElementById(state.scrollTo); state.scrollTo = null; if (t) setTimeout(() => t.scrollIntoView({ block: "start", behavior: "smooth" }), 60); }
  if (state.idea?.open) app.insertAdjacentHTML("beforeend", ideaOverlay());
  else if (!tour && state.rewardQueue?.length && !app.querySelector(".hbover")) app.insertAdjacentHTML("beforeend", rewardOverlay());
  wireMap();
  cgAfterRender();
  tmapAfterRender();
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------
const going = (s) => state.interests.get(s.id) || new Set();
const iAmIn = (s) => going(s).has(state.user.id);
const upcoming = () => state.sessions.filter((s) => !ended(s));

function goingLine(s) {
  const ids = [...going(s)];
  const me = ids.includes(state.user.id);
  const others = ids.length - (me ? 1 : 0);
  if (!ids.length) return "Be the first to join";
  if (me) return others ? `You + ${others} going` : "You're going";
  return `${ids.length} going`;
}

function goingAvatars(s, max = 5) {
  const ps = [...going(s)].map((id) => state.profiles.get(id)).filter(Boolean).slice(0, max);
  return ps.length ? `<span class="stackav">${ps.map((p) => avatar(p, 30, { flag: false })).join("")}</span>` : "";
}

function whoList(s) {
  const ids = [...going(s)];
  if (!ids.length) return `<div class="small muted">Nobody has said they're coming yet.</div>`;
  const known = ids.map((id) => state.profiles.get(id)).filter(Boolean);
  const hidden = ids.length - known.length;
  return `<div class="small" style="font-weight:700">Who's coming (${ids.length})</div>
    <div class="names">${known.map((p) => `<span>${avatar(p, 24, { flag: false })}${esc(p.display_name || "Member")}</span>`).join("")}
    ${hidden ? `<span style="padding-left:10px">+${hidden} not in the directory</span>` : ""}</div>`;
}

function inButton(s) {
  if (ended(s)) return "";
  const on = iAmIn(s);
  return `<button type="button" class="toggle" data-act="toggle-in" data-id="${esc(s.id)}" aria-pressed="${on}"${on ? ' title="Tap to say you can\'t make it" aria-label="Going. Tap to say you can\'t make it"' : ""}>${on ? "Going ✓" : "I'm in"}</button>`;
}

function details(s) {
  const lines = [];
  if (s.topic) lines.push(`<div><b>Topic:</b> ${esc(s.topic)}</div>`);
  if (s.about) lines.push(`<div>${esc(s.about)}</div>`);
  lines.push(`<div class="row" style="gap:6px;flex-wrap:wrap">${catBadges(s)}${levelBadge(s)}</div>`);
  if (s.host_name) lines.push(`<div><b>Host:</b> ${esc(s.host_name)}</div>`);
  const a = new Date(s.starts_at), b = s.ends_at ? new Date(s.ends_at) : null;
  lines.push(`<div class="muted">${esc(dayName(a))} · ${fmtTime(a)}${b ? `–${fmtTime(b)}` : ""}</div>`);
  if (isHost()) lines.push(whoList(s));
  else if (going(s).size) lines.push(`<div class="row">${goingAvatars(s, 8)}<span class="small muted">${goingLine(s)}</span></div>`);
  if (s.meet_url && !ended(s)) lines.push(`<a class="btn" href="${esc(s.meet_url)}" target="_blank" rel="noopener">${ICON.video}Join on Google Meet</a>`);
  if (isHost() && Date.parse(s.starts_at) <= Date.now() + 30 * 60e3) lines.push(`<a class="btn ghost" href="${hostLink(s)}">Attendance &amp; notes</a>`);
  return `<div class="sdetail">${lines.join("")}</div>`;
}

function sessionItem(s) {
  const c = cat(s), a = new Date(s.starts_at), open = state.open.has(s.id);
  const dow = a.toLocaleDateString([], { weekday: "short" }).toUpperCase();
  return `<div class="sitem">
    <div class="top">
      <button type="button" class="open" data-act="open" data-id="${esc(s.id)}" aria-expanded="${open}">
        <span class="datebox" style="background:${tint(c.color, .14)};color:${c.color}">
          <div class="dow">${esc(dow)}</div><div class="day">${a.getDate()}</div>
        </span>
        <span class="grow">
          <div class="stitle">${esc(s.title)}</div>
          <div class="smeta">${fmtTime(a)}${s.skill_level ? ` · ${esc(s.skill_level)}` : ""}${s.host_name ? ` · with ${esc(s.host_name)}` : ""} · ${goingLine(s)}</div>
        </span>
      </button>
      ${inButton(s)}
    </div>
    ${open ? details(s) : ""}
  </div>`;
}

function featured() {
  const list = upcoming();
  return list.find((s) => isLive(s) && iAmIn(s))
    || list.find((s) => iAmIn(s))
    || list.find((s) => isLive(s))
    || list[0];
}

// The host of a session: matched on their private Google Meet name, else on their display name.
function sessionHost(s) {
  const id = state.sessionHost?.get(String(s.id));
  if (id && state.profiles.get(id)) return state.profiles.get(id);
  const n = String(s.host_name || "").trim().toLowerCase();
  if (!n) return null;
  return [...state.profiles.values()].find((p) => ["host", "admin"].includes(state.roles.get(p.id))
    && String(p.display_name || "").trim().toLowerCase() === n) || null;
}
function hostRow(s) {
  if (!s.host_name && !state.sessionHost?.get(String(s.id))) return "";
  const p = sessionHost(s);
  const name = p?.display_name || s.host_name;
  const pic = p ? avatar(p, 44, { flag: false })
    : `<span class="av hostph" style="--s:44px" aria-hidden="true"><span class="disc"><svg viewBox="0 0 64 64"><circle cx="32" cy="25" r="10" fill="#d8c8bd"/><path d="M13 54 a19 17 0 0 1 38 0z" fill="#d8c8bd"/></svg></span></span>`;
  const inner = `${pic}<span class="grow"><span class="small muted" style="display:block">Your host</span><b>${esc(name)}</b></span>`;
  return p ? `<a class="hostline" href="#/member/${p.id}">${inner}</a>` : `<div class="hostline">${inner}</div>`;
}

function featuredCard(s) {
  if (!s) return `<div class="card"><h2>No sessions scheduled</h2><p class="muted small" style="margin:0">New sessions will show up here as soon as they're in the calendar.</p></div>`;
  const c = cat(s), a = new Date(s.starts_at), live = isLive(s);
  const rel = relative(a);
  return `<section class="card" aria-label="Next session">
    <div class="row" style="gap:8px;flex-wrap:wrap">
      ${catBadges(s)}${levelBadge(s)}
      ${live ? `<span class="live">Live now</span>` : `<span class="when">${esc(dayName(a))} · ${fmtTime(a)}${rel ? ` · ${rel}` : ""}</span>`}
    </div>
    <div class="session-title">${esc(s.title)}</div>
    ${s.topic ? `<div class="muted" style="font-size:14.5px">${esc(s.topic)}</div>` : ""}
    ${hostRow(s)}
    <div class="row">${goingAvatars(s)}<div class="small muted">${goingLine(s)}</div></div>
    <div class="row" style="flex-wrap:wrap;gap:8px">
      ${s.meet_url ? `<a class="btn grow" href="${esc(s.meet_url)}" target="_blank" rel="noopener">${ICON.video}Join on Google Meet</a>` : ""}
      ${iAmIn(s) ? (ended(s) ? "" : `<button type="button" class="btn ghost" data-act="toggle-in" data-id="${esc(s.id)}">Can't make it</button>`) : inButton(s)}
    </div>
    ${isHost() ? whoList(s) : ""}
    ${isHost() && Date.parse(s.starts_at) <= Date.now() + 30 * 60e3 ? `<a class="btn ghost" href="${hostLink(s)}">Attendance &amp; notes</a>` : ""}
  </section>`;
}

function grouped(list) {
  let out = "", last = "";
  for (const s of list) {
    const a = new Date(s.starts_at), k = dayKey(a);
    if (k !== last) { out += `<div class="daylabel">${esc(dayName(a))}</div>`; last = k; }
    out += sessionItem(s);
  }
  return out;
}

function xpCard() {
  const xp = myXp(), p = progress(xp), streak = myStreak(), rank = myRank("month");
  const idx = trad() ? 1 : 0;
  return `<a class="card green xpcard" href="#/me" aria-label="Your level and fruit">
    <div class="row">
      <div class="grow">
        <div style="font-size:13px;opacity:.85">Level ${p.level} · ${xp.toLocaleString()} XP</div>
        <div style="font-size:18px;font-weight:800;margin-top:2px">${p.max ? "Every fruit unlocked!" : `${p.toNext} XP to unlock ${esc(zh(p.next.zh))} <span class="pron">${esc(py(p.next.py[idx]))}</span>`}</div>
      </div>
      ${p.max ? avatar(state.me, 50, { flag: false }) : avatar(state.me, 50, { locked: true, flag: false, fruit: p.next.key })}
    </div>
    <div class="xpbar" role="progressbar" aria-label="Progress to the next level" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${p.pct}"><span style="width:${Math.max(3, p.pct)}%"></span></div>
    <div class="row" style="gap:8px;flex-wrap:wrap;font-size:13px;font-weight:600">
      <span class="pill">${streak ? `${streak}-week streak` : "Join a session to start a streak"}</span>
      ${rank && myRow()?.month > 0 ? `<span class="pill">#${rank} this month</span>` : ""}
    </div>
  </a>`;
}

// ---------- Bootcamps (from the website feed) ----------
async function loadBootcamps(force = false) {
  if (state.bootcamps && state.bootcamps !== "error" && !force) return;
  if (!state.bootReq) sb.from("bootcamp_requests").select("bootcamp, created_at").eq("user_id", state.user.id)
    .then(({ data }) => { state.bootReq = new Map((data || []).map((r) => [r.bootcamp, r.created_at])); if (route() === "bootcamps") render(); });
  try {
    const res = await fetch(BOOTCAMPS_FEED, { cache: "no-cache" });
    const data = await res.json();
    state.bootcamps = Array.isArray(data?.bootcamps) ? data.bootcamps : [];
  } catch {
    state.bootcamps = "error";
  }
  if (route() === "bootcamps") render();
}

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
function bootSortKey(b) {
  if (b.start) return b.start;
  const m = MONTHS.indexOf(String(b.month || b.dates || "").trim().toLowerCase());
  if (m < 0) return "9999";
  const now = new Date(), y = m < now.getMonth() ? now.getFullYear() + 1 : now.getFullYear();
  return `${y}-${String(m + 1).padStart(2, "0")}-15`;
}
function bootStatus(b) {
  const today = ymd(new Date());
  if (/closed|full/i.test(b.status || "")) return { label: b.status, open: false };
  if (b.status) return { label: b.status, open: /open/i.test(b.status) };
  if (b.signupBy && today <= b.signupBy) {
    const d = new Date(b.signupBy + "T12:00:00");
    return { label: `Sign-ups open until ${d.toLocaleDateString([], { day: "numeric", month: "short" })}`, open: true };
  }
  if (b.datesTbd || !b.start) return { label: `Coming ${b.month ? `in ${b.month}` : "soon"} · waitlist`, open: false };
  if (b.start > today) return { label: "Sign-ups closed", open: false };
  return null; // already running or over: not listed
}

const bootKey = (b) => b.url || b.title;
function rewardBlock(b) {
  const key = bootKey(b), rw = state.rewards?.get(key), admin = isAdmin();
  if (admin && state.rwEdit === key) {
    const d = state.rwDraft;
    return `<form class="bootreward edit" data-form="reward" data-k="${esc(key)}">
      <div class="row between" style="align-items:baseline"><b>What members earn</b><span class="small muted">Admin only</span></div>
      <label class="field">XP for finishing it<input class="input" name="xp" type="number" min="0" max="2000" step="10" value="${d.xp}"></label>
      <div><div style="font-weight:700;font-size:14.5px;margin-bottom:6px">Sticker it unlocks</div>
      <div class="stkpick">
        <button type="button" class="stkbtn" data-act="rw-stk" data-key="" aria-pressed="${!d.sticker}"><span class="stkbig none">—</span><span class="small">None</span></button>
        ${STICKERS.map((t) => `<button type="button" class="stkbtn" data-act="rw-stk" data-key="${t.key}" aria-pressed="${d.sticker === t.key}"><span class="stkbig">${stickerSvg(t.key)}</span><span class="small">${esc(t.en)}</span></button>`).join("")}
      </div></div>
      <div class="row" style="gap:10px"><button class="btn green grow">Save</button><button type="button" class="btn ghost" data-act="rw-cancel">Cancel</button></div>
    </form>`;
  }
  const t = rw?.sticker && stickerInfo(rw.sticker);
  const has = rw && (rw.xp > 0 || t);
  if (!has && !admin) return "";
  return `<div class="bootreward">
    ${has ? `${t ? `<span class="stkbig" style="--z:48px">${stickerSvg(rw.sticker)}</span>` : `<span class="xpbadge">XP</span>`}
      <div class="grow"><span class="lbl">Finish it and earn</span>
        <b>${[rw.xp > 0 ? `+${rw.xp} XP` : "", t ? `the ${esc(t.en)} sticker ${esc(zh(t.zh))}` : ""].filter(Boolean).join(" + ")}</b>
        ${t ? `<span class="small muted">A sticker for your avatar, only for people who did this bootcamp.</span>` : ""}</div>`
      : `<div class="grow small muted">No XP or sticker set for this bootcamp yet.</div>`}
    ${admin ? `<button type="button" class="linkbtn" data-act="rw-edit" data-k="${esc(key)}">${has ? "Edit" : "Set XP & sticker"}</button>` : ""}
  </div>`;
}

async function saveReward(form) {
  const key = form.dataset.k, d = state.rwDraft;
  const xp = Math.max(0, Math.min(2000, parseInt(form.xp.value || "0", 10) || 0));
  const row = { bootcamp: key, xp, sticker: d.sticker || null, updated_at: new Date().toISOString() };
  const { data, error } = await sb.from("bootcamp_rewards").upsert(row).select().single();
  if (error) { toast("Couldn't save."); return; }
  state.rewards.set(key, data); state.rwEdit = null;
  toast("Saved. Members see it on the card.");
  render();
}

// "Request to join": two steps (button, then confirm), then a thank-you. Emailed to contact@ by bootcamp-notify.
function bootRequest(b, st) {
  const key = bootKey(b), k = esc(key), more = b.url ? `<a class="btn ghost" href="${esc(b.url)}" target="_blank" rel="noopener">More info ↗</a>` : "";
  const sentAt = state.bootReq?.get(key);
  if (sentAt) return `<div class="bootreq done" role="status">${state.bootJust === key
      ? `<b>Thank you for your interest in the ${esc(b.title)}!</b> A host will be in touch with you by email soon to confirm your spot at the Club price.`
      : `<b>Request sent</b> on ${esc(new Date(sentAt).toLocaleDateString([], { day: "numeric", month: "short" }))}. A host will be in touch with you by email soon.`}</div>
    ${more ? `<div class="row">${more}</div>` : ""}`;
  if (state.bootAsk === key) return `<div class="bootreq ask">
      <p style="margin:0"><b>Send a request to join the ${esc(b.title)}?</b><br><span class="small">We'll email a host your name and email address, and they'll get back to you to sign you up at the Club price.</span></p>
      <div class="row" style="gap:10px;flex-wrap:wrap">
        <button type="button" class="btn green grow" data-act="boot-send" data-k="${k}" data-title="${esc(b.title)}" data-status="${esc(st.label)}">Yes, send my request</button>
        <button type="button" class="btn ghost" data-act="boot-cancel">Cancel</button>
      </div></div>`;
  return `<div class="row" style="gap:10px;flex-wrap:wrap">
      <button type="button" class="btn green grow" data-act="boot-ask" data-k="${k}"${state.bootReq ? "" : " disabled"}>Request to join</button>
      ${more}
    </div>
    <div class="small muted">A host will email you to sign you up at the Club price.</div>`;
}

function bootCard(b, st) {
  const today = ymd(new Date());
  const early = b.early && b.earlyEnds && today <= b.earlyEnds
    ? `Early bird ${esc(b.early)} until ${esc(new Date(b.earlyEnds + "T12:00:00").toLocaleDateString([], { day: "numeric", month: "short" }))}` : "";
  const facts = [["Dates", b.datesTbd ? `${b.month || "Dates"} (to be announced)` : b.dates], ["Time", b.time], ["Format", b.format],
    ["Level", b.level], ["Group", b.group],
    ["Sign up by", b.signupBy ? new Date(b.signupBy + "T12:00:00").toLocaleDateString([], { day: "numeric", month: "short" }) : ""]]
    .filter(([, v]) => v);
  return `<article class="bootcard">
    <div class="bootpic"${b.image ? ` style="background-image:url('${esc(b.image)}')"` : ""}>
      ${b.image ? "" : `<span class="bootglyph" aria-hidden="true">${/pronunc/i.test(b.title) ? "音" : /taiwan/i.test(b.title) ? "台" : /character|writ/i.test(b.title) ? "字" : "营"}</span>`}
      <span class="bootstatus${st.open ? " open" : ""}">${esc(st.label)}</span>
    </div>
    <div class="bootbody">
      <h2>${esc(b.title)}</h2>
      ${b.summary ? `<p class="muted" style="margin:0;line-height:1.5;font-size:14.5px">${esc(b.summary)}</p>` : ""}
      <div class="bootfacts">${facts.map(([k, v]) => `<div><span>${esc(k)}</span>${esc(v)}</div>`).join("")}</div>
      ${b.club ? `<div class="bootprice"><div class="grow"><span>Your Club price</span><b>${esc(b.club)}</b></div>
        <div class="small" style="text-align:right;line-height:1.5">${b.price ? `Standard <s>${esc(b.price)}</s>` : ""}${early ? `<br>${early}` : ""}</div></div>`
        : `<div class="bootprice pending small">Club price announced soon.</div>`}
      ${rewardBlock(b)}
      ${bootRequest(b, st)}
    </div>
  </article>`;
}

function bootcampsView() {
  if (state.bootcamps === null) loadBootcamps();
  const list = Array.isArray(state.bootcamps)
    ? state.bootcamps.map((b) => ({ b, st: bootStatus(b) })).filter((x) => x.st).sort((x, y) => bootSortKey(x.b).localeCompare(bootSortKey(y.b)))
    : [];
  return `
  <a class="ztback mobonly" href="#/home">‹ Home</a>
  <header><div class="eyebrow">Mandarin Zest Club</div><h1>Bootcamps</h1>
    <p class="muted" style="margin:6px 0 0;line-height:1.5;max-width:640px">Short, intensive courses run by our teachers. As a Club member you pay the Club price. To join, tap “Request to join” and a host will email you to sign you up.</p></header>
  ${state.bootcamps === null ? `<p class="muted small">Loading bootcamps…</p>`
    : state.bootcamps === "error" ? `<div class="card"><p class="small" style="margin:0">Couldn't load the bootcamps right now. <a href="${BOOTCAMPS_PAGE}" target="_blank" rel="noopener">See them on the website ↗</a></p></div>`
    : list.length ? `<div class="bootgrid">${list.map(({ b, st }) => bootCard(b, st)).join("")}</div>`
    : `<div class="card"><h2>No bootcamps planned right now</h2><p class="small muted" style="margin:0">New bootcamps will appear here as soon as they're on the website.</p></div>`}`;
}

// ---------- Month calendar (desktop) ----------
function calendarView() {
  if (!wide()) return phoneCalendar();
  const m = state.calMonth, y = m.getFullYear(), mo = m.getMonth();
  const first = new Date(y, mo, 1), start = new Date(y, mo, 1 - ((first.getDay() + 6) % 7));
  const byDay = new Map();
  for (const s of state.sessions) {
    if (s.cancelled || !matchesFilter(s)) continue;
    const k = dayKey(new Date(s.starts_at));
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k).push(s);
  }
  const today = dayKey(new Date());
  const weekdays = [...Array(7)].map((_, i) => new Date(2024, 0, 1 + i).toLocaleDateString([], { weekday: "short" }));
  let cells = "";
  for (let i = 0; i < 42; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    if (i === 35 && d.getMonth() !== mo) break; // 5 rows are enough this month
    const k = dayKey(d), list = byDay.get(k) || [];
    const chips = list.slice(0, 3).map((s) => {
      const c = cat(s), mine = iAmIn(s), past = ended(s);
      return `<button type="button" class="calchip${past ? " past" : ""}${state.calPick === s.id ? " on" : ""}" data-act="cal-open" data-id="${esc(s.id)}"
        style="--c:${c.color};--t:${tint(c.color, .14)}" title="${esc(s.title)}">${mine ? "✓ " : ""}<b>${fmtTime(new Date(s.starts_at))}</b> ${esc(s.title)}</button>`;
    }).join("");
    const more = list.length > 3 ? `<button type="button" class="calmore" data-act="cal-open" data-id="${esc(list[3].id)}">+${list.length - 3} more</button>` : "";
    cells += `<div class="calcell${d.getMonth() !== mo ? " out" : ""}${k === today ? " today" : ""}">
      <span class="calday">${d.getDate()}</span>${chips}${more}</div>`;
  }
  const pick = state.sessions.find((s) => s.id === state.calPick);
  return `<section class="cal" aria-label="Sessions calendar">
    <div class="row between calhead">
      <button type="button" class="xbtn" data-act="cal-move" data-v="-1" aria-label="Previous month">‹</button>
      <div class="row" style="gap:10px"><h2>${esc(first.toLocaleDateString([], { month: "long", year: "numeric" }))}</h2>
        <button type="button" class="linkbtn" data-act="cal-move" data-v="0">Today</button></div>
      <button type="button" class="xbtn" data-act="cal-move" data-v="1" aria-label="Next month">›</button>
    </div>
    <div class="calgrid">${weekdays.map((w) => `<div class="calwd">${esc(w)}</div>`).join("")}${cells}</div>
    <div class="legend">${Object.values(CATEGORIES).map((c) => `<span><i style="background:${c.color}"></i>${esc(c.label)}</span>`).join("")}<span>✓ you're in</span></div>
  </section>
  ${pick ? `<div class="slist">${sessionItem(pick)}</div>` : `<p class="small muted" style="margin:0">Click a session to see the details, who's coming and the Meet link.</p>`}`;
}

// Phone calendar: a compact month with coloured dots; tap a day to see its sessions below.
function phoneCalendar() {
  const m = state.calMonth, y = m.getFullYear(), mo = m.getMonth();
  const first = new Date(y, mo, 1), start = new Date(y, mo, 1 - ((first.getDay() + 6) % 7));
  const byDay = new Map();
  for (const s of state.sessions) {
    if (s.cancelled || !matchesFilter(s)) continue;
    const k = dayKey(new Date(s.starts_at));
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k).push(s);
  }
  const today = dayKey(new Date());
  const sel = state.calDay || today;
  const weekdays = [...Array(7)].map((_, i) => new Date(2024, 0, 1 + i).toLocaleDateString([], { weekday: "narrow" }));
  let cells = "";
  for (let i = 0; i < 42; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    if (i === 35 && d.getMonth() !== mo) break;
    const k = dayKey(d), list = byDay.get(k) || [];
    const mine = list.some(iAmIn);
    const dots = list.slice(0, 3).map((s) => `<i style="background:${cat(s).color}"></i>`).join("");
    cells += `<button type="button" class="pcday${d.getMonth() !== mo ? " out" : ""}${k === today ? " today" : ""}${k === sel ? " sel" : ""}${mine ? " mine" : ""}"
      data-act="cal-day" data-v="${k}" aria-label="${esc(d.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" }))}: ${list.length ? `${list.length} session${list.length === 1 ? "" : "s"}` : "no sessions"}${mine ? ", you're in" : ""}">
      <span class="n">${d.getDate()}</span><span class="dots">${dots}</span></button>`;
  }
  const dayList = (byDay.get(sel) || []).sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));
  const label = dayList.length ? dayName(new Date(dayList[0].starts_at)) : "";
  return `<section class="cal pcal" aria-label="Sessions calendar">
    <div class="row between calhead">
      <button type="button" class="xbtn" data-act="cal-move" data-v="-1" aria-label="Previous month">‹</button>
      <div class="row" style="gap:10px"><h2>${esc(first.toLocaleDateString([], { month: "long", year: "numeric" }))}</h2>
        <button type="button" class="linkbtn" data-act="cal-move" data-v="0">Today</button></div>
      <button type="button" class="xbtn" data-act="cal-move" data-v="1" aria-label="Next month">›</button>
    </div>
    <div class="pcgrid">${weekdays.map((w) => `<div class="calwd">${esc(w)}</div>`).join("")}${cells}</div>
    <div class="small muted">Dots show sessions (colour = category). A green ring means you're in.</div>
  </section>
  ${dayList.length ? `<div class="daylabel">${esc(label)}</div><div class="slist">${dayList.map(sessionItem).join("")}</div>`
    : `<p class="small muted" style="margin:0">No sessions on this day. Tap a day with dots.</p>`}`;
}

function homeView() {
  const me = state.me, f = featured();
  const filtered = !!(state.lvFilter || state.catFilters.length);
  const rest = upcoming().filter((s) => s !== f && matchesFilter(s)).slice(0, 14);
  return `
  <header class="homehead">
    <div class="row homehello" style="gap:14px;align-items:center">
      <a href="#/me" aria-label="My profile" style="border-radius:50%;flex:none">${avatar(me, wide() ? 60 : 48)}</a>
      <div class="grow">
        <div class="eyebrow">Mandarin Zest Club</div>
        <h1>${greeting()}, ${esc(me?.display_name || "friend")}!</h1>
      </div>
    </div>
    ${isBeta() ? wodCard() : ""}
  </header>
  ${isHost() ? "" : xpCard()}
  ${featuredCard(f)}
  <a class="bootsquare" href="#/bootcamps">${ICON.seedling}<span class="grow"><b>Explore our bootcamps</b><br><span class="small">Short, intensive courses at the Club price</span></span><span aria-hidden="true" style="font-size:22px">›</span></a>
  ${installHint()}
  <div class="row between" style="align-items:center;flex-wrap:wrap;gap:8px">
    <h2>${state.view === "cal" ? "Calendar" : "Coming up"}</h2>
    <div class="row" style="gap:10px">
      ${tzCity ? `<span class="small muted">Times in ${esc(tzCity)}</span>` : ""}
      <div class="seg viewswitch" role="group" aria-label="View">
        <button type="button" data-act="view" data-v="list" aria-pressed="${state.view !== "cal"}">List</button>
        <button type="button" data-act="view" data-v="cal" aria-pressed="${state.view === "cal"}">Calendar</button>
      </div>
    </div>
  </div>
  <div class="filters" role="group" aria-label="Filter sessions">
    <div class="frow"><span class="flabel">Level</span><div class="catfilter">
      <button type="button" data-act="lvf" data-v="" aria-pressed="${!state.lvFilter}">Any level</button>
      ${SESSION_LEVELS.filter((l) => l !== "All levels").map((l) => `<button type="button" data-act="lvf" data-v="${l}" aria-pressed="${state.lvFilter === l}">${l}</button>`).join("")}
    </div></div>
    <div class="frow"><span class="flabel">Category</span><div class="catfilter">
      <button type="button" data-act="catf" data-v="" aria-pressed="${!state.catFilters.length}">All</button>
      ${Object.entries(CATEGORIES).map(([k, c]) => `<button type="button" data-act="catf" data-v="${k}" aria-pressed="${state.catFilters.includes(k)}" style="--c:${c.color}"><i></i>${esc(c.label)}</button>`).join("")}
    </div></div>
    ${filtered ? `<button type="button" class="linkbtn" data-act="clearf" style="align-self:flex-start;padding:2px 0">Clear filters</button>` : ""}
  </div>
  ${state.view === "cal" ? calendarView()
    : `<div class="slist">${rest.length ? grouped(rest) : `<p class="muted small">${filtered ? "No upcoming sessions match these filters. Try another level or category." : "Nothing else planned yet."}</p>`}</div>`}`;
}

const attended = (s, uid = state.user.id) => (state.attendance.get(s.id) || new Set()).has(uid);
const published = (s) => !!state.notes.get(s.id)?.published_at;

function linkify(text) {
  return esc(text).replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)])/g, '<a href="$1" target="_blank" rel="noopener">$1</a>').replace(/\n/g, "<br>");
}

function notesBlock(s) {
  const n = state.notes.get(s.id);
  if (!n?.published_at) return `<div class="small muted">No notes yet. You'll get a notification when your host shares them.</div>`;
  const vocab = (n.vocab || []).filter((v) => v.hanzi || v.pinyin || v.meaning);
  const A = isBeta() && state.lu?.noteAdd?.sid === s.id ? state.lu.noteAdd : null;
  const deck = isBeta() && state.lu?.loaded ? new Set(state.lu.cards.flatMap((c) => [c.hanzi, c.hanzi_trad].filter(Boolean))) : null;
  const inDeck = (v) => deck && deck.has((v.hanzi || "").trim());
  return `
    ${vocab.length ? `<div class="vocab ${A?.mode === "pick" ? "picking" : ""}" role="table" aria-label="Vocabulary">${vocab.map((v, i) => {
      const box = A?.mode === "pick" && v.hanzi ? (inDeck(v) ? `<span class="vtick done" title="Already in your flashcards">✓</span>` : `<button type="button" class="vtick ${A.picked.has(i) ? "on" : ""}" data-zt="note-tick" data-i="${i}" aria-label="Choose ${esc(v.hanzi)}" aria-pressed="${A.picked.has(i)}"></button>`) : "";
      return `<div class="vrow" role="row">${box}<span class="vz" role="cell">${esc(v.hanzi)}</span><span class="vp" role="cell">${esc(py(v.pinyin))}</span><span class="vm" role="cell">${esc(v.meaning)}${v.hsk?.level ? ` <span class="hskchip">HSK ${esc(v.hsk.level)}</span>` : ""}</span></div>`;
    }).join("")}</div>` : ""}
    ${vocab.length && isBeta() ? noteAddBar(s, vocab, A, inDeck) : ""}
    ${n.body ? `<div class="notebody">${linkify(n.body)}</div>` : ""}
    <div class="row" style="gap:8px;flex-wrap:wrap">
      <button type="button" class="btn ghost" data-act="notes-pdf" data-id="${esc(s.id)}">${ICON.download}Download PDF</button>
      ${isHost() ? `<a class="btn ghost" href="${hostLink(s)}">✎ Edit notes</a>` : ""}
    </div>`;
}
// "Add to flashcards" on session notes (Zest Town beta): all words, HSK words only, or chosen words.
function noteAddBar(s, vocab, A, inDeck) {
  if (!state.lu.loaded) { ztLoad(); }
  const words = vocab.filter((v) => (v.hanzi || "").trim());
  const left = words.filter((v) => !inDeck(v)), hskLeft = left.filter((v) => v.hsk);
  const sid = esc(s.id);
  if (!state.lu.loaded) return `<div class="small muted">Loading your flashcards…</div>`;
  if (!left.length) return `<div class="noteadd done">✓ All ${words.length} words are in your flashcards</div>`;
  if (A?.mode === "pick") return `<div class="noteadd pick"><span class="grow small">${A.picked.size ? `${A.picked.size} word${A.picked.size === 1 ? "" : "s"} chosen` : "Tick the words to add"}</span>
    <button type="button" class="btn ghost small" data-zt="note-add" data-v="cancel" data-id="${sid}">Cancel</button>
    <button type="button" class="btn green small" data-zt="note-add" data-v="picked" data-id="${sid}" ${A.picked.size ? "" : "disabled"}>Add ${A.picked.size || ""} to flashcards</button></div>`;
  if (A?.mode === "menu") return `<div class="noteadd menu" role="group" aria-label="Add to flashcards">
    <button type="button" data-zt="note-add" data-v="all" data-id="${sid}"><b>Add all words</b><span>${left.length} word${left.length === 1 ? "" : "s"}</span></button>
    <button type="button" data-zt="note-add" data-v="hsk" data-id="${sid}" ${hskLeft.length ? "" : "disabled"}><b>Add HSK words only</b><span>${hskLeft.length ? `${hskLeft.length} on the HSK lists` : "None on the HSK lists"}</span></button>
    <button type="button" data-zt="note-add" data-v="pick" data-id="${sid}"><b>Choose words…</b><span>Tick the ones you want</span></button>
    <button type="button" class="link small" data-zt="note-add" data-v="cancel" data-id="${sid}">Cancel</button></div>`;
  return `<div class="row" style="gap:8px;align-items:center;flex-wrap:wrap"><button type="button" class="btn green" data-zt="note-add" data-v="menu" data-id="${sid}">＋ Add to flashcards</button>
    ${left.length < words.length ? `<span class="small muted">${words.length - left.length} of ${words.length} already in your flashcards</span>` : ""}</div>`;
}
async function noteAddWords(sid, items) {
  const L = state.lu, have = new Set(L.cards.flatMap((c) => [c.hanzi, c.hanzi_trad].filter(Boolean)));
  const list = items.filter((v) => !have.has(v.hanzi.trim())).filter((v, i, a) => a.findIndex((x) => x.hanzi.trim() === v.hanzi.trim()) === i);
  if (!list.length) return 0;
  const ids = list.map((v) => v.hsk?.id).filter(Boolean);
  const hsk = new Map();
  if (ids.length) { const { data } = await sb.from("hsk_words").select("id, hanzi, hanzi_trad, level").in("id", ids); for (const w of data || []) hsk.set(w.id, w); }
  const rows = list.map((v) => { const w = v.hsk && hsk.get(v.hsk.id);
    return { hanzi: w ? w.hanzi : v.hanzi.trim(), hanzi_trad: w?.hanzi_trad || null, pinyin: v.pinyin || "", meaning: v.meaning || "", hsk_level: v.hsk?.level || null, session_id: sid, source: "session" }; });
  const { data, error } = await sb.from("learn_cards").upsert(rows, { onConflict: "user_id,hanzi", ignoreDuplicates: true }).select("*");
  if (error) { toast("Couldn't add those words. Check your connection."); return 0; }
  L.cards.push(...data);
  return data.length;
}
document.addEventListener("click", async (e) => {
  const el = e.target.closest('[data-zt="note-add"], [data-zt="note-tick"]');
  if (!el) return;
  const L = state.lu;
  if (el.dataset.zt === "note-tick") { const i = +el.dataset.i; L.noteAdd.picked.has(i) ? L.noteAdd.picked.delete(i) : L.noteAdd.picked.add(i); render(); return; }
  const sid = el.dataset.id, v = el.dataset.v, vocab = (state.notes.get(sid)?.vocab || []).filter((x) => x.hanzi || x.pinyin || x.meaning);
  if (v === "menu" || v === "pick") { L.noteAdd = { sid, mode: v, picked: new Set() }; render(); return; }
  if (v === "cancel") { L.noteAdd = null; render(); return; }
  const items = (v === "all" ? vocab : v === "hsk" ? vocab.filter((x) => x.hsk) : vocab.filter((x, i) => L.noteAdd?.picked.has(i))).filter((x) => (x.hanzi || "").trim());
  el.disabled = true;
  const n = await noteAddWords(sid, items);
  L.noteAdd = null;
  toast(n ? `Added ${n} word${n === 1 ? "" : "s"} to your flashcards.` : "Those words are already in your flashcards.");
  render();
});


// ---------------------------------------------------------------------------
// My notes (desktop): every session you attended, most recent first, with its notes and a search box
// ---------------------------------------------------------------------------
async function loadNoteSessions() {
  if (state.notesLoading || state.notesLoaded) return;
  state.notesLoading = true;
  await Promise.resolve(); // let the current render finish first
  const have = new Set(state.sessions.map((x) => x.id));
  const want = isHost()
    ? [...state.notes.keys()]
    : [...state.attendance.entries()].filter(([, set]) => set.has(state.user.id)).map(([sid]) => sid);
  const missing = want.filter((id) => !have.has(id));
  state.extraSessions = [];
  for (let i = 0; i < missing.length; i += 100) {
    const { data } = await sb.from("sessions").select("*").in("id", missing.slice(i, i + 100));
    if (data) state.extraSessions.push(...data);
  }
  state.notesLoading = false; state.notesLoaded = true;
  if (route() === "notes") render();
}
function noteSearchText(s) {
  const n = state.notes.get(s.id);
  return [s.title, s.host_name, ...catsOf(s).map((k) => CATEGORIES[k].label),
    ...(n?.published_at || isHost() ? [(n?.vocab || []).map((v) => `${v.hanzi} ${v.pinyin} ${v.meaning}`).join(" "), n?.body || ""] : [])]
    .join(" ").toLowerCase();
}
function notesView() {
  if (!state.notesLoaded) { loadNoteSessions(); return `<header><div class="eyebrow">Mandarin Zest Club</div><h1>My notes</h1></header><p class="muted small">Loading your sessions…</p>`; }
  const all = [...state.sessions, ...(state.extraSessions || [])];
  const seen = new Set();
  const list = all.filter((s) => !seen.has(s.id) && seen.add(s.id))
    .filter((s) => ended(s) && (isHost() ? state.notes.has(s.id) : attended(s)))
    .sort((a, b) => Date.parse(b.starts_at) - Date.parse(a.starts_at));
  const withNotes = list.filter(published).length;
  const item = (s) => {
    const a = new Date(s.starts_at), n = state.notes.get(s.id), open = state.open.has("n:" + s.id);
    const words = (n?.vocab || []).filter((v) => v.hanzi || v.pinyin || v.meaning).length;
    return `<article class="noteitem" data-text="${esc(noteSearchText(s))}">
      <button type="button" class="notehead" data-act="note-open" data-id="${esc(s.id)}" aria-expanded="${open}">
        <span class="notedate"><b>${a.getDate()}</b><span>${esc(a.toLocaleDateString([], { month: "short", year: "numeric" }))}</span></span>
        <span class="grow"><span class="stitle">${esc(s.title)}</span>
          <span class="row" style="gap:6px;flex-wrap:wrap;margin-top:4px">${catBadges(s)}${levelBadge(s)}${s.host_name ? `<span class="small muted">with ${esc(s.host_name)}</span>` : ""}</span></span>
        <span class="small ${published(s) ? "" : "muted"}" style="white-space:nowrap;${published(s) ? "color:var(--green);font-weight:700" : ""}">${published(s) ? (words ? `${words} word${words === 1 ? "" : "s"}` : "Notes") : isHost() && n ? "Draft" : "No notes"}</span>
        <span class="chev" aria-hidden="true">›</span>
      </button>
      ${open ? `<div class="notebody-wrap">${notesBlock(s)}</div>` : ""}
    </article>`;
  };
  return `
  <header><div class="eyebrow">Mandarin Zest Club</div><h1>My notes</h1>
    <p class="muted" style="margin:6px 0 0">${isHost() ? "Every session with notes, most recent first." : "Every session you attended, most recent first."} ${withNotes} with notes.</p></header>
  ${list.length ? `<label class="field" style="max-width:520px">Search your notes
      <input class="input" type="search" id="notesearch" placeholder="A word, a character, a session…" autocomplete="off"></label>
    <div class="notelist" id="notelist">${list.map(item).join("")}</div>
    <p class="muted small" id="notesempty" hidden>Nothing matches your search.</p>`
    : `<div class="card"><p class="small muted" style="margin:0">${isHost() ? "No session notes yet." : "Sessions you attend show up here with your host's notes (vocabulary, corrections and links)."}</p></div>`}`;
}

function pastItem(s) {
  const c = cat(s), a = new Date(s.starts_at), open = state.open.has(s.id);
  const came = attended(s);
  return `<div class="sitem">
    <div class="top">
      <button type="button" class="open" data-act="open" data-id="${esc(s.id)}" aria-expanded="${open}">
        <span class="datebox" style="background:${tint(c.color, .14)};color:${c.color}">
          <div class="dow">${esc(a.toLocaleDateString([], { month: "short" }).toUpperCase())}</div><div class="day">${a.getDate()}</div>
        </span>
        <span class="grow">
          <div class="stitle">${esc(s.title)}</div>
          <div class="smeta">${came ? "Attended" : "You said you'd come"}${published(s) ? " · Notes ready" : ""}</div>
        </span>
      </button>
      ${published(s) ? `<span class="chip" style="background:var(--green)">Notes</span>` : ""}
    </div>
    ${open ? `<div class="sdetail">${s.host_name ? `<div class="small muted">Host: ${esc(s.host_name)}</div>` : ""}${notesBlock(s)}</div>` : ""}
  </div>`;
}

function mySessionsView() {
  const mine = state.sessions.filter((s) => iAmIn(s) || attended(s));
  const next = mine.filter((s) => !ended(s));
  const past = mine.filter((s) => ended(s)).reverse();
  // Host board: only the sessions this host runs (matched via their Google Meet name or display name).
  const showAll = isAdmin() && state.hostAll;
  const myHosted = isHost()
    ? state.sessions.filter((s) => !s.cancelled && (showAll || sessionHost(s)?.id === state.user.id)
        && Date.parse(s.starts_at) > Date.now() - 21 * 864e5)
    : [];
  const hostNext = myHosted.filter((s) => Date.parse(s.starts_at) > Date.now() + 30 * 60e3);
  const hostDone = myHosted.filter((s) => Date.parse(s.starts_at) <= Date.now() + 30 * 60e3).reverse();
  const hostItem = (s, upcomingOne) => {
    const n = state.notes.get(s.id), count = (state.attendance.get(s.id) || new Set()).size;
    const status = upcomingOne ? (n ? "Notes drafted" : "You're hosting") : `${count} attended · ${n?.published_at ? "Notes published" : n ? "Draft notes" : "No notes yet"}`;
    const a = new Date(s.starts_at);
    return `<a class="sitem hostrow" href="${hostLink(s)}"><div class="top">
      <span class="grow"><div class="stitle">${esc(s.title)}</div>
      <div class="smeta">${esc(dayName(a))} · ${fmtTime(a)}${showAll && s.host_name ? ` · ${esc(s.host_name)}` : ""} · ${status}</div></span>
      <span class="toggle" style="display:inline-flex;align-items:center">Open</span></div></a>`;
  };
  return `
  <header><div class="eyebrow">Mandarin Zest Club</div><h1>My sessions</h1></header>
  ${isHost() ? `<div class="row between" style="align-items:baseline;flex-wrap:wrap;gap:8px"><h2>Hosting: attendance &amp; notes</h2>
    ${isAdmin() ? `<div class="seg" role="group" aria-label="Sessions shown" style="max-width:260px">
      <button type="button" data-act="host-all" data-v="" aria-pressed="${!showAll}">Mine</button>
      <button type="button" data-act="host-all" data-v="1" aria-pressed="${showAll}">All hosts</button></div>` : ""}</div>
  ${hostNext.length ? `<div class="daylabel">Coming up to host</div><div class="slist">${hostNext.slice(0, 8).map((s) => hostItem(s, true)).join("")}</div>` : ""}
  ${hostDone.length ? `<div class="daylabel">Hosted · last 3 weeks</div><div class="slist">${hostDone.map((s) => hostItem(s, false)).join("")}</div>` : ""}
  ${!myHosted.length ? `<div class="card"><p class="small muted" style="margin:0">${state.meetName || showAll ? "No sessions with you as host in the calendar right now." : `Your sessions appear here once the app knows they're yours. Add the <b>name you use on Google Meet</b> in <a href="#/me">Me</a> (as written after “Host:” in the calendar).`}</p></div>` : ""}` : ""}
  <h2>Coming up</h2>
  <div class="slist">${next.length ? grouped(next) : `<div class="card"><p class="muted small" style="margin:0">Tap <b>I'm in</b> on a session and it shows up here.</p></div>`}</div>
  <h2>Past sessions</h2>
  <div class="slist">${past.length ? past.map(pastItem).join("") : `<p class="muted small">Sessions you joined will be listed here, with your host's notes.</p>`}</div>`;
}

// ---------------------------------------------------------------------------
// Host: attendance and notes
// ---------------------------------------------------------------------------
function noteDraft(id) {
  if (!state.noteDraft.has(id)) {
    const n = state.notes.get(id);
    const vocab = (n?.vocab || []).map((v) => ({ ...v }));
    while (vocab.length < 3) vocab.push({ hanzi: "", pinyin: "", meaning: "" });
    state.noteDraft.set(id, { vocab, body: n?.body || "", dirty: false });
  }
  return state.noteDraft.get(id);
}

function hostView() {
  const id = routeArg();
  const s = state.sessions.find((x) => x.id === id);
  if (!s) return `<a class="ztback" href="#/sessions">‹ Back</a><div class="card"><h2>Session not found</h2><p class="muted small" style="margin:0">It may have been removed from the calendar.</p></div>`;
  const a = new Date(s.starts_at);
  const came = state.attendance.get(s.id) || new Set();
  const candidateIds = new Set([...going(s), ...came]);
  const people = [...candidateIds].map((uid) => state.profiles.get(uid) || { id: uid, display_name: "Member", fruit: "orange", bg: "#fdf1ea" })
    .sort((x, y) => (x.display_name || "").localeCompare(y.display_name || ""));
  const others = [...state.profiles.values()].filter((p) => state.roles.has(p.id) && !candidateIds.has(p.id))
    .sort((x, y) => (x.display_name || "").localeCompare(y.display_name || ""));
  const d = noteDraft(s.id), n = state.notes.get(s.id);
  return `
  <div class="row between">
    <a class="ztback" href="#/sessions">‹ Back</a>
    <span class="chip" style="background:var(--green)">HOST VIEW</span>
  </div>
  <header>
    <div class="when">${esc(dayName(a))} · ${fmtTime(a)}${isLive(s) ? " · live now" : ended(s) ? " · ended" : ""}</div>
    <h1>${esc(s.title)}</h1>
  </header>

  <section class="card">
    <div class="row between" style="align-items:baseline"><h2>1 · Who came?</h2><span class="small muted">${going(s).size} said they'd come</span></div>
    ${people.length ? `<div class="whogrid">${people.map((p) => {
      const on = came.has(p.id);
      return `<button type="button" class="whobtn" role="checkbox" aria-checked="${on}" data-act="attend" data-uid="${p.id}">
        ${avatar(p, 32, { flag: false })}<span class="grow">${esc(p.display_name || "Member")}</span><span class="tick" aria-hidden="true">${on ? "✓" : ""}</span></button>`;
    }).join("")}</div>` : `<p class="small muted" style="margin:0">Nobody said they'd come. Add who joined below.</p>`}
    ${others.length ? `<label class="field" style="font-weight:600">Add someone who joined
      <select class="input" data-act-change="attend-add"><option value="">Choose a member…</option>
      ${others.map((p) => `<option value="${p.id}">${esc(p.display_name || "Member")}</option>`).join("")}</select></label>` : ""}
    <div class="small muted">${came.size} ticked. Ticks save right away. Each tick gives that member +${XP_SESSION} XP.</div>
  </section>

  <section class="card">
    <div class="row between" style="align-items:baseline"><h2>2 · Session notes</h2>
      <span class="small ${n?.published_at ? "" : "muted"}" style="${n?.published_at ? "color:var(--green);font-weight:700" : ""}">${n?.published_at ? "Published · editable" : n ? "Draft: only hosts see it" : "Not started"}</span></div>
    <div class="vhead small muted"><span>汉字</span><span>Pinyin</span><span>Meaning</span><span></span></div>
    <div class="stack" style="gap:6px">${d.vocab.map((v, i) => `<div class="vedit">
      <input class="input" aria-label="Word ${i + 1}, characters" data-vocab="${i}" data-k="hanzi" value="${esc(v.hanzi)}" placeholder="汉字" lang="zh" autocomplete="off" aria-autocomplete="list" aria-expanded="false" aria-controls="vsugg-${i}">
      <input class="input" aria-label="Word ${i + 1}, pinyin" data-vocab="${i}" data-k="pinyin" value="${esc(v.pinyin)}" placeholder="pinyin" autocomplete="off" aria-autocomplete="list" aria-expanded="false" aria-controls="vsugg-${i}">
      <input class="input" aria-label="Word ${i + 1}, meaning" data-vocab="${i}" data-k="meaning" value="${esc(v.meaning)}" placeholder="meaning">
      <button type="button" class="xbtn" data-act="vocab-del" data-i="${i}" aria-label="Remove word ${i + 1}">×</button></div>`).join("")}</div>
    <button type="button" class="linkbtn" data-act="vocab-add" style="align-self:flex-start">+ Add a word</button>
    <label class="field">Sentences, corrections, links
      <textarea class="input" id="notebody" rows="7" style="padding:12px 14px;min-height:150px;resize:vertical" placeholder="我昨天去了超市。&#10;Correction: 我去超市了 → …&#10;Video: https://…">${esc(d.body)}</textarea>
    </label>
    <div class="row" style="gap:8px;flex-wrap:wrap">
      ${n?.published_at ? "" : `<button type="button" class="btn ghost grow" data-act="note-save">Save draft</button>`}
      <button type="button" class="btn grow" data-act="note-publish">${n?.published_at ? "Save changes" : "Publish notes"}</button>
    </div>
    <div class="small muted" style="text-align:center">${n?.published_at ? "These notes are published, and you can keep editing them: members see your changes right away. They already got the \"Notes are up\" notification, so changes don't notify again." : "Publishing notifies everyone who came or said they'd come."}</div>
  </section>`;
}

async function setAttendance(sid, uid, on) {
  if (document.getElementById("notebody")) readNoteForm(sid); // keep typed notes
  const set = state.attendance.get(sid) || new Set();
  on ? set.add(uid) : set.delete(uid);
  state.attendance.set(sid, set);
  render();
  const q = on ? sb.from("attendance").insert({ session_id: sid, user_id: uid })
    : sb.from("attendance").delete().eq("session_id", sid).eq("user_id", uid);
  const { error } = await q;
  if (error && !/duplicate/i.test(error.message)) {
    on ? set.delete(uid) : set.add(uid);
    render(); toast("Couldn't save that tick.");
  }
}

function readNoteForm(sid) {
  const d = noteDraft(sid);
  for (const el of document.querySelectorAll("[data-vocab]")) {
    const row = d.vocab[+el.dataset.vocab];
    if (row) row[el.dataset.k] = el.value;
  }
  const body = document.getElementById("notebody");
  if (body) d.body = body.value;
  return d;
}

async function saveNotes(sid, publish) {
  const d = readNoteForm(sid);
  const vocab = d.vocab.map((v) => ({ hanzi: (v.hanzi || "").trim(), pinyin: (v.pinyin || "").trim(), meaning: (v.meaning || "").trim() }))
    .filter((v) => v.hanzi || v.pinyin || v.meaning).slice(0, 200);
  const { data, error } = await sb.from("session_notes").upsert({ session_id: sid, vocab, body: d.body.slice(0, 20000) }).select().single();
  if (error) { toast("Couldn't save the notes. Try again."); return; }
  state.notes.set(sid, data);
  if (publish) {
    const r = await sb.rpc("publish_notes", { p_session: sid });
    if (r.error) { toast("Saved, but couldn't publish. Try again."); return; }
    state.notes.set(sid, { ...data, published_at: data.published_at || new Date().toISOString() });
    toast(r.data?.first ? "Published! Members will be notified." : "Changes saved. Members see the updated notes.");
  } else toast("Draft saved");
  state.noteDraft.delete(sid);
  render();
}

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------
function membersView() {
  const lb = state.membersTab === "lb";
  return `
  <header><div class="eyebrow">Mandarin Zest Club</div><h1>Members</h1></header>
  <div class="tabs" role="tablist">
    <button type="button" role="tab" aria-selected="${lb}" data-act="mtab" data-v="lb">Leaderboard</button>
    <button type="button" role="tab" aria-selected="${state.membersTab === "all"}" data-act="mtab" data-v="all">Everyone</button>
    <button type="button" role="tab" aria-selected="${state.membersTab === "map"}" data-act="mtab" data-v="map">Map</button>
  </div>
  ${lb ? leaderboard() : state.membersTab === "map" ? mapView() : directory()}
  <a class="chatcard thin" href="${DISCORD_CHAT}" target="_blank" rel="noopener">${ICON.chat}<b class="grow">Chat on Discord</b><span aria-hidden="true">↗</span></a>`;
}

const memberLink = (id) => `#/member/${id}`;
const linkOrDiv = (id, cls, inner) => {
  const href = memberLink(id);
  return href ? `<a class="${cls}" href="${href}">${inner}</a>` : `<div class="${cls}">${inner}</div>`;
};

function leaderboard() {
  const period = "month", k = "month";
  const list = rankList(period);
  const month = new Date().toLocaleDateString([], { month: "long" });
  const periods = `<div class="lbhead"><span class="stkbig" style="--z:40px">${stickerSvg("medal")}</span>
    <div class="grow"><b>${esc(month)} leaderboard</b><div class="small muted">Finish #1 this month to unlock the medal sticker. It starts again on the 1st.</div></div></div>`;
  if (!list.length || !list.some((r) => r[k] > 0)) {
    return `${periods}<div class="card"><h2>No XP yet${period === "month" ? " this month" : ""}</h2>
      <p class="small muted" style="margin:0;line-height:1.5">Members get +${XP_SESSION} XP for every session they join (the host ticks who came), +${XP_STREAK} XP for every 4 weeks in a row, and +${XP_BOOTCAMP} XP per bootcamp.</p></div>`;
  }
  const row = (r) => ({ ...r, display_name: r.name, fruit: r.fruit, bg: r.bg, country: r.country });
  const top = list.slice(0, 3).map(row);
  const order = [top[1], top[0], top[2]];
  const heights = [64, 88, 50], colors = ["#f8dacd", "#f37a48", "#fdf1ea"], sizes = [58, 70, 54], ranks = [2, 1, 3];
  const podium = `<div class="podium">${order.map((p, i) => p ? linkOrDiv(p.user_id, "", `
      ${avatar(p, sizes[i])}<b>${esc(p.name || "Member")}</b>
      <div class="step" style="height:${heights[i]}px;background:${colors[i]}"><span class="n">${ranks[i]}</span><span class="small">${p[k]} XP</span></div>`) : "<div></div>").join("")}</div>`;
  const LB_MAX = 10; // podium + places 4 to 10
  const rest = list.slice(3, LB_MAX).map((r, i) => linkOrDiv(r.user_id, `lbrow${r.user_id === state.user.id ? " me" : ""}`, `
      <span class="rk">${i + 4}</span>${avatar(row(r), 40)}
      <div class="grow"><b>${esc(r.name || "Member")}${r.user_id === state.user.id ? " (you)" : ""}</b><div class="small muted">Level ${r.level}</div></div>
      <b>${r[k]} XP</b>`)).join("");
  const mine = myRank(period);
  // A member outside the top 10 still sees where they stand.
  const meIdx = list.findIndex((r) => r.user_id === state.user.id);
  const meRow = meIdx >= LB_MAX ? `<div class="lbgap" aria-hidden="true">···</div>` + linkOrDiv(list[meIdx].user_id, "lbrow me", `
      <span class="rk">${meIdx + 1}</span>${avatar(row(list[meIdx]), 40)}
      <div class="grow"><b>${esc(list[meIdx].name || "Member")} (you)</b><div class="small muted">Level ${list[meIdx].level}</div></div>
      <b>${list[meIdx][k]} XP</b>`) : "";
  return `${periods}
  ${podium}
  <div class="stack" style="gap:6px">${rest}${meRow}</div>
  ${!isHost() && mine && mine <= 3 ? `<p class="small" style="text-align:center;margin:0"><b>You're #${mine}!</b></p>` : ""}
  <p class="small muted" style="margin:0">+${XP_SESSION} XP per session · +${XP_STREAK} XP every 4 weeks in a row · XP for bootcamps · +${XP_HONGBAO} XP per hongbao received${isBeta() ? " · +1 XP a day for a flashcard review, a Library chapter, writing a character or sending a letter · +2 XP every 10 days of your streak tree" : ""}. Hosts don't take part.</p>`;
}

function directory() {
  const all = [...state.profiles.values()].filter((p) => state.roles.has(p.id));
  const byName = (a, b) => (a.display_name || "").localeCompare(b.display_name || "");
  const hosts = all.filter((p) => ["host", "admin"].includes(state.roles.get(p.id))).sort(byName);
  const members = all.filter((p) => !["host", "admin"].includes(state.roles.get(p.id))).sort(byName);
  const levelOf = (id) => state.board.find((r) => r.user_id === id)?.level || 1;
  const sub = (p) => `<span class="mlv">Lv ${levelOf(p.id)}</span>${p.chinese_level ? `<span class="mcl">${esc(p.chinese_level)}</span>` : ""}`;
  return `
  ${hosts.length ? `<div class="daylabel">Hosts</div>
  <div class="hostgrid">${hosts.map((p) => linkOrDiv(p.id, "hostcard", `${avatar(p, 44)}<div class="grow"><b style="display:block;overflow:hidden;text-overflow:ellipsis">${esc(p.display_name || "Host")}</b><div class="badge">HOST</div></div>`)).join("")}</div>` : ""}
  <div class="daylabel">Members · ${members.length}</div>
  ${members.length ? `<div class="mgrid">${members.map((p) => linkOrDiv(p.id, "mcard", `${avatar(p, 52)}<b>${esc(p.display_name || "Member")}${p.id === state.user.id ? " (you)" : ""}</b>${sub(p)}`)).join("")}</div>`
    : `<p class="muted small">Members appear here once they've logged in.</p>`}
  <p class="small muted">Tap someone to see their profile.${isAdmin() ? " As admin, you can give XP from a member's profile." : ""}</p>`;
}

// ---------------------------------------------------------------------------
// Hongbao 红包: each member can give one a month (+30 XP) to another member
// ---------------------------------------------------------------------------
const monthKey = () => {
  const d = new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/Brussels" }));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
};
const hbThisMonth = () => (state.hbGiven && state.hbGiven.month === monthKey() ? state.hbGiven : null);
const nameOf = (id) => state.profiles.get(id)?.display_name || state.board.find((b) => b.user_id === id)?.name || "a member";
const ENVELOPE = `<svg viewBox="0 0 64 64" aria-hidden="true"><rect x="12" y="6" width="40" height="54" rx="6" fill="#d8352a"/><path d="M12 12 a6 6 0 0 1 6 -6 h28 a6 6 0 0 1 6 6 v6 q-20 14 -40 0z" fill="#b8281f"/><circle cx="32" cy="24" r="8" fill="#f2b631"/><text x="32" y="28.5" text-anchor="middle" font-family="'Noto Sans SC',sans-serif" font-size="11" font-weight="700" fill="#b8281f">福</text></svg>`;

function hongbaoGiveBlock(id) {
  if (state.role !== "member" || id === state.user.id || state.roles.get(id) !== "member") return "";
  const given = hbThisMonth();
  const month = new Date().toLocaleDateString([], { month: "long" });
  if (given) return `<div class="hbcard done"><span class="hbenv">${ENVELOPE}</span><div class="grow">
    <b>${given.receiver === id ? `You gave ${esc(nameOf(id))} your ${esc(month)} hongbao` : `You gave your ${esc(month)} hongbao to ${esc(nameOf(given.receiver))}`}</b>
    <div class="small muted">You get a new one to give on the 1st of next month.</div></div></div>`;
  return `<div class="hbcard"><span class="hbenv">${ENVELOPE}</span><div class="grow">
    <b>Send ${esc(nameOf(id))} a hongbao 红包</b>
    <div class="small muted">One per month. They get +${XP_HONGBAO} XP and a notification saying it's from you.</div></div>
    <button type="button" class="btn hbbtn" data-act="hb-give" data-id="${id}">Send</button></div>`;
}

function hongbaoMeCard() {
  if (state.role !== "member") return "";
  const given = hbThisMonth(), got = state.hbIn || [];
  const month = new Date().toLocaleDateString([], { month: "long" });
  return `<section class="hbcard me"><span class="hbenv">${ENVELOPE}</span><div class="grow">
    <b>Your ${esc(month)} hongbao 红包</b>
    <div class="small muted">${given ? `Given to ${esc(nameOf(given.receiver))}. A new one arrives on the 1st.` : `Not given yet. Open a member's card in <a href="#/members">Members</a> to send it (+${XP_HONGBAO} XP for them).`}
    ${got.length ? `<br>You've received ${got.length} hongbao${got.length === 1 ? "" : "s"}: ${got.slice(0, 3).map((h) => esc(h.name || "a member")).join(", ")}${got.length > 3 ? "…" : ""}.` : ""}</div></div></section>`;
}

function hongbaoOverlay() {
  const fresh = (state.hbIn || []).filter((h) => !h.seen_at);
  if (!fresh.length) return "";
  const names = [...new Set(fresh.map((h) => h.name || "A member"))];
  const who = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
  return `<div class="hbover" role="dialog" aria-modal="true" aria-labelledby="hbtitle">
    <div class="hbbox">
      <div class="hbanim">${ENVELOPE}<span class="hbxp">+${XP_HONGBAO * fresh.length} XP</span></div>
      <h2 id="hbtitle">You received ${fresh.length === 1 ? "a hongbao" : `${fresh.length} hongbaos`}!</h2>
      <p class="muted" style="margin:0">From <b>${esc(who)}</b>. 恭喜！</p>
      <button type="button" class="btn block" data-act="hb-seen">谢谢 Thank you!</button>
    </div></div>`;
}

async function giveHongbao(id) {
  if (!confirm(`Send your hongbao for this month to ${nameOf(id)}? They get +${XP_HONGBAO} XP. You can only give one per month.`)) return;
  const { error } = await sb.rpc("give_hongbao", { p_to: id });
  if (error) { toast(/already/i.test(error.message) ? "You already gave your hongbao this month." : "Couldn't send it. Try again."); return; }
  state.hbGiven = { giver: state.user.id, receiver: id, month: monthKey(), created_at: new Date().toISOString() };
  toast(`🧧 Hongbao sent to ${nameOf(id)}!`);
  await refreshBoard();
}

// ---------------------------------------------------------------------------
// How to unlock avatars and stickers
// ---------------------------------------------------------------------------
function unlocksView() {
  const idx = trad() ? 1 : 0;
  return `
  <a class="ztback" href="#/me" data-act="back-custom">‹ Back to my profile</a>
  <header><div class="eyebrow">Avatar customization</div><h1>How to unlock avatars &amp; stickers</h1></header>
  <section class="card" style="gap:10px">
    <h2>Fruit avatars: level up</h2>
    <p class="small muted" style="margin:0;line-height:1.5">You start with three fruits. Each new level unlocks another one. You earn XP by joining sessions (+${XP_SESSION}), coming 4 weeks in a row (+${XP_STREAK}), bootcamps and hongbaos from other members (+${XP_HONGBAO})${isBeta() ? ". In Zest Town: +1 XP a day for playing a game, and +2 XP every 10 days of your streak tree" : ""}.</p>
    <div class="unlockgrid">${FRUITS.map((f) => `<div class="unlockitem">${avatar({ bg: "#fdf1ea" }, 40, { flag: false, fruit: f.key, locked: !isHost() && f.level > myLevel() })}<span class="small"><b>Lv ${f.level}</b><br>${esc(zh(f.zh))}</span></div>`).join("")}</div>
  </section>
  <section class="card" style="gap:10px">
    <h2>Special avatars and stickers</h2>
    <p class="small muted" style="margin:0;line-height:1.5">Special avatars and stickers are given during special sessions, bootcamps and Club initiatives. Stickers are a small extra: you wear one at the bottom-left of your avatar. Keep an eye out, new ones come with new events.</p>
    <p class="small" style="margin:4px 0 0;font-weight:700">A few you can work towards anytime:</p>
    <div class="stack" style="gap:2px">${STICKERS.filter((t) => ["phone", "heart", "medal", "sprout", "book"].includes(t.key)).map((t) => `<div class="unlockrow"><span class="stkbig" style="--z:44px">${stickerSvg(t.key)}</span>
      <div class="grow"><b>${esc(t.en)} <span style="font-weight:600;color:var(--orange-ink)">${esc(zh(t.zh))}</span></b><div class="small muted">${esc(t.how || "")}</div></div>
      ${myStickers().includes(t.key) ? `<span class="chip" style="background:var(--green)">Yours</span>` : ""}</div>`).join("")}</div>
  </section>`;
}

// ---------------------------------------------------------------------------
// Members map: orange = countries with members; tap one to zoom in and see its members
// ---------------------------------------------------------------------------
const MAP_WORLD = [0, 0, 1000, 500];
const mapAspect = () => (wide() ? 2 : Math.max(1, Math.min(window.innerWidth, 560) / 300));
function mapDefault() {
  if (wide()) return [...MAP_WORLD];
  const h = 350, w = h * mapAspect();             // phone: start zoomed on the Americas–Europe–Africa band
  return [Math.max(0, 350 - w / 2), 60, w, h];
}
async function loadMap() {
  if (state.mapLoading) return;
  state.mapLoading = true;
  try {
    const [m, cc] = await Promise.all([import("./worldmap.js?v=147"), sb.rpc("country_counts")]);
    state.world = m.WORLD;
    state.countryCounts = new Map((cc.data || []).map((r) => [r.country, r.members]));
  } catch { state.world = "error"; }
  state.mapLoading = false;
  if (route() === "members") render();
}
function zoomTo(a2) {
  const row = state.world?.find?.((r) => r[0] === a2);
  if (!row) return mapDefault();
  const [x0, y0, x1, y1] = row[2];
  let w = Math.max(x1 - x0, 40) * 1.5, h = Math.max(y1 - y0, 25) * 1.5;
  const asp = mapAspect();
  if (w / h > asp) h = w / asp; else w = h * asp;
  return [(x0 + x1) / 2 - w / 2, (y0 + y1) / 2 - h / 2, w, h];
}
function pickCountry(a2) {
  state.mapSel = a2 || "";
  state.mapVB = a2 ? zoomTo(a2) : mapDefault();
  render();
}
function mapView() {
  if (!state.world && !state.mapLoading) loadMap();
  if (!state.world || state.mapLoading) return `<p class="muted small">Loading the map…</p>`;
  if (state.world === "error") return `<div class="card"><p class="small" style="margin:0">Couldn't load the map. Check your connection and try again.</p></div>`;
  const counts = state.countryCounts, sel = state.mapSel || "";
  const list = [...counts.entries()].map(([c, n]) => ({ c, n, name: countryName(c) || c.toUpperCase() }))
    .sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
  const total = list.reduce((t, x) => t + x.n, 0);
  const vb = state.mapVB || (state.mapVB = mapDefault());
  const paths = state.world.map(([c, d]) => `<path d="${d}" class="${counts.has(c) ? "has" : ""}${c && c === sel ? " sel" : ""}"${counts.has(c) ? ` data-a2="${c}"` : ""}></path>`).join("");
  const svg = `<svg id="worldmap" class="wm${sel ? " focus" : ""}" viewBox="${vb.map((v) => v.toFixed(1)).join(" ")}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="World map: countries with Club members are orange">${paths}</svg>`;
  const pick = `<label class="field">Jump to a country
    <select class="input" data-act-change="map-pick"><option value="">All countries</option>
    ${list.map((x) => `<option value="${esc(x.c)}" ${x.c === sel ? "selected" : ""}>${esc(x.name)} · ${x.n}</option>`).join("")}</select></label>`;
  const rows = list.map((x) => `<button type="button" class="ctyrow${x.c === sel ? " on" : ""}" data-act="map-pick" data-v="${esc(x.c)}"><i aria-hidden="true"></i><span class="grow">${esc(x.name)}</span><span class="small muted">${x.n} member${x.n === 1 ? "" : "s"}</span></button>`).join("");
  let panel = "";
  if (sel) {
    const n = counts.get(sel) || 0;
    const isH = (p) => ["host", "admin"].includes(state.roles.get(p.id));
    const shown = [...state.profiles.values()].filter((p) => p.country === sel && state.roles.has(p.id))
      .sort((a, b) => isH(b) - isH(a) || (a.display_name || "").localeCompare(b.display_name || ""));
    const hidden = Math.max(0, n - shown.length);
    const levelOf = (id) => state.board.find((r) => r.user_id === id)?.level || 1;
    panel = `<section class="ctypanel">
      <div class="row between" style="align-items:baseline"><h2>${esc(countryName(sel) || sel.toUpperCase())}</h2><span class="small muted">${n} member${n === 1 ? "" : "s"}</span></div>
      ${shown.map((p) => linkOrDiv(p.id, "lbrow", `${avatar(p, 44)}<div class="grow"><b>${esc(p.display_name || "Member")}${isH(p) ? ` <span class="hosttag">(host)</span>` : ""}${p.id === state.user.id ? " (you)" : ""}</b><div class="small muted">${isH(p) ? "Club host" : `Lv ${levelOf(p.id)}`}${p.chinese_level ? ` · ${esc(p.chinese_level)}` : ""}</div></div>`)).join("")}
      ${hidden ? `<p class="small muted" style="margin:0">${shown.length ? "+" : ""}${hidden} ${hidden === 1 ? "person who keeps their" : "people who keep their"} profile out of the directory.</p>` : ""}
      ${state.world.some((r) => r[0] === sel) ? "" : `<p class="small muted" style="margin:0">This country is too small to show on the world map.</p>`}
    </section>`;
  }
  const mapBox = `<div class="mapbox">
    ${svg}
    <div class="mapzoom"><button type="button" data-act="map-zoom" data-v="in" aria-label="Zoom in">+</button><button type="button" data-act="map-zoom" data-v="out" aria-label="Zoom out">−</button></div>
    ${wide() ? "" : `<span class="maphint">Pinch or drag to explore</span>`}
  </div>`;
  const head = `<div class="row between" style="align-items:baseline;flex-wrap:wrap;gap:6px">
    <b style="font-size:16px">${total ? `${total} member${total === 1 ? "" : "s"} in ${list.length} countr${list.length === 1 ? "y" : "ies"}` : "No countries yet"}</b>
    ${sel ? `<button type="button" class="linkbtn" data-act="map-pick" data-v="">← World map</button>` : `<span class="small muted">${wide() ? "Click" : "Tap"} an orange country</span>`}</div>`;
  if (!total) return `${head}<div class="card"><p class="small muted" style="margin:0">Members appear on the map once they've chosen their country in Me.</p></div>`;
  return wide()
    ? `${head}<div class="mapgrid"><div class="card" style="gap:10px">${mapBox}
        <div class="maplegend"><span><i style="background:#f37a48"></i>Has members</span><span><i style="background:#e7e0da"></i>No members yet</span></div></div>
        <div class="stack" style="gap:14px">${pick}${panel}<div class="ctylist">${rows}</div></div></div>`
    : `${head}${mapBox}${pick}${panel}<div class="ctylist">${rows}</div>`;
}

// Drag to pan, pinch / wheel to zoom, tap an orange country to select it.
function wireMap() {
  const svg = document.getElementById("worldmap");
  if (!svg || svg.dataset.wired) return;
  svg.dataset.wired = "1";
  const pts = new Map();
  let moved = false, start = null;
  const vb = () => state.mapVB;
  const apply = () => svg.setAttribute("viewBox", vb().map((v) => v.toFixed(1)).join(" "));
  const clamp = () => {
    const v = vb();
    v[2] = Math.min(Math.max(v[2], 30), 1000 * 1.2); v[3] = v[2] / (svg.clientWidth / svg.clientHeight || 2);
    v[0] = Math.min(Math.max(v[0], -v[2] * 0.5), 1000 - v[2] * 0.5);
    v[1] = Math.min(Math.max(v[1], -v[3] * 0.5), 500 - v[3] * 0.5);
  };
  const zoomAt = (f, cx, cy) => { // f > 1 zooms in; cx, cy in map units
    const v = vb(); const nw = v[2] / f, nh = v[3] / f;
    v[0] = cx - (cx - v[0]) * (nw / v[2]); v[1] = cy - (cy - v[1]) * (nh / v[3]); v[2] = nw; v[3] = nh;
    clamp(); apply();
  };
  const toMap = (px, py) => { const r = svg.getBoundingClientRect(), v = vb(); const s = Math.max(v[2] / r.width, v[3] / r.height);
    return [v[0] + (px - r.left - (r.width - v[2] / s) / 2) * s, v[1] + (py - r.top - (r.height - v[3] / s) / 2) * s]; };
  svg.addEventListener("pointerdown", (e) => { svg.setPointerCapture(e.pointerId); pts.set(e.pointerId, [e.clientX, e.clientY]); if (pts.size === 1) { moved = false; start = [e.clientX, e.clientY]; } });
  svg.addEventListener("pointermove", (e) => {
    if (!pts.has(e.pointerId)) return;
    const prev = pts.get(e.pointerId), r = svg.getBoundingClientRect(), v = vb();
    const s = Math.max(v[2] / r.width, v[3] / r.height);
    if (pts.size === 1) {
      if (Math.hypot(e.clientX - start[0], e.clientY - start[1]) > 6) moved = true;
      v[0] -= (e.clientX - prev[0]) * s; v[1] -= (e.clientY - prev[1]) * s; clamp(); apply();
    } else if (pts.size === 2) {
      moved = true;
      const [a, b] = [...pts.values()];
      const other = a === prev ? b : a;
      const d0 = Math.hypot(prev[0] - other[0], prev[1] - other[1]), d1 = Math.hypot(e.clientX - other[0], e.clientY - other[1]);
      const [cx, cy] = toMap((e.clientX + other[0]) / 2, (e.clientY + other[1]) / 2);
      if (d0 > 0) zoomAt(d1 / d0, cx, cy);
    }
    pts.set(e.pointerId, [e.clientX, e.clientY]);
  });
  const end = (e) => {
    const single = pts.size === 1;
    pts.delete(e.pointerId);
    if (single && !moved && e.type === "pointerup") {
      const hit = document.elementFromPoint(e.clientX, e.clientY);
      const a2 = hit?.closest?.("path[data-a2]")?.dataset.a2;
      if (a2) pickCountry(a2);
    }
  };
  svg.addEventListener("pointerup", end);
  svg.addEventListener("pointercancel", end);
  svg.addEventListener("wheel", (e) => { e.preventDefault(); const [cx, cy] = toMap(e.clientX, e.clientY); zoomAt(e.deltaY < 0 ? 1.2 : 1 / 1.2, cx, cy); }, { passive: false });
  svg._zoom = (f) => { const v = vb(); zoomAt(f, v[0] + v[2] / 2, v[1] + v[3] / 2); };
}

// ---------------------------------------------------------------------------
// One member's profile card (everyone); admins can also give XP here
// ---------------------------------------------------------------------------
function memberView() {
  const id = routeArg();
  const r = state.board.find((x) => x.user_id === id);
  const full = state.profiles.get(id);
  const p = full || (r && { id, display_name: r.name, fruit: r.fruit, bg: r.bg, country: r.country, sticker: r.sticker });
  if (!p) return `<a class="ztback" href="#/members">‹ Back</a><div class="card"><h2>Member not found</h2></div>`;
  const role = state.roles.get(id), host = role === "host" || role === "admin";
  const me = id === state.user.id;
  const xp = r?.total || 0, pr = progress(xp);
  const sessions = state.stats.get(id) || 0;
  const info = fruitInfo(p.fruit), idx = trad() ? 1 : 0;
  const facts = [
    host ? null : [`Level ${pr.level}`, `${xp.toLocaleString()} XP${r?.month ? ` · ${r.month.toLocaleString()} this month` : ""}`],
    [String(sessions), sessions === 1 ? "session attended" : "sessions attended"],
    host ? null : (() => { const n = state.bootcampsJoined?.get(id) || 0; return [String(n), n === 1 ? "bootcamp joined" : "bootcamps joined"]; })(),
    full?.chinese_level ? [full.chinese_level, "Chinese level"] : null,
    full?.country ? [countryName(full.country), "Country"] : null,
  ].filter(Boolean);
  const awards = isAdmin() ? state.awards.filter((a) => a.user_id === id) : [];
  return `
  <a class="ztback" href="#/members">‹ Back</a>
  <header class="row" style="gap:16px">${avatar(p, 88)}
    <div class="grow"><div class="eyebrow">${host ? "Host" : "Member"}${me ? " · you" : ""}</div>
      <h1>${esc(p.display_name || "Member")}</h1>
      <div style="font-size:14.5px;font-weight:700;color:var(--orange-ink);margin-top:4px">${esc(zh(info.zh))} <span class="pron">${esc(py(info.py[idx]))}</span></div>
    </div>
  </header>
  ${full?.bio ? `<p class="bio">${esc(full.bio)}</p>` : me ? `<p class="small muted" style="margin:0">Add a short bio in <a href="#/me">Me</a> so others know a bit about you.</p>` : ""}
  <div class="facts">${facts.map(([v, l]) => `<div class="fact"><b>${esc(v)}</b><span>${esc(l)}</span></div>`).join("")}</div>
  ${(() => { const got = myStickers(id); return got.length ? `<section class="card" style="gap:10px"><h2>Stickers collected · ${got.length}</h2>
    <div class="stkrow">${got.map((k) => `<div class="stkitem"><span class="stkbig"${stickerTip(k, id)}>${stickerSvg(k)}</span><span class="small">${esc(stickerInfo(k).en)}</span></div>`).join("")}</div></section>` : ""; })()}
  ${full?.discord ? `<a class="chatcard" style="display:flex" href="${DISCORD_CHAT}" target="_blank" rel="noopener">${ICON.chat}<span class="grow"><b>@${esc(full.discord)}</b><br><span class="small">Say hi on the Club Discord</span></span><span aria-hidden="true" style="font-size:20px">↗</span></a>` : ""}
  ${hongbaoGiveBlock(id)}
  ${isAdmin() ? activityBlock(id) : ""}
  ${isAdmin() ? adminXpBlock(id, r, awards) : ""}
  ${isAdmin() && r ? adminBookBlock(id) : ""}`;
}

// Admins give Library books to a member, e.g. someone who already bought the PDF (source 'gift').
function adminBookBlock(id) {
  const S = libState();
  if (!S.books && !S.loading && !S.error) libLoad().then(render);
  const mb = (state.memberBooks ||= {});
  if (mb[id] === undefined) { mb[id] = null; sb.rpc("library_member_books", { p_user: id }).then(({ data }) => { mb[id] = data || []; render(); }); }
  const own = mb[id], books = S.books || [];
  if (!own || !books.length) return `<section class="card"><h2>Library books</h2><p class="small muted" style="margin:0">Loading…</p></section>`;
  const has = new Set(own.map((o) => o.book_id)), pick = (state.giveBooks ||= new Set());
  const src = { stripe: "bought", claim: "claimed free", gift: "given by an admin" };
  const t = (bid) => { const b = books.find((x) => x.id === bid); return b ? `${b.title_zh || b.title}` : bid; };
  const free = books.filter((b) => !b.price_cents).map((b) => t(b.id));
  const rest = books.filter((b) => b.price_cents && !has.has(b.id));
  return `<section class="card" style="gap:12px">
    <div class="row between" style="align-items:baseline"><h2>Library books</h2><span class="small muted">Admin only</span></div>
    <div>${own.length ? own.map((o) => `<div class="awardrow"><span class="grow"><b class="lzh">${esc(t(o.book_id))}</b><br><span class="small muted">${esc(src[o.source] || o.source)} · ${new Date(o.created_at).toLocaleDateString()}</span></span>
      ${o.source === "gift" ? `<button type="button" class="xbtn" data-act="book-take" data-id="${esc(o.book_id)}" aria-label="Take this book back">×</button>` : ""}</div>`).join("") : `<p class="small muted" style="margin:0">No books yet${free.length ? ` (besides the free ${esc(free.join(", "))})` : ""}.</p>`}</div>
    ${rest.length ? `<div><div style="font-weight:700;font-size:14.5px;margin-bottom:6px">Give books for free</div>
      <div class="stack" style="gap:2px">${rest.map((b) => `<label class="checkrow"><input type="checkbox" data-act="book-pick" data-id="${esc(b.id)}" ${pick.has(b.id) ? "checked" : ""}> <span class="lzh">${esc(b.title_zh || b.title)}</span> <span class="small muted">${esc(b.title)} · HSK ${esc(b.level)}</span></label>`).join("")}</div></div>
    <button type="button" class="btn green block" data-act="book-give" ${pick.size ? "" : "disabled"}>${pick.size ? `Give ${pick.size} book${pick.size > 1 ? "s" : ""}` : "Give books"}</button>
    <div class="small muted">For members who already bought a book as a PDF. It goes straight onto their shelf. It doesn't use their one free claim and doesn't unlock the 开卷 sticker.</div>` : `<p class="small muted" style="margin:0">They have every book.</p>`}
  </section>`;
}

// Admin: a member's activity (sessions attended, XP gained, stickers and avatars received).
const ACT_FILTERS = [["all", "All"], ["session", "Sessions"], ["xp", "XP"], ["stickers", "Stickers"]];
function activityBlock(id) {
  state.activity ??= new Map();
  const rows = state.activity.get(id);
  if (rows === undefined) {
    state.activity.set(id, "loading");
    sb.rpc("member_activity", { p_user: id }).then(({ data, error }) => {
      state.activity.set(id, error ? "error" : data || []);
      if (route() === "member" && routeArg() === id) render();
    });
  }
  const head = `<div class="row between" style="align-items:baseline"><h2>Activity</h2><span class="small muted">Admin only</span></div>`;
  if (!Array.isArray(rows)) return `<section class="card actcard">${head}<p class="small muted" style="margin:0">${rows === "error" ? "Couldn't load the activity." : "Loading…"}</p></section>`;
  const sessions = rows.filter((r) => r.kind === "session");
  const xp = rows.reduce((t, r) => t + (r.points || 0), 0);
  const month = new Date(); month.setDate(1); month.setHours(0, 0, 0, 0);
  const xpMonth = rows.filter((r) => new Date(r.at) >= month).reduce((t, r) => t + (r.points || 0), 0);
  const last = sessions[0] ? new Date(sessions[0].at) : null;
  const filt = state.actFilter || "all";
  const shown = rows.filter((r) => filt === "all" || (filt === "session" ? r.kind === "session" : filt === "xp" ? r.points : r.kind === "sticker" || r.kind === "avatar"));
  const limit = state.actLimit || 25;
  const dfmt = (d) => d.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });
  const icon = (r) => r.kind === "sticker" && stickerInfo(r.title) ? `<span class="stkbig" style="--z:34px">${stickerSvg(r.title)}</span>`
    : r.kind === "avatar" ? `<span class="acticon" style="background:#e0f4e0">${fruitSvg(r.title)}</span>`
    : `<span class="acticon k-${r.kind}" aria-hidden="true">${{ session: "课", streak: "4", bootcamp: "营", bonus: "+", hongbao: "红", game: "玩", tree: "树", qilin: "麟" }[r.kind] || "+"}</span>`;
  const label = (r) => r.kind === "session" ? esc(r.title)
    : r.kind === "sticker" ? `Sticker · ${esc(stickerInfo(r.title)?.en || r.title)}`
    : r.kind === "avatar" ? `Special avatar · ${esc(fruitInfo(r.title).en || r.title)}`
    : r.kind === "streak" ? "Streak bonus · 4 weeks in a row"
    : r.kind === "game" ? "Zest Town (flashcards or reading)"
    : r.kind === "tree" ? "Streak tree bonus · 10 days in a row"
    : r.kind === "qilin" ? "Qilin challenge 麒麟"
    : r.kind === "hongbao" ? "Hongbao 红包" : esc(r.title);
  const sub = (r) => [dfmt(new Date(r.at)),
    r.kind === "session" && r.detail ? `host ${esc(r.detail)}` : r.kind === "hongbao" && r.detail ? `from ${esc(r.detail)}` : r.detail ? esc(r.detail) : "",
    r.by_name && r.kind !== "hongbao" ? `by ${esc(r.by_name)}` : ""].filter(Boolean).join(" · ");
  let lastMonth = "", out = "";
  for (const r of shown.slice(0, limit)) {
    const d = new Date(r.at), m = d.toLocaleDateString([], { month: "long", year: "numeric" });
    if (m !== lastMonth) {
      lastMonth = m;
      const inM = shown.filter((x) => new Date(x.at).toLocaleDateString([], { month: "long", year: "numeric" }) === m);
      const pts = inM.reduce((t, x) => t + (x.points || 0), 0), ns = inM.filter((x) => x.kind === "session").length;
      out += `<div class="actmonth"><b>${esc(m)}</b><span class="small muted">${[ns ? `${ns} session${ns === 1 ? "" : "s"}` : "", pts ? `${pts > 0 ? "+" : ""}${pts} XP` : ""].filter(Boolean).join(" · ")}</span></div>`;
    }
    out += `<div class="actrow">${icon(r)}<span class="grow"><b>${label(r)}</b><br><span class="small muted">${sub(r)}</span></span>
      ${r.points ? `<span class="actpts${r.points < 0 ? " neg" : ""}">${r.points > 0 ? "+" : ""}${r.points} XP</span>` : ""}</div>`;
  }
  return `<section class="card actcard">${head}
    <div class="actsum">
      <div><b>${sessions.length}</b><span>sessions attended</span></div>
      <div><b>${xp.toLocaleString()}</b><span>XP in total${xpMonth ? ` · ${xpMonth > 0 ? "+" : ""}${xpMonth} this month` : ""}</span></div>
      <div><b>${rows.filter((r) => r.kind === "sticker").length}</b><span>stickers received</span></div>
      <div><b>${last ? esc(last.toLocaleDateString([], { day: "numeric", month: "short" })) : "—"}</b><span>last session</span></div>
    </div>
    <div class="periods" style="justify-content:flex-start" role="group" aria-label="Show">${ACT_FILTERS.map(([k, l]) => `<button type="button" data-act="act-filter" data-v="${k}" aria-pressed="${filt === k}">${l}</button>`).join("")}</div>
    <div class="actlist">${out || `<p class="small muted" style="margin:0">Nothing here yet.</p>`}</div>
    ${shown.length > limit ? `<button type="button" class="btn ghost block" data-act="act-more">Show more (${shown.length - limit})</button>` : ""}
  </section>`;
}

// Hosts (not admins) can give stickers, e.g. the phone sticker for being active on Discord.
function hostStickerBlock(id) {
  const owned = new Set(myStickers(id));
  const stk = state.awardSticker || "";
  return `<form class="card" data-form="award" style="gap:12px">
    <div class="row between" style="align-items:baseline"><h2>Give a sticker</h2><span class="small muted">Hosts</span></div>
    <input type="hidden" name="points" value="0">
    <div class="stkpick">${STICKERS.map((t) => `<button type="button" class="stkbtn" data-act="award-stk" data-key="${t.key}" aria-pressed="${stk === t.key}" ${owned.has(t.key) ? "disabled" : ""}>
      <span class="stkbig">${stickerSvg(t.key)}</span><span class="small">${owned.has(t.key) ? "Has it" : esc(t.en)}</span></button>`).join("")}</div>
    <label class="field">Reason (optional)<input class="input" name="reason" maxlength="120" placeholder="e.g. always helping others on Discord"></label>
    <button class="btn green block" ${stk ? "" : "disabled"}>Give sticker</button>
  </form>`;
}

function adminXpBlock(id, r, awards) {
  const kind = state.awardKind || "bootcamp";
  const camps = Array.isArray(state.bootcamps) ? [...state.bootcamps].sort((x, y) => bootSortKey(x).localeCompare(bootSortKey(y))) : [];
  if (kind === "bootcamp" && !state.bootcamps) loadBootcamps().then(render);
  const pick = state.awardCamp ?? camps[0]?.title ?? "";
  const owned = new Set(myStickers(id));
  const campObj = camps.find((c) => c.title === pick);
  const rw = kind === "bootcamp" && campObj ? state.rewards?.get(bootKey(campObj)) : null;
  const suggested = kind === "bootcamp" ? (rw ? rw.sticker || "" : stickerForBootcamp(pick)) : "";
  const stk = state.awardSticker ?? (owned.has(suggested) ? "" : suggested);
  const gotStickers = (state.stickerAwards || []).filter((a) => a.user_id === id);
  return `
  <form class="card" data-form="award" style="gap:12px">
    <div class="row between" style="align-items:baseline"><h2>Give XP or a sticker</h2><span class="small muted">Admin only</span></div>
    ${r ? "" : `<div class="small muted">Hosts and admins don't earn XP or stickers (they have them all).</div>`}
    <div class="periods" style="justify-content:flex-start" role="group" aria-label="Kind">
      <button type="button" data-act="award-kind" data-v="bootcamp" aria-pressed="${kind === "bootcamp"}">Bootcamp</button>
      <button type="button" data-act="award-kind" data-v="bonus" aria-pressed="${kind === "bonus"}">Other bonus</button>
    </div>
    ${kind === "bootcamp" ? `<label class="field">Which bootcamp
      <select class="input" name="camp" data-act-change="award-camp">
        ${camps.map((c) => `<option value="${esc(c.title)}" ${c.title === pick ? "selected" : ""}>${esc(c.title)}${c.dates ? ` · ${esc(c.dates)}` : ""}</option>`).join("")}
        <option value="" ${pick === "" ? "selected" : ""}>Another bootcamp (type it below)</option>
      </select></label>` : ""}
    <div class="grid2">
      <label class="field">XP to give<input class="input" name="points" type="number" min="-2000" max="2000" step="1" value="${kind === "bonus" ? 50 : rw ? rw.xp : XP_BOOTCAMP}"></label>
      <label class="field">Reason<input class="input" name="reason" maxlength="120" placeholder="${kind === "bonus" ? "e.g. helped a new member" : pick ? "optional, e.g. Nov 2026" : "e.g. Pronunciation Bootcamp, Jan 2027"}"></label>
    </div>
    <div>
      <div class="row between" style="align-items:baseline;margin-bottom:8px"><span style="font-weight:700;font-size:14.5px">Sticker to unlock</span><span class="small muted">${owned.size ? `Has ${owned.size}` : "Has none yet"}</span></div>
      <div class="stkpick">
        <button type="button" class="stkbtn" data-act="award-stk" data-key="" aria-pressed="${!stk}"><span class="stkbig none">—</span><span class="small">None</span></button>
        ${STICKERS.map((t) => `<button type="button" class="stkbtn" data-act="award-stk" data-key="${t.key}" aria-pressed="${stk === t.key}" ${owned.has(t.key) ? "disabled" : ""}>
          <span class="stkbig">${stickerSvg(t.key)}</span><span class="small">${owned.has(t.key) ? "Has it" : esc(t.en)}</span></button>`).join("")}
      </div>
    </div>
    <button class="btn green block" ${r ? "" : "disabled"}>Give</button>
    <div class="small muted">Set XP to 0 to give only a sticker. Use a negative number to correct a mistake. Members see their own awards.</div>
  </form>
  <section class="card" style="gap:0">
    <h2 style="margin-bottom:6px">Given by admins</h2>
    ${awards.length || gotStickers.length ? [
      ...awards.map((a) => `<div class="awardrow"><b style="width:64px">${a.points > 0 ? "+" : ""}${a.points}</b>
      <span class="grow">${esc(a.kind === "bootcamp" ? "Bootcamp" : "Bonus")}${a.reason ? ` · ${esc(a.reason)}` : ""}<br><span class="small muted">${new Date(a.awarded_at).toLocaleDateString()}</span></span>
      <button type="button" class="xbtn" data-act="award-del" data-id="${a.id}" aria-label="Remove this award">×</button></div>`),
      ...gotStickers.filter((a) => stickerInfo(a.sticker)).map((a) => `<div class="awardrow"><span style="width:64px"><span class="stkbig" style="--z:36px">${stickerSvg(a.sticker)}</span></span>
      <span class="grow">Sticker · ${esc(stickerInfo(a.sticker).en)}${a.reason ? ` · ${esc(a.reason)}` : ""}<br><span class="small muted">${new Date(a.awarded_at).toLocaleDateString()}</span></span>
      <button type="button" class="xbtn" data-act="stk-del" data-id="${a.id}" aria-label="Take this sticker back">×</button></div>`),
    ].join("") : `<p class="small muted" style="margin:0">Nothing yet. Session XP comes from attendance ticks.</p>`}
  </section>`;
}

async function giveXp(form) {
  const id = routeArg();
  const kind = isAdmin() ? state.awardKind || "bootcamp" : "bonus";
  const points = isAdmin() ? parseInt(form.points.value || "0", 10) || 0 : 0;
  if (Math.abs(points) > 2000) { toast("XP must be between -2000 and 2000."); return; }
  const camp = kind === "bootcamp" ? (form.camp?.value || "") : "";
  const extra = form.reason.value.trim();
  const reason = [camp, extra].filter(Boolean).join(" · ").slice(0, 120);
  const campObj = camp && Array.isArray(state.bootcamps) ? state.bootcamps.find((c) => c.title === camp) : null;
  const rw = campObj ? state.rewards?.get(bootKey(campObj)) : null;
  const sticker = state.awardSticker ?? (kind === "bootcamp" ? (rw ? rw.sticker || "" : stickerForBootcamp(camp)) : "");
  const owned = myStickers(id);
  const giveSticker = sticker && !owned.includes(sticker);
  if (!points && !giveSticker) { toast("Enter some XP or pick a sticker."); return; }
  const done = [];
  if (points) {
    const { data, error } = await sb.from("xp_awards").insert({ user_id: id, points, kind, reason }).select().single();
    if (error) { toast("Couldn't give XP."); return; }
    state.awards.unshift(data);
    done.push(`${points > 0 ? "+" : ""}${points} XP`);
  }
  if (giveSticker) {
    const { data, error } = await sb.from("sticker_awards").insert({ user_id: id, sticker, reason }).select().single();
    if (error) { toast(done.length ? `${done[0]} given, but the sticker failed.` : "Couldn't give the sticker."); }
    else { state.stickerAwards.unshift(data); done.push(`the ${stickerInfo(sticker).en} sticker`); }
  }
  state.awardSticker = undefined;
  form.reset();
  await refreshBoard();
  if (done.length) toast(`Gave ${done.join(" and ")}`);
}

async function refreshBoard() {
  state.activity?.clear();
  const { data } = await sb.rpc("xp_board");
  if (data) { state.board = data; for (const r of state.board) r.sticker = state.worn?.get(r.user_id) || null; }
  render();
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------
function draft() {
  if (!state.draft) state.draft = { ...state.me };
  return state.draft;
}

const STICKER_ICON = `<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M12 5H31L43 17V36A7 7 0 0 1 36 43H12A7 7 0 0 1 5 36V12A7 7 0 0 1 12 5Z" fill="#f37a48" stroke="#fff" stroke-width="2.5" stroke-linejoin="round"/><path d="M31 5V13A4 4 0 0 0 35 17H43Z" fill="#ffd9c2" stroke="#fff" stroke-width="2" stroke-linejoin="round"/><polygon points="22,17 24.4,22.8 30.6,23.2 25.8,27.2 27.3,33.3 22,30 16.7,33.3 18.2,27.2 13.4,23.2 19.6,22.8" fill="#fff"/></svg>`;
// ---------- Sticker collection: the Sticker Gallery 貼紙館 in Zest Town (#/learn/gallery) ----------
function sbGot() { return new Set(isHost() ? STICKERS.map((t) => t.key) : myStickers()); }
function sbCount() {
  const got = sbGot(), inBook = STICKER_PAGES.flatMap((p) => p.keys);
  return { n: inBook.filter((k) => got.has(k)).length, total: inBook.length };
}
function stickerBookBody() {
  const got = sbGot(), { n, total } = sbCount(), pct = Math.round((n / total) * 100);
  const slot = (k, i) => {
    const t = stickerInfo(k), name = `${t.en} ${zh(t.zh)}`;
    if (got.has(k)) return `<div class="sbslot got"${tipAttrs(name, t.how)}><span class="stkbig" style="--r:${[-4, 3, -2, 5, -3, 2][i % 6]}deg">${stickerSvg(k)}</span><b>${esc(t.en)}</b></div>`;
    if (MYSTERY_STICKERS.has(k)) return `<div class="sbslot" role="img" aria-label="Surprise sticker"><span class="sbq" aria-hidden="true">?</span><span>???</span></div>`;
    return `<div class="sbslot grey"${tipAttrs(name, t.how)}><span class="stkbig">${stickerSvg(k)}</span><span>${esc(t.en)}</span></div>`;
  };
  const page = (p) => `<section class="sbpage"><h3 class="sbtab" style="background:${p.color}">${esc(p.en)} <span>${zh(p.zh)}</span></h3>
    <span class="sbcount" aria-label="${p.keys.filter((k) => got.has(k)).length} of ${p.keys.length} collected">${p.keys.filter((k) => got.has(k)).length}/${p.keys.length}</span>
    <div class="sbgrid">${p.keys.map(slot).join("")}</div></section>`;
  const half = Math.ceil(STICKER_PAGES.length / 2);
  return `<section class="sbook" aria-label="My sticker collection">
    <div class="sbhead"><div class="sbtotal">${n} of ${total} collected</div>
      <div class="sbbar" role="progressbar" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${n}" aria-label="Stickers collected"><i style="width:${pct}%"></i></div>
      <span class="sbpct">${pct}%</span></div>
    <div class="sbleaves"><div class="sbleaf">${STICKER_PAGES.slice(0, half).map(page).join("")}</div><div class="sbleaf">${STICKER_PAGES.slice(half).map(page).join("")}</div></div>
    <p class="sbnote">${wide() ? "Hover over" : "Tap"} a grey sticker to see how to get it. Question marks are surprises, given at special events. Wear a sticker on your avatar from Me → Avatar customization.${isHost() ? " Hosts have them all; members see their own collection." : ""}</p>
  </section>`;
}
function galleryView() {
  return `${ztHeader(ztStreak(), `Sticker Gallery <span class='zhsub'>${trad() ? "貼紙館" : "贴纸馆"}</span>`)}
    <div class="row galhead" style="gap:12px;align-items:center"><span class="ztplaceart">${ztImg("gallery")}</span>
      <span class="grow"><b style="font-size:17px">Your sticker collection</b><br><span class="small muted">Stickers can't be bought: you earn them in bootcamps, Club life, achievements, special events and by reading.</span></span></div>
    <div class="galbook">${stickerBookBody()}</div>`;
}
function stickerBook() { // Me page: nothing while Zest Town is on (the full book only when Zest Town is off)
  const { n, total } = sbCount();
  if (!isBeta()) return `<details class="custom sbdet"${state.bookOpen ? " open" : ""}>
    <summary><span class="custicon sbicon" aria-hidden="true">${STICKER_ICON}</span><span class="grow"><b>My sticker collection</b><span class="small muted">${n} of ${total} collected · ${zh(["贴纸册", "貼紙冊"])}</span></span><span class="chev" aria-hidden="true">›</span></summary>
    <div class="custbody">${stickerBookBody()}</div></details>`;
  return ""; // the collection lives in the Sticker Gallery in Zest Town
}

// ---------------------------------------------------------------------------
// Idea box (Me page): suggestions and feedback → ideas table → "Ideas" tab of the Club members sheet
// ---------------------------------------------------------------------------
const BULB = '<svg viewBox="0 0 24 24" fill="none" stroke="#8a5a00" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.6 10.8c.6.5 1 1.2 1.1 2V17h5v-1.2c.1-.8.5-1.5 1.1-2A6 6 0 0 0 12 3z" fill="#ffd95a"/><path d="M12 7.5v3M10.5 9h3" stroke="#b07a00" stroke-width="1.5"/></svg>';
const IDEA_CATS = [["sessions", "Sessions"], ["app", "App features"], ["discord", "Discord"], ["other", "Something else"]];
const IDEA_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const IDEA_TIMES = ["Morning", "Afternoon", "Evening"];
const IDEA_NOTE = "We read every idea at the end of each month and will do our best to answer you.";
function ideaNew() {
  return { open: true, cat: "sessions", tz: state.me?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "",
    days: new Set(), times: new Set(), topic: "", level: state.me?.chinese_level || "", msg: "", sent: false, busy: false, first: true };
}
function tzOptions(cur) {
  let list = [];
  try { list = Intl.supportedValuesOf("timeZone"); } catch { /* old browser */ }
  if (cur && !list.includes(cur)) list = [cur, ...list];
  const off = (z) => { try { return new Intl.DateTimeFormat("en-US", { timeZone: z, timeZoneName: "shortOffset" }).formatToParts(new Date()).find((p) => p.type === "timeZoneName")?.value || ""; } catch { return ""; } };
  return list.map((z) => `<option value="${esc(z)}" ${z === cur ? "selected" : ""}>${esc(z.replace(/_/g, " "))}${z === cur ? ` (${off(z)})` : ""}</option>`).join("");
}
function ideaOverlay() {
  const f = state.idea;
  if (f.sent) return `<div class="hbover ideaover" role="dialog" aria-modal="true" aria-labelledby="ideathanks">
    <div class="hbbox"><span class="ideaicon big">${BULB}</span>
      <h2 id="ideathanks">Thank you! ${zh(["谢谢", "謝謝"])}!</h2>
      <p class="muted" style="margin:0">Your idea is in the box. ${IDEA_NOTE}</p>
      <button type="button" class="btn green block" data-act="idea-close">Close</button></div></div>`;
  const pill = (act, v, label, on) => `<button type="button" class="ideapill" data-act="${act}" data-v="${esc(v)}" aria-pressed="${on}">${label}</button>`;
  const ok = f.cat === "sessions" ? f.topic.trim() : f.msg.trim();
  const body = f.cat === "sessions" ? `
      <label class="field">Your time zone<select class="input" data-idea="tz">${tzOptions(f.tz)}</select></label>
      <div class="field"><span style="font-weight:700">Best days <span class="muted" style="font-weight:500">(optional)</span></span>
        <div class="ideachips">${IDEA_DAYS.map((d) => pill("idea-day", d, d, f.days.has(d))).join("")}</div></div>
      <div class="field"><span style="font-weight:700">Best time of day <span class="muted" style="font-weight:500">(optional)</span></span>
        <div class="ideachips">${IDEA_TIMES.map((t) => pill("idea-time", t, t, f.times.has(t))).join("")}</div></div>
      <label class="field">Topic you'd like<textarea class="input" data-idea="topic" maxlength="500" rows="2" style="padding:12px 14px;resize:vertical" placeholder="e.g. Ordering food at a night market">${esc(f.topic)}</textarea></label>
      <label class="field">Level<select class="input" data-idea="level">${LEVEL_OPTIONS.map((l) => `<option value="${esc(l)}" ${l === f.level ? "selected" : ""}>${l ? esc(l) : "Choose a level"}</option>`).join("")}</select></label>`
    : `<label class="field">Your idea<textarea class="input" data-idea="msg" maxlength="2000" rows="7" style="padding:12px 14px;resize:vertical" placeholder="${f.cat === "app" ? "What would make the app better for you?" : f.cat === "discord" ? "What would you like on our Discord?" : "Tell us anything: suggestions, feedback, ideas…"}">${esc(f.msg)}</textarea></label>
      <p class="small muted" style="margin:-6px 0 0">Your name is sent with your idea so we can follow up.</p>`;
  const first = f.first; f.first = false;
  return `<div class="hbover ideaover${first ? " first" : ""}" role="dialog" aria-modal="true" aria-labelledby="ideatitle">
    <div class="ideasheet">
      <div class="row" style="gap:12px;align-items:center"><span class="ideaicon">${BULB}</span>
        <div class="grow"><h2 id="ideatitle" style="margin:0">Idea box</h2><div class="small muted">${IDEA_NOTE}</div></div>
        <button type="button" class="iconbtn" data-act="idea-close" aria-label="Close">✕</button></div>
      <div class="ideachips" role="group" aria-label="About">${IDEA_CATS.map(([k, l]) => `<button type="button" class="ideacat" data-act="idea-cat" data-v="${k}" aria-pressed="${f.cat === k}">${l}</button>`).join("")}</div>
      ${body}
      <button type="button" class="btn green block" id="ideasend" data-act="idea-send" ${ok && !f.busy ? "" : "disabled"}>${f.busy ? "Sending…" : "Send my idea"}</button>
    </div></div>`;
}

function profileView() {
  const d = draft(), info = fruitInfo(d.fruit), idx = trad() ? 1 : 0;
  const level = myLevel();
  const changed = ["display_name", "fruit", "bg", "country", "chinese_level", "discord", "script", "phonetic", "bio", "sticker", "show_milestones"]
    .some((k) => (d[k] ?? null) !== (state.me[k] ?? null))
    || (isHost() && d.meet_name !== undefined && d.meet_name.trim() !== (state.meetName || ""));
  const stickerKeys = isHost() ? STICKERS.map((t) => t.key) : myStickers();
  return `
  <header class="row" style="gap:16px">
    ${avatar(d, 96)}
    <div class="grow">
      <div class="eyebrow">${state.role === "admin" ? "Admin · all fruits" : state.role === "host" ? "Host · all fruits" : `Level ${level} · ${myXp().toLocaleString()} XP`}</div>
      <h1>${esc(d.display_name || "Me")}</h1>
      <div style="font-size:15px;font-weight:700;color:var(--orange-ink);margin-top:4px">${zh(info.zh)} <span class="pron">${esc(py(info.py[idx]))}</span></div>
    </div>
    <button type="button" class="ideabtn" data-act="idea-open" aria-haspopup="dialog"><span>${BULB}</span>Idea box</button>
  </header>

  <form class="stack" data-form="profile" style="gap:16px">
    <label class="field">Name others see
      <input class="input" name="display_name" maxlength="40" value="${esc(d.display_name)}" autocomplete="nickname">
    </label>

    <label class="field">Short bio
      <textarea class="input" name="bio" maxlength="${BIO_MAX}" rows="2" style="padding:12px 14px;min-height:76px;resize:none" placeholder="e.g. Learning Chinese for my trip to Taipei. I love bubble tea and hiking.">${esc(d.bio || "")}</textarea>
      <span class="small muted" id="biocount" style="font-weight:500;text-align:right">${(d.bio || "").length}/${BIO_MAX}</span>
    </label>

    ${isHost() ? `<label class="field">Name you use on Google Meet
      <input class="input" name="meet_name" maxlength="60" value="${esc(d.meet_name ?? state.meetName ?? "")}" placeholder="as written after “Host:” in the calendar" autocomplete="off">
      <span class="small muted" style="font-weight:500">Only you see this. It puts your avatar on the sessions you host.</span>
    </label>` : ""}

    <details class="custom"${state.custOpen ? " open" : ""}>
    <summary><span class="custicon" aria-hidden="true"><svg viewBox="0 0 48 48"><path d="M6 14 h36 l-3 -8 h-30z" fill="#f37a48"/><path d="M6 14 q4.5 5 9 0 q4.5 5 9 0 q4.5 5 9 0 q4.5 5 9 0" fill="#fff" stroke="#f37a48" stroke-width="2"/><path d="M15 6 l-2 8 M24 6 v8 M33 6 l2 8" stroke="#fff" stroke-width="2"/><rect x="9" y="18" width="2.4" height="22" fill="#8a5a2b"/><rect x="36.6" y="18" width="2.4" height="22" fill="#8a5a2b"/><rect x="6" y="32" width="36" height="9" rx="2" fill="#c98d5a"/><circle cx="15" cy="29" r="4" fill="#f7941d"/><circle cx="23" cy="29.5" r="3.6" fill="#e5484d"/><circle cx="31" cy="29" r="4" fill="#9ccc3c"/><circle cx="19" cy="25.5" r="3.4" fill="#f5d442"/><circle cx="27.5" cy="25.5" r="3.4" fill="#f9a8a0"/><path d="M15 25 v-2 M31 25 v-2" stroke="#1b6f1b" stroke-width="1.6" stroke-linecap="round"/></svg></span><span class="grow"><b>Avatar customization</b><span class="small muted">${isHost() ? "Character or fruit" : "Fruit"}, ${stickerKeys.length ? "sticker, " : ""}background colour</span></span><span class="chev" aria-hidden="true">›</span></summary>
    <div class="custbody">
    <a class="unlocklink" href="#/unlocks">${ICON.unlock}<span class="grow"><b>How to unlock avatars &amp; stickers</b><br><span class="small muted">Levels, bootcamps, special sessions and more</span></span><span aria-hidden="true">›</span></a>
    ${isHost() ? `<div>
      <div class="row between" style="align-items:baseline;margin-bottom:8px"><h2>Host characters</h2><span class="small muted">Only hosts can use these</span></div>
      <div class="fruits">${HOST_AVATARS.map((h) => `<button type="button" class="fruitbtn" data-act="fruit" data-key="${h.key}" aria-pressed="${h.key === d.fruit}" aria-label="${esc(h.en)} ${esc(zh(h.zh))}">
          <span class="ring">${avatar(d, 48, { flag: false, fruit: h.key })}</span>
          <span class="cap">${esc(zh(h.zh))}</span></button>`).join("")}</div>
    </div>` : ""}
    ${(() => { const keys = isHost() ? SPECIAL_AVATARS.map((x) => x.key) : myAvatars(); return keys.length ? `<div>
      <div class="row between" style="align-items:baseline;margin-bottom:8px"><h2>Special avatars</h2><span class="small muted">${isHost() ? "Hosts have them all" : "From special events"}</span></div>
      <div class="fruits">${keys.map((k) => { const x = SPECIAL_AVATARS.find((y) => y.key === k); return x ? `<button type="button" class="fruitbtn" data-act="fruit" data-key="${k}" aria-pressed="${k === d.fruit}" aria-label="${esc(x.en)} ${esc(zh(x.zh))}">
          <span class="ring">${avatar(d, 48, { flag: false, fruit: k })}</span>
          <span class="cap">${esc(zh(x.zh))}</span></button>` : ""; }).join("")}</div>
    </div>` : ""; })()}
    <div>
      <div class="row between" style="align-items:baseline;margin-bottom:8px"><h2>${isHost() ? "Or a fruit" : "Your fruit"}</h2><span class="small muted">${isHost() ? "Hosts have them all" : level >= 18 ? "All unlocked!" : "Join sessions to unlock more"}</span></div>
      <div class="fruits">${FRUITS.map((f) => {
        const locked = f.level > level, on = f.key === d.fruit;
        return `<button type="button" class="fruitbtn" data-act="fruit" data-key="${f.key}" ${locked ? "disabled" : ""} aria-pressed="${on}" aria-label="${esc(f.en)} ${esc(zh(f.zh))}${locked ? `, unlocks at level ${f.level}` : ""}">
          <span class="ring">${avatar(d, 48, { locked, flag: false, fruit: f.key })}</span>
          <span class="cap">${locked ? `Lv ${f.level}` : esc(zh(f.zh))}</span></button>`;
      }).join("")}</div>
    </div>

    ${stickerKeys.length ? `<div>
      <div class="row between" style="align-items:baseline;margin-bottom:8px"><h2>Stickers</h2><span class="small muted">${isHost() ? "Hosts have them all" : `${stickerKeys.length} collected`}</span></div>
      <div class="stkpick">
        <button type="button" class="stkbtn" data-act="sticker" data-key="" aria-pressed="${!d.sticker}"><span class="stkbig none">—</span><span class="small">None</span></button>
        ${stickerKeys.map((k) => { const t = stickerInfo(k); return `<button type="button" class="stkbtn" data-act="sticker" data-key="${k}" aria-pressed="${d.sticker === k}" aria-label="${esc(t.en)} ${esc(zh(t.zh))}">
          <span class="stkbig">${stickerSvg(k)}</span><span class="small">${esc(zh(t.zh))}</span></button>`; }).join("")}
      </div>
      <p class="small muted" style="margin:8px 0 0">Your sticker shows at the bottom-left of your avatar.${isHost() ? " Members only see the stickers they've collected from bootcamps and other initiatives." : ""}</p>
    </div>` : ""}

    <div>
      <h2 style="margin-bottom:8px">Background</h2>
      <div class="swatches">${BACKGROUNDS.map(([hex, name]) =>
        `<button type="button" class="swatch" style="background:${hex}" data-act="bg" data-hex="${hex}" aria-label="${name}" aria-pressed="${hex === d.bg}"></button>`).join("")}</div>
    </div>
    </div>
    </details>

    <div class="grid2">
      <label class="field">Country
        <select class="input" name="country">
          <option value="">Choose…</option>
          ${COUNTRIES.map(([c, n]) => `<option value="${c}" ${c === d.country ? "selected" : ""}>${esc(n)}</option>`).join("")}
        </select>
      </label>
      <label class="field">Chinese level
        <select class="input" name="chinese_level">
          ${[...new Set([...LEVEL_OPTIONS, d.chinese_level])].map((l) => `<option value="${esc(l)}" ${l === d.chinese_level ? "selected" : ""}>${l ? esc(l) : "Choose…"}</option>`).join("")}
        </select>
      </label>
    </div>

    <label class="field">Discord name
      <input class="input" name="discord" maxlength="40" value="${esc(d.discord)}" placeholder="so members can find you" autocapitalize="off" autocomplete="off">
    </label>

    <div>
      <h2 style="margin-bottom:8px">Chinese characters</h2>
      <div class="seg" role="group" aria-label="Chinese characters">
        <button type="button" data-act="script" data-v="simplified" aria-pressed="${d.script === "simplified"}">简体 Simplified</button>
        <button type="button" data-act="script" data-v="traditional" aria-pressed="${d.script === "traditional"}">繁體 Traditional</button>
      </div>
    </div>

    <div>
      <h2 style="margin-bottom:8px">Pronunciation</h2>
      <div class="seg" role="group" aria-label="Pronunciation">
        <button type="button" data-act="phonetic" data-v="pinyin" aria-pressed="${(d.phonetic || "pinyin") === "pinyin"}">Pinyin</button>
        <button type="button" data-act="phonetic" data-v="zhuyin" aria-pressed="${d.phonetic === "zhuyin"}">注音 Zhuyin</button>
      </div>
      <p class="tiny muted" style="margin:6px 0 0">Pinyin <span lang="zh-Latn">nǐ hǎo</span> or zhuyin (bopomofo) <span lang="zh">ㄋㄧˇ ㄏㄠˇ</span>, shown everywhere in the app: notes, flashcards, the HSK Temple, the Library, the Calligraphy School…</p>
    </div>

    ${state.role === "member" ? `<div>
      <h2 style="margin-bottom:8px">Notice board</h2>
      <div class="seg" role="group" aria-label="Show my milestones on the notice board">
        <button type="button" data-act="milestones" data-v="1" aria-pressed="${d.show_milestones !== false}">Show my wins</button>
        <button type="button" data-act="milestones" data-v="0" aria-pressed="${d.show_milestones === false}">Keep them private</button>
      </div>
      <p class="tiny muted" style="margin:6px 0 0">The notice board in the Magical Forest celebrates members' milestones (streak tree, level ups, stickers, finished books, sessions joined) and lets others cheer 加油！</p>
    </div>` : ""}

    <button class="btn block" ${changed ? "" : "disabled"}>${changed ? "Save changes" : "Saved"}</button>
  </form>

  ${hongbaoMeCard()}
  ${stickerBook()}
  <section class="stack" style="gap:8px" aria-label="My personal discount code">
    <h2>My personal discount code</h2>
    <div class="row" style="gap:10px;flex-wrap:wrap;align-items:center">
      <button type="button" class="codechip" data-act="copy-code" aria-label="Copy discount code ${MEMBER_CODE}"><code>${MEMBER_CODE}</code><span aria-hidden="true">⧉</span></button>
      <a href="${SHOP_URL}" target="_blank" rel="noopener" style="font-weight:700;font-size:14.5px">Mandarin Zest shop ↗</a>
    </div>
    <span class="small muted">70% off all Mandarin Zest materials. Enter the code at checkout.</span>
  </section>
  <div class="mobonly" style="display:contents">${notificationsCard()}<p class="small muted privnote">Privacy: the Club team can see when you last opened the app and your Club activity (sessions, XP, stickers), only to keep the Club running well. It’s never shared.</p><p class="small muted privnote">App version ${APP_BUILD.slice(2)} · <button type="button" class="linkbtn" data-act="app-reload">Check for updates</button></p></div>
  ${installHint(true)}
  <button type="button" class="btn ghost block" data-tour-start>Take the app tour</button>
  <div class="row between">
    <span class="small muted">${esc(state.user.email)}</span>
    <button class="linkbtn" data-act="logout">Log out</button>
  </div>`;
}

async function saveProfile() {
  const d = draft();
  const patch = {};
  for (const k of ["display_name", "fruit", "bg", "country", "chinese_level", "discord", "script", "phonetic", "bio", "sticker"]) patch[k] = d[k] ?? null;
  if (state.role === "member" && typeof d.show_milestones === "boolean") patch.show_milestones = d.show_milestones;
  patch.display_name = String(patch.display_name || "").trim().slice(0, 40);
  patch.discord = String(patch.discord || "").trim().replace(/^@/, "").slice(0, 40);
  patch.bio = String(patch.bio || "").replace(/\s+/g, " ").trim().slice(0, BIO_MAX);
  if (isHost() && d.meet_name !== undefined && d.meet_name.trim() !== (state.meetName || "")) {
    const meet = d.meet_name.trim().slice(0, 60);
    const { error } = await sb.from("host_meet_names").upsert({ user_id: state.user.id, meet_name: meet, updated_at: new Date().toISOString() });
    if (error) { toast("Couldn't save your Google Meet name."); return; }
    state.meetName = meet;
    const sh = await sb.rpc("session_hosts");
    if (!sh.error) state.sessionHost = new Map(sh.data.map((x) => [x.session_id, x.host_id]));
  }
  const { data, error } = await sb.from("profiles").update(patch).eq("id", state.user.id).select().single();
  if (error) { toast("Couldn't save. Please try again."); return; }
  state.me = data; state.profiles.set(data.id, data); state.draft = null;
  toast("Saved");
  render();
}

// ---------------------------------------------------------------------------
// Notes as a PDF (made on the member's device; nothing stored on the server)
// ---------------------------------------------------------------------------
async function downloadNotesPdf(sid) {
  const s = state.sessions.find((x) => x.id === sid), n = state.notes.get(sid);
  if (!s || !n?.published_at) return;
  toast("Making your PDF…");
  try {
    const { jsPDF, html2canvas } = await import("./vendor/pdf.js?v=147");
    const a = new Date(s.starts_at);
    const date = a.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long", year: "numeric" });
    const vocab = (n.vocab || []).filter((v) => v.hanzi || v.pinyin || v.meaning);
    const lines = (n.body || "").split("\n");

    const page = document.createElement("div");
    page.className = "pdfpage";
    page.innerHTML = `
      <div class="pdfhead pdfblock"><img src="icons/logo.png" alt="" width="64" height="49">
        <div><div class="eyebrow">Mandarin Zest Club · Session notes</div><h1>${esc(s.title)}</h1>
        <div class="pdfmeta">${esc(date)} · ${fmtTime(a)}${s.host_name ? ` · host ${esc(s.host_name)}` : ""}${s.skill_level ? ` · ${esc(s.skill_level)}` : ""}</div></div></div>
      ${s.topic ? `<p class="pdfblock pdftopic">${esc(s.topic)}</p>` : ""}
      ${vocab.length ? `<h2 class="pdfblock">Vocabulary</h2>
        <div class="vocab">${vocab.map((v) => `<div class="vrow pdfblock"><span class="vz">${esc(v.hanzi)}</span><span class="vp">${esc(py(v.pinyin))}</span><span class="vm">${esc(v.meaning)}</span></div>`).join("")}</div>` : ""}
      ${n.body.trim() ? `<h2 class="pdfblock">Sentences &amp; corrections</h2>
        <div class="pdfbody">${lines.map((l) => `<p class="pdfblock">${l.trim() ? esc(l) : "&nbsp;"}</p>`).join("")}</div>` : ""}
      <div class="pdffoot pdfblock">From the Mandarin Zest Club app · app.mandarinzest.com</div>`;
    document.body.appendChild(page);
    await document.fonts?.ready;
    await Promise.all([...page.querySelectorAll("img")].map((img) => img.complete ? null : new Promise((r) => { img.onload = img.onerror = r; })));

    // A4 at 96 dpi. Break pages between blocks, never through a line.
    const W = 794, H = 1123, TOP = 48, BOTTOM = 56, SCALE = 2;
    const base = page.getBoundingClientRect().top;
    const ends = [];
    for (const el of page.querySelectorAll(".pdfblock")) {
      const r = el.getBoundingClientRect();
      if (el.tagName === "H2") { ends.push(r.top - base - 4); continue; } // never leave a heading at the bottom
      if (el.tagName === "P") {          // long paragraphs may break between their lines
        const range = document.createRange();
        range.selectNodeContents(el);
        for (const line of range.getClientRects()) ends.push(line.bottom - base);
      }
      ends.push(r.bottom - base);
    }
    ends.sort((x, y) => x - y);
    const total = page.scrollHeight;
    const canvas = await html2canvas(page, { scale: SCALE, backgroundColor: "#ffffff", useCORS: true, logging: false });
    page.remove();

    const pdf = new jsPDF({ unit: "px", format: [W, H], hotfixes: ["px_scaling"] });
    let start = 0, first = true;
    while (start < total - 2) {
      const room = H - (first ? 0 : TOP) - BOTTOM;
      let end = Math.min(total, start + room);
      if (end < total) {
        const fit = ends.filter((e) => e > start + 40 && e <= start + room);
        if (fit.length) end = fit[fit.length - 1] + 6;
      }
      const slice = document.createElement("canvas");
      slice.width = canvas.width;
      slice.height = Math.ceil((end - start) * SCALE);
      const ctx = slice.getContext("2d");
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, slice.width, slice.height);
      ctx.drawImage(canvas, 0, start * SCALE, canvas.width, slice.height, 0, 0, slice.width, slice.height);
      if (!first) pdf.addPage([W, H]);
      pdf.addImage(slice.toDataURL("image/jpeg", 0.92), "JPEG", 0, first ? 0 : TOP, W, end - start);
      start = end; first = false;
    }
    const day = `${a.getFullYear()}-${String(a.getMonth() + 1).padStart(2, "0")}-${String(a.getDate()).padStart(2, "0")}`;
    const name = `Mandarin Zest Club - ${s.title} - ${day}`.replace(/[\\/:*?"<>|]+/g, "").slice(0, 100);
    pdf.setProperties({ title: `${s.title} · Session notes`, author: "Mandarin Zest Club" });
    pdf.save(`${name}.pdf`);
  } catch (e) {
    console.error(e);
    document.querySelector(".pdfpage")?.remove();
    toast("Couldn't make the PDF. Please try again.");
  }
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------
// Desktop: settings get their own tab in the sidebar (on the phone they stay at the bottom of Me).
function settingsView() {
  return `<header><div class="eyebrow">Mandarin Zest Club</div><h1>Settings</h1></header>
  ${notificationsCard()}
  <p class="small muted privnote">App version ${APP_BUILD.slice(2)} · <button type="button" class="linkbtn" data-act="app-reload">Check for updates</button></p>
  <p class="small muted privnote">Privacy: the Club team can see when you last opened the app and your Club activity (sessions, XP, stickers), only to keep the Club running well. It’s never shared.</p>`;
}

// ---------------------------------------------------------------------------
// Admin tab (desktop sidebar, admins only): send a notification to members
// ---------------------------------------------------------------------------
const BC_PAGES = [["home", "Home"], ["sessions", "My sessions"], ["bootcamps", "Bootcamps"], ["members", "Members"], ["me", "Me"],
  ["learn", "Zest Town"], ["learn/cards", "Zest Town · Flashcard Center"], ["learn/temple", "Zest Town · HSK Temple"], ["learn/gallery", "Zest Town · Sticker Gallery"],
  ["learn/library", "Zest Town · Library (My shelf)"], ["learn/library?shop=1", "Zest Town · Library (Bookshop)"], ["learn/forest", "Zest Town · Magical Forest"]];
const BC_AUDIENCE = [["all", "Everyone"], ["members", "Members only"], ["hosts", "Hosts only"], ["pick", "Choose people"]];
const BC_CHANNEL = [
  ["push", "App notification only", "Only people who turned on notifications in the app get it."],
  ["fallback", "App notification, or email if they can't get one", "Everyone gets it once: in the app if they can, otherwise by email."],
  ["both", "App notification and email", "Everyone gets an email too, even if they got the app notification."],
  ["email", "Email only", "No app notification. Good for longer news or people who rarely open the app."],
];
const bcState = () => (state.bc ??= { title: "", body: "", page: "home", audience: "all", channel: "push", ids: new Set(), q: "", confirm: false, busy: false });
const firstName = (n) => String(n || "").trim().split(/\s+/)[0] || "there";
const bcFill = (t, n) => String(t).replace(/\{name\}/gi, firstName(n));
function bcPeople() {
  return [...state.profiles.values()].filter((p) => state.roles.get(p.id))
    .sort((a, b) => String(a.display_name || "").localeCompare(String(b.display_name || "")));
}
function bcTargets() {
  const b = bcState(), role = (p) => state.roles.get(p.id);
  return bcPeople().filter((p) => b.audience === "members" ? role(p) === "member"
    : b.audience === "hosts" ? role(p) === "host" || role(p) === "admin"
    : b.audience === "pick" ? b.ids.has(p.id) : true);
}
function bcReach() {
  const t = bcTargets(), reach = state.pushReach;
  const app = reach ? t.filter((p) => reach.has(p.id)).length : null;
  return { n: t.length, app };
}
function bcReachText() {
  const { n, app } = bcReach(), b = bcState();
  if (!n) return "Nobody selected yet.";
  const who = `${n} ${n === 1 ? "person" : "people"}`;
  if (b.channel === "email") return `${who} · by email`;
  if (app == null) return who;
  const noApp = n - app;
  return `${who} · ${app} with app notifications on${noApp ? ` · ${noApp} without${b.channel === "push" ? " (they won't get it)" : " (they'll get an email)"}` : ""}`;
}
function bcListHtml() {
  const b = bcState(), q = b.q.trim().toLowerCase(), reach = state.pushReach;
  const people = bcPeople().filter((p) => !q || String(p.display_name || "").toLowerCase().includes(q));
  return people.map((p) => `<label class="bcperson"><input type="checkbox" data-bcpick="${p.id}" ${b.ids.has(p.id) ? "checked" : ""}>
    ${avatar(p, 32, { flag: false })}<span class="grow"><b>${esc(p.display_name || "Member")}</b>${state.roles.get(p.id) !== "member" ? ` <span class="small muted">(host)</span>` : ""}</span>
    ${reach && !reach.has(p.id) ? `<span class="small muted" title="No app notifications on any device">no app notif.</span>` : ""}</label>`).join("") || `<p class="small muted" style="margin:0">No one matches.</p>`;
}
function bcPreviewHtml() {
  const b = bcState(), me = state.me?.display_name;
  return `<div class="bcnotif"><img src="icons/icon-192.png" alt=""><div class="grow"><div class="row between"><b>${esc(bcFill(b.title || "Title", me)) }</b><span class="small muted">now</span></div>
    <div>${esc(bcFill(b.body || "Your message", me))}</div></div></div>`;
}
function bcUpdate() {
  const set = (id, html) => { const el = document.getElementById(id); if (el) el.innerHTML = html; };
  set("bcpreview", bcPreviewHtml()); set("bcreach", esc(bcReachText()));
  const n = bcReach().n, b = bcState(), btn = document.getElementById("bcsend");
  if (btn) { btn.disabled = !n || !b.title.trim() || !b.body.trim(); btn.textContent = `Send to ${n} ${n === 1 ? "person" : "people"}`; }
  const t = document.getElementById("bctest"); if (t) t.disabled = !b.title.trim() || !b.body.trim();
}

function adminView() {
  if (!isAdmin()) return `<div class="card"><h2>Admins only</h2></div>`;
  const b = bcState();
  if (!state.pushReach && !state.pushReachLoading) {
    state.pushReachLoading = true;
    sb.rpc("admin_push_reach").then(({ data }) => { state.pushReach = new Set((data || []).map((r) => (typeof r === "string" ? r : Object.values(r)[0]))); if (route() === "admin") render(); });
  }
  if (!state.broadcasts && !state.broadcastsLoading) {
    state.broadcastsLoading = true;
    sb.from("admin_broadcasts").select("*").order("created_at", { ascending: false }).limit(20)
      .then(({ data }) => { state.broadcasts = data || []; state.broadcastsLoading = false; if (route() === "admin") render(); });
  }
  const n = bcReach().n, ready = n && b.title.trim() && b.body.trim();
  const chLabel = (c) => (BC_CHANNEL.find((x) => x[0] === c) || [, c])[1];
  if ((state.adminTab || "activity") === "activity") return adminHeader() + activityAdmin();
  return adminHeader() + `
  <section class="card bccard">
    <div class="row between" style="align-items:baseline"><h2>Send a notification</h2><span class="small muted">Admins only</span></div>
    <div class="bcgrid">
      <div class="stack" style="gap:14px">
        <label class="field">Title<input class="input" data-bc="title" maxlength="80" value="${esc(b.title)}" placeholder="e.g. {name}, a new bootcamp is open!"></label>
        <label class="field">Message<textarea class="input" data-bc="body" maxlength="300" rows="4" style="padding:12px 14px;resize:vertical">${esc(b.body)}</textarea></label>
        <p class="small muted" style="margin:-6px 0 0">Type <code>{name}</code> to insert each person's first name.</p>
        <label class="field">Tapping it opens
          <select class="input" data-bc="page">${BC_PAGES.map(([k, l]) => `<option value="${k}" ${b.page === k ? "selected" : ""}>${l}</option>`).join("")}</select></label>
        <div><div class="bclabel">Send to</div>
          <div class="periods" style="justify-content:flex-start;flex-wrap:wrap" role="group" aria-label="Send to">${BC_AUDIENCE.map(([k, l]) => `<button type="button" data-act="bc-aud" data-v="${k}" aria-pressed="${b.audience === k}">${l}</button>`).join("")}</div>
          ${b.audience === "members" ? `<p class="small muted" style="margin:8px 0 0">Hosts and admins (you too) don't get it. Use “Send me a test” to see how it looks.</p>` : ""}
          ${b.audience === "pick" ? `<div class="bcpick"><div class="row" style="gap:8px"><input class="input grow" data-bc="q" placeholder="Search a name" value="${esc(b.q)}">
            <button type="button" class="btn ghost" data-act="bc-none">Clear (${b.ids.size})</button></div><div id="bclist" class="bclist">${bcListHtml()}</div></div>` : ""}
        </div>
        <div><div class="bclabel">How</div>
          <div class="stack" style="gap:8px">${BC_CHANNEL.map(([k, l, h]) => `<label class="bcradio"><input type="radio" name="bcchannel" data-act-change="bc-ch" value="${k}" ${b.channel === k ? "checked" : ""}><span><b>${l}</b><br><span class="small muted">${h}</span></span></label>`).join("")}</div>
          <p class="small muted" style="margin:8px 0 0">People who turned off emails in their settings never get one. Email limit on the free plan: 100 a day and 3,000 a month, shared with reminders and bootcamp requests.</p>
        </div>
      </div>
      <div class="stack bcside" style="gap:12px">
        <div class="bclabel">Preview <span class="small muted" style="font-weight:500">(with your name)</span></div>
        <div id="bcpreview">${bcPreviewHtml()}</div>
        <div class="bcreach" id="bcreach">${esc(bcReachText())}</div>
        ${b.confirm ? `<div class="bootreq ask"><p style="margin:0"><b>Send this to ${n} ${n === 1 ? "person" : "people"} now?</b><br><span class="small">${esc(chLabel(b.channel))}. This can't be undone.</span></p>
            <div class="row" style="gap:10px;flex-wrap:wrap"><button type="button" class="btn green grow" data-act="bc-send" ${b.busy ? "disabled" : ""}>${b.busy ? "Sending…" : "Yes, send it"}</button><button type="button" class="btn ghost" data-act="bc-cancel">Cancel</button></div></div>`
          : `<button type="button" class="btn green block" id="bcsend" data-act="bc-ask" ${ready ? "" : "disabled"}>Send to ${n} ${n === 1 ? "person" : "people"}</button>`}
        <button type="button" class="btn ghost block" id="bctest" data-act="bc-test" ${b.title.trim() && b.body.trim() ? "" : "disabled"}>Send me a test first</button>
      </div>
    </div>
  </section>
  <section class="card" style="gap:0">
    <h2 style="margin-bottom:6px">Sent</h2>
    ${!state.broadcasts ? `<p class="small muted" style="margin:0">Loading…</p>` : state.broadcasts.length ? state.broadcasts.map((x) => `<div class="awardrow" style="align-items:flex-start">
      <span class="grow"><b>${esc(x.title)}</b><br><span class="small">${esc(x.body)}</span><br>
      <span class="small muted">${esc(new Date(x.created_at).toLocaleString([], { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }))} · ${esc(x.audience === "all" ? "Everyone" : x.audience === "members" ? "Members" : x.audience === "hosts" ? "Hosts" : x.audience)} · ${esc(chLabel(x.channel))}</span></span>
      <span class="small" style="text-align:right;white-space:nowrap">${x.sent_push} app<br>${x.sent_email} email${x.unreached ? `<br><span class="muted">${x.unreached} not reached</span>` : ""}</span></div>`).join("")
      : `<p class="small muted" style="margin:0">Nothing sent yet.</p>`}
  </section>`;
}

async function bcSend(test) {
  const b = bcState();
  const { data: { session } } = await sb.auth.getSession();
  const res = await fetch(`${SUPABASE_URL}/functions/v1/admin-notify`, {
    method: "POST", headers: { Authorization: `Bearer ${session.access_token}`, apikey: SUPABASE_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ title: b.title, body: b.body, page: b.page, audience: b.audience, ids: [...b.ids], channel: b.channel, test }),
  }).then((r) => r.json()).catch(() => ({ ok: false }));
  if (!res.ok) { toast(res.error || "Couldn't send it. Please try again."); return false; }
  if (test) toast(res.push && res.email ? "Test sent to your devices and your email." : res.push ? "Test sent to your devices." : res.email ? "Test sent to your email."
    : b.channel === "email" ? (res.emailOff ? "Emails are off until the Resend key is set." : "Couldn't email you. Check that emails are on in your Settings.")
    : "No device of yours has app notifications on. Turn them on in Settings to see the test.");
  else toast(`Sent: ${res.push} in the app, ${res.email} by email${res.unreached ? `. ${res.unreached} not reached (no app notifications${b.channel === "push" ? "" : " and no email"})` : ""}.${res.emailOff && b.channel !== "push" ? " Emails are off until the Resend key is set." : ""}`);
  return true;
}

// ---------------------------------------------------------------------------
// Activity tracking: one "app open" per 30 minutes, with the kind of device (for the admin Activity board)
// ---------------------------------------------------------------------------
function deviceKind() {
  const ua = navigator.userAgent || "";
  const ipad = /iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const tablet = ipad || (/Android/.test(ua) && !/Mobile/.test(ua));
  const phone = !tablet && /iPhone|iPod|Android.*Mobile|Mobile/.test(ua);
  const installed = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  return phone ? (installed ? "phone-app" : "phone-browser") : tablet ? "tablet" : "computer";
}
let lastOpenLog = 0;
function logOpen() {
  if (!state.user || Date.now() - lastOpenLog < 30 * 60e3) return;
  lastOpenLog = Date.now();
  sb.rpc("log_open", { p_device: deviceKind() }).then(() => {}, () => {});
}
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && state.loaded) logOpen(); });

// ---------------------------------------------------------------------------
// Admin → Activity board (members only; hosts and admins are left out)
// ---------------------------------------------------------------------------
const DEVICE_LABEL = { "phone-app": "Phone · app", "phone-browser": "Phone · browser", tablet: "Tablet", computer: "Computer" };
function adminHeader() {
  const t = state.adminTab || "activity";
  return `<header><div class="eyebrow">Mandarin Zest Club</div><h1>Admin</h1></header>
  <div class="admtabs" role="tablist">${[["activity", "Activity"], ["notify", "Send a notification"]].map(([k, l]) =>
    `<button type="button" role="tab" aria-selected="${t === k}" data-act="adm-tab" data-v="${k}">${l}</button>`).join("")}</div>`;
}
function ago(d) {
  if (!d) return "Never";
  const m = Math.round((Date.now() - new Date(d)) / 60e3);
  if (m < 1) return "Just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const days = Math.round(h / 24);
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days} days ago`;
  return new Date(d).toLocaleDateString([], { day: "numeric", month: "short" });
}
const actStatus = (d) => { const days = d ? (Date.now() - new Date(d)) / 864e5 : Infinity; return days < 7 ? "active" : days < 14 ? "quiet" : "inactive"; };
function actLoad(force) {
  const a = (state.adm ??= { filter: "all", q: "", group: "all", feed: null, feedMore: true });
  if (a.loading && !force) return;
  if (a.members && !force) return;
  a.loading = true;
  Promise.all([sb.rpc("admin_activity_members"), sb.rpc("admin_activity_daily"), sb.rpc("admin_activity_feed", { p_group: a.group, p_limit: 30 })])
    .then(([m, d, f]) => {
      a.members = m.data || []; a.daily = d.data || []; a.feed = f.data || []; a.feedMore = (f.data || []).length === 30;
      a.loading = false; a.at = Date.now();
      if (route() === "admin") render();
    });
}
async function actFeed(more) {
  const a = state.adm, before = more && a.feed?.length ? a.feed[a.feed.length - 1].at : null;
  const { data } = await sb.rpc("admin_activity_feed", { p_group: a.group, p_before: before, p_limit: 30 });
  a.feed = more ? (a.feed || []).concat(data || []) : (data || []);
  a.feedMore = (data || []).length === 30;
  if (route() === "admin") render();
}
function feedText(e) {
  const L = esc(e.label || "");
  switch (e.kind) {
    case "open": return `opened the app${L ? " " + L : ""}`;
    case "imin": return `said “I’m in” to <b>${L}</b>`;
    case "cant": return `can’t make it to <b>${L}</b>`;
    case "attended": return `came to <b>${L}</b>`;
    case "hongbao": return `sent a hongbao 红包 to <b>${L}</b>`;
    case "idea": return `sent an idea · ${L}`;
    case "bootcamp": return `asked to join <b>${L}</b>`;
    case "sticker": return `got the <b>${esc(stickerInfo(e.label)?.en || e.label)}</b> sticker`;
    case "book_stripe": return `bought <b class="lzh">${L}</b> in the Bookshop`;
    case "book_claim": return `claimed <b class="lzh">${L}</b> as their free book`;
    case "book_gift": return `was given <b class="lzh">${L}</b> by an admin`;
    case "town_fc_session": return `finished a flashcard review · ${L}`;
    case "town_hsk_temple": return `used the HSK Temple`;
    case "town_lib_chapter": return `read <b class="lzh">${L}</b> in the Library`;
    case "town_cg_box": return `finished their character box round · ${L}`;
    case "town_cg_pack": return `added ${L} from a character package`;
    case "town_co_chapter": return `finished Oracle Bone chapter <b>${L}</b>`;
    case "town_letter": return `sent a letter to <b>${L}</b> at the Post Office`;
    case "town_qilin": return `claimed a qilin challenge 麒麟 · ${L}`;
    case "xp": { const [p, ...r] = String(e.label).split(" · "); return `got <b>${+p > 0 ? "+" : ""}${esc(p)} XP</b>${r.length ? " · " + esc(r.join(" · ")) : ""}`; }
    default: return L;
  }
}
function activityAdmin() {
  actLoad();
  const a = state.adm;
  if (!a.members) return `<section class="card"><p class="muted" style="margin:0">Loading activity…</p></section>`;
  const ms = a.members, total = ms.length, d = a.daily || [];
  const today = d[d.length - 1] || { members: 0, opens: 0 }, lastWeekDay = d[d.length - 8] || { members: 0 };
  const sum = (arr) => arr.reduce((t, x) => t + (x.opens || 0), 0);
  const opens7 = sum(d.slice(-7)), opensPrev = sum(d.slice(-14, -7));
  const counts = { active: 0, quiet: 0, inactive: 0 };
  ms.forEach((m) => counts[actStatus(m.last_seen)]++);
  const notif = ms.filter((m) => m.notif).length;
  const diff = (a2, b2, word) => a2 === b2 ? `Same as ${word}` : `${a2 > b2 ? "↑" : "↓"} ${Math.abs(a2 - b2)} vs ${word}`;
  const tile = (v, l, sub, cls = "") => `<div class="acttile"><span>${l}</span><b>${v}</b><span class="sub ${cls}">${sub}</span></div>`;
  const max = Math.max(4, ...d.map((x) => x.members));
  const dfmt = (s) => new Date(s + "T12:00:00").toLocaleDateString([], { day: "numeric", month: "short" });
  const chart = `<section class="card actchart"><div class="row between" style="align-items:baseline;gap:8px;flex-wrap:wrap">
      <h2 style="margin:0">Members who opened the app, per day</h2><span class="small muted">Last 30 days (Taiwan time) · today: <b class="green">${today.members}</b></span></div>
    <div class="actbars" role="img" aria-label="Members who opened the app each day over the last 30 days">${d.map((x, i) =>
      `<div class="actbar${i === d.length - 1 ? " now" : ""}" style="height:${Math.max(2, (x.members / max) * 100)}%" title="${esc(dfmt(x.day))}: ${x.members} member${x.members === 1 ? "" : "s"}, ${x.opens} open${x.opens === 1 ? "" : "s"}"></div>`).join("")}</div>
    <div class="row between small muted"><span>${d[0] ? esc(dfmt(d[0].day)) : ""}</span><span>${d[15] ? esc(dfmt(d[15].day)) : ""}</span><span>Today</span></div>
    </section>`;
  const q = a.q.trim().toLowerCase();
  const rows = ms.filter((m) => (a.filter === "all" || actStatus(m.last_seen) === a.filter) && (!q || String(m.name || "").toLowerCase().includes(q)))
    .sort((x, y) => new Date(y.last_seen || 0) - new Date(x.last_seen || 0));
  const chip = (k, l) => `<button type="button" class="actchip" data-act="adm-filter" data-v="${k}" aria-pressed="${a.filter === k}">${l}</button>`;
  const table = `<section class="card acttable"><div class="row" style="gap:8px;flex-wrap:wrap;align-items:center">
      <h2 class="grow" style="margin:0">Members</h2>${chip("all", `All ${total}`)}${chip("active", `Active ${counts.active}`)}${chip("quiet", `Quiet ${counts.quiet}`)}${chip("inactive", `Inactive ${counts.inactive}`)}
      <input class="input actsearch" data-admq placeholder="Search a name" value="${esc(a.q)}" aria-label="Search a member"></div>
    <div class="actgrid acthead" aria-hidden="true"><span>Member</span><span>Last seen</span><span>Device</span><span>Opens 7d</span><span>Sessions 30d</span><span>“I’m in” 7d</span><span>XP month</span><span>Notif.</span></div>
    <div id="actrows">${rows.map((m) => { const p = state.profiles.get(m.user_id) || { id: m.user_id, display_name: m.name }, st = actStatus(m.last_seen);
      return `<a class="actgrid actrow2" href="#/member/${m.user_id}">
        <span class="row" style="gap:10px;min-width:0">${avatar(p, 32, { flag: false })}<b class="ellip">${esc(m.name || p.display_name || "Member")}</b></span>
        <span class="row" style="gap:6px"><i class="actdot ${st}" aria-label="${st}"></i>${esc(ago(m.last_seen))}</span>
        <span class="muted">${esc(DEVICE_LABEL[m.device] || "—")}</span><span>${m.opens_7d}</span><span>${m.sessions_30d}</span><span>${m.imin_7d}</span>
        <span class="green" style="font-weight:700">${m.xp_month > 0 ? "+" : ""}${m.xp_month}</span><span class="${m.notif ? "green" : "muted"}" style="font-weight:700">${m.notif ? "On" : "Off"}</span></a>`; }).join("") || `<p class="small muted" style="padding:12px">No member here.</p>`}</div>
    <p class="small muted" style="margin:6px 0 0">Last seen = the last time they used the app (counted to within about an hour). Active: used the app in the last 7 days · Quiet: 7 to 14 days · Inactive: 14+ days. The device shows from 17 Nov.</p></section>`;
  const gchip = (k, l) => `<button type="button" class="actchip" data-act="adm-group" data-v="${k}" aria-pressed="${a.group === k}">${l}</button>`;
  const feed = `<section class="card actfeed"><div class="row between"><h2 style="margin:0">Live activity</h2><button type="button" class="linkbtn" data-act="adm-refresh">Refresh</button></div>
    <div class="row" style="gap:6px;flex-wrap:wrap">${gchip("all", "Everything")}${gchip("sessions", "Sessions")}${gchip("learning", "Learning")}${gchip("community", "Community")}</div>
    <div>${(a.feed || []).map((e) => { const p = state.profiles.get(e.user_id) || { id: e.user_id, display_name: e.name };
      return `<div class="feedrow">${avatar(p, 30, { flag: false })}<span class="grow"><a href="#/member/${e.user_id}"><b>${esc(e.name || "Member")}</b></a> ${feedText(e)}<br><span class="small muted">${esc(ago(e.at))}</span></span></div>`; }).join("") || `<p class="small muted">Nothing yet.</p>`}</div>
    ${a.feedMore ? `<button type="button" class="linkbtn" data-act="adm-older" style="align-self:center">Show older</button>` : ""}</section>`;
  return `<div class="actlayout"><div class="stack" style="gap:16px;min-width:0">
    <div class="acttiles">${tile(today.members, "Opened the app today", diff(today.members, lastWeekDay.members, "last week"))}
      ${tile(`${counts.active} / ${total}`, "Active this week", `${total ? Math.round((counts.active / total) * 100) : 0}% of members`)}
      ${tile(opens7, "App opens this week", diff(opens7, opensPrev, "the week before"))}
      ${tile(counts.inactive, "Inactive 14+ days", counts.inactive ? "Worth a message" : "Everyone is around", counts.inactive ? "red" : "")}
      ${tile(`${notif} / ${total}`, "Notifications on", total - notif ? `${total - notif} can’t get them` : "Everyone", total - notif ? "amber" : "")}</div>
    ${chart}${table}</div>${feed}</div>`;
}

function notificationsCard() {
  const p = state.push, me = state.me;
  let device;
  if (!p.supported) {
    device = isIOS() && !standalone()
      ? `<p class="small" style="margin:0;line-height:1.45">On iPhone, notifications work once the app is on your Home Screen (Share → <b>Add to Home Screen</b>), then open it from there.</p>`
      : `<p class="small" style="margin:0;line-height:1.45">This browser can't show app notifications. You'll get emails instead.</p>`;
  } else if (p.permission === "denied") {
    device = `<p class="small" style="margin:0;line-height:1.45">Notifications are blocked for this app. Allow them in your browser's site settings (tap the icon next to the address), then come back here.</p>`;
  } else if (p.subscribed) {
    device = `<div class="row" style="flex-wrap:wrap;gap:8px"><span class="small" style="color:var(--green);font-weight:800">On for this device ✓</span>
      <button type="button" class="btn ghost" data-act="push-test" style="min-height:40px">Send me a test</button>
      <button type="button" class="linkbtn" data-act="push-off">Turn off</button></div>`;
  } else {
    device = `<button type="button" class="btn green block" data-act="push-on">${ICON.bell}Turn on notifications</button>`;
  }
  const tog = (k, label, sub) => `<label class="check"><input type="checkbox" data-pref="${k}" ${me[k] ? "checked" : ""}>
    <span style="font-size:14.5px;line-height:1.35"><b>${label}</b><br><span class="muted">${sub}</span></span></label>`;
  return `<section class="stack" style="gap:10px" aria-label="Notifications" id="notifications">
    <h2>Notifications</h2>
    ${device}
    ${tog("notify_reminders", "Session reminders and changes", "1 hour before sessions you said you'd join, and if one is cancelled or moved")}
    ${tog("notify_new", "New sessions", "When a new session is added to the calendar")}
    ${tog("notify_notes", "Notes are up", "When your host shares the notes of a session you joined")}
    ${tog("notify_rewards", "Rewards", "New level, character, sticker, XP or hongbao")}
    ${isBeta() ? tog("notify_streak", "Streak reminder", "1 hour before your day ends, if your streak tree hasn't grown yet (phone notification only)") : ""}
    ${tog("notify_email", "Email me instead", "For reminders and notes, when this app can't notify you")}
  </section>`;
}

async function checkPush() {
  const ok = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  state.push.supported = ok;
  if (!ok) return;
  state.push.permission = Notification.permission;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    state.push.subscribed = !!sub && Notification.permission === "granted";
    if (sub && state.push.subscribed) await saveSubscription(sub); // keep it attached to this account
    // On by default: permission already given but no subscription (e.g. new phone, cleared data) → turn it back on quietly,
    // unless they turned notifications off themselves.
    if (!state.push.subscribed && Notification.permission === "granted" && !lsGet("mz-push-off")) await enablePush(true);
  } catch { /* ignore */ }
  // Never asked on this device: offer it right away (browsers only allow it after a tap). "Not now" asks again in a week.
  const later = Number(lsGet("mz-push-later") || 0);
  if (state.push.permission === "default" && !state.push.subscribed && !lsGet("mz-push-off") && Date.now() - later > 7 * 864e5) state.pushAsk = true;
  keepForm(() => render());
}

function lsGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function lsSet(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* private mode */ } }

function pushOverlay() {
  if (!state.pushAsk || state.seasonalPopup || document.querySelector(".hbover")) return "";
  return `<div class="hbover" role="dialog" aria-modal="true" aria-labelledby="pushasktitle">
    <div class="hbbox">
      <img src="icons/icon-192.png" alt="" style="width:72px;height:72px;border-radius:18px;align-self:center">
      <h2 id="pushasktitle">Stay in the loop</h2>
      <p class="muted" style="margin:0">Get a reminder 1 hour before the sessions you join, a heads-up if one is moved or cancelled, and news from the Club team.</p>
      <button type="button" class="btn green block" data-act="push-ask-yes">${ICON.bell}Turn on notifications</button>
      <button type="button" class="linkbtn" data-act="push-ask-no" style="align-self:center">Not now</button>
      <p class="small muted" style="margin:0">You can turn them off anytime in ${wide() ? "Settings" : "Me"}.</p>
    </div></div>`;
}

function b64ToBytes(b64) {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function saveSubscription(sub) {
  const j = sub.toJSON();
  const row = { endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, user_id: state.user.id, user_agent: navigator.userAgent.slice(0, 200) };
  const { error } = await sb.from("push_subscriptions").upsert(row, { onConflict: "endpoint" });
  return !error;
}

async function enablePush(quiet = false) {
  try {
    const perm = await Notification.requestPermission();
    state.push.permission = perm;
    if (perm !== "granted") { keepForm(() => render()); return; }
    lsSet("mz-push-off", null);
    const reg = await navigator.serviceWorker.ready;
    const sub = (await reg.pushManager.getSubscription())
      || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(VAPID_PUBLIC) });
    if (!(await saveSubscription(sub))) throw new Error("save");
    state.push.subscribed = true;
    if (quiet) return;
    toast("Notifications are on");
    keepForm(() => render());
    testPush(true);
  } catch (e) {
    console.error(e);
    if (!quiet) toast("Couldn't turn on notifications. Try again.");
  }
}

async function disablePush() {
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await sb.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
      await sub.unsubscribe();
    }
  } catch { /* ignore */ }
  lsSet("mz-push-off", "1");
  state.push.subscribed = false;
  keepForm(() => render());
}

async function testPush(quiet = false) {
  const { data: { session } } = await sb.auth.getSession();
  const res = await fetch(`${SUPABASE_URL}/functions/v1/push-test`, {
    method: "POST", headers: { Authorization: `Bearer ${session.access_token}`, apikey: SUPABASE_KEY },
  }).then((r) => r.json()).catch(() => ({}));
  if (!quiet) toast(res.ok ? "Test sent. It should arrive in a few seconds." : "The test didn't reach this device. Try turning notifications off and on.");
}

async function savePref(key, value) {
  state.me[key] = value;
  if (state.draft) state.draft[key] = value;
  const { error } = await sb.from("profiles").update({ [key]: value }).eq("id", state.user.id);
  toast(error ? "Couldn't save that setting." : "Saved");
}

// ---------------------------------------------------------------------------
// Install hint
// ---------------------------------------------------------------------------
const standalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

function installHint(always = false) {
  if (standalone()) return "";
  if (!always && localStorage.getItem("mz-hide-install") === "1") return "";
  const how = isIOS()
    ? "On iPhone: tap Share, then <b>Add to Home Screen</b>."
    : state.installPrompt ? "" : "On Android: open the browser menu, then <b>Install app</b> or <b>Add to Home screen</b>.";
  return `<div class="card mint" style="flex-direction:row;align-items:flex-start;gap:12px">
    ${ICON.phone}
    <div class="grow small" style="line-height:1.45"><b>Add the app to your Home Screen</b> to open it in one tap${how ? `. ${how}` : "."}
      ${state.installPrompt ? `<div style="margin-top:8px"><button class="btn green" data-act="install">Install app</button></div>` : ""}
      ${!always && state.user ? `<div><button class="linkbtn" data-act="hide-install">Hide this</button></div>` : ""}
    </div></div>`;
}

addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); state.installPrompt = e; render(); });

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------
document.addEventListener("submit", async (e) => {
  const form = e.target.closest("form[data-form]");
  if (!form) return;
  e.preventDefault();
  const kind = form.dataset.form;
  if (kind === "email") {
    const email = form.querySelector("#email").value.trim().toLowerCase();
    if (email) sendCode(email);
  } else if (kind === "code") {
    const code = form.querySelector("#code").value.replace(/\D/g, "");
    if (code.length >= 6) verifyCode(code);
    else { state.login.error = "Enter the code from the email."; render(); }
  } else if (kind === "profile") {
    saveProfile();
  } else if (kind === "reward") {
    await saveReward(form);
  } else if (kind === "award") {
    const btn = form.querySelector("button.btn"); btn.disabled = true;
    await giveXp(form);
  }
});

document.addEventListener("input", (e) => {
  if (e.target.matches?.("[data-admq]") && state.adm) {
    state.adm.q = e.target.value;
    const pos = e.target.selectionStart; render();
    const f = document.querySelector("[data-admq]"); if (f) { f.focus(); f.setSelectionRange(pos, pos); }
    return;
  }
  if (e.target.dataset.idea && state.idea) {
    state.idea[e.target.dataset.idea] = e.target.value;
    const f = state.idea, b = document.getElementById("ideasend");
    if (b) b.disabled = !(f.cat === "sessions" ? f.topic.trim() : f.msg.trim()) || f.busy;
    return;
  }
  if (e.target.dataset.bc) {
    const b = bcState(); b[e.target.dataset.bc] = e.target.value;
    if (e.target.dataset.bc === "q") { const l = document.getElementById("bclist"); if (l) l.innerHTML = bcListHtml(); }
    bcUpdate(); return;
  }
  if (e.target.id === "notesearch") {
    const q = e.target.value.trim().toLowerCase();
    let shown = 0;
    for (const el of document.querySelectorAll("#notelist .noteitem")) { const hit = !q || el.dataset.text.includes(q); el.hidden = !hit; shown += hit; }
    const empty = document.getElementById("notesempty"); if (empty) empty.hidden = shown > 0;
    return;
  }
  const form = e.target.closest('form[data-form="profile"]');
  if (!form || !e.target.name) return;
  const d = draft();
  d[e.target.name] = e.target.type === "checkbox" ? e.target.checked : e.target.value;
  if (e.target.name === "bio") { const c = document.getElementById("biocount"); if (c) c.textContent = `${e.target.value.length}/${BIO_MAX}`; }
  const btn = form.querySelector(".btn.block");
  if (btn) { btn.disabled = false; btn.textContent = "Save changes"; }
});

document.addEventListener("click", async (e) => {
  const el = e.target.closest("[data-act]");
  if (!el) return;
  const act = el.dataset.act;
  if (act === "open") {
    const id = el.dataset.id;
    state.open.has(id) ? state.open.delete(id) : state.open.add(id);
    render();
  } else if (act === "cal-day") {
    state.calDay = el.dataset.v; render();
  } else if (act === "toggle-in") {
    await toggleIn(el.dataset.id);
  } else if (act === "milestones") {
    draft().show_milestones = el.dataset.v === "1"; keepForm(() => render());
  } else if (act === "fruit" || act === "bg" || act === "script" || act === "phonetic") {
    const d = draft();
    if (act === "fruit") d.fruit = el.dataset.key;
    if (act === "bg") d.bg = el.dataset.hex;
    if (act === "script") d.script = el.dataset.v;
    if (act === "phonetic") d.phonetic = el.dataset.v;
    keepForm(() => render());
  } else if (act === "logout") {
    await sb.auth.signOut();
    Object.assign(state, { user: null, role: null, me: null, loaded: false, draft: null });
    state.login = { step: "email", email: "", error: "", busy: false };
    location.hash = "";
    render();
  } else if (act === "retry") {
    const { data } = await sb.auth.getUser();
    if (data.user) await startSession(data.user);
  } else if (act === "login-back") {
    state.login.step = "email"; state.login.error = ""; render();
  } else if (act === "login-resend") {
    sendCode(state.login.email);
  } else if (act === "install" && state.installPrompt) {
    state.installPrompt.prompt();
    await state.installPrompt.userChoice;
    state.installPrompt = null; render();
  } else if (act === "hide-install") {
    localStorage.setItem("mz-hide-install", "1"); render();
  } else if (act === "push-ask-yes") {
    state.pushAsk = false; render(); enablePush();
  } else if (act === "push-ask-no") {
    state.pushAsk = false; lsSet("mz-push-later", String(Date.now())); render();
  } else if (act === "push-on") {
    enablePush();
  } else if (act === "push-off") {
    disablePush();
  } else if (act === "push-test") {
    testPush();
  } else if (act === "attend") {
    const sid = routeArg(), uid = el.dataset.uid;
    setAttendance(sid, uid, !(state.attendance.get(sid) || new Set()).has(uid));
  } else if (act === "vocab-add" || act === "vocab-del") {
    const sid = routeArg(), d = readNoteForm(sid);
    if (act === "vocab-add") d.vocab.push({ hanzi: "", pinyin: "", meaning: "" });
    else d.vocab.splice(+el.dataset.i, 1);
    const y = scrollY; render(); scrollTo(0, y);
    if (act === "vocab-add") document.querySelector(`[data-vocab="${d.vocab.length - 1}"]`)?.focus();
  } else if (act === "note-save" || act === "note-publish") {
    el.disabled = true;
    await saveNotes(routeArg(), act === "note-publish");
  } else if (act === "view") {
    state.view = el.dataset.v;
    try { localStorage.setItem("mz-view", state.view); } catch { /* storage off */ }
    render();
  } else if (act === "cal-move") {
    const v = +el.dataset.v, m = state.calMonth;
    state.calMonth = v === 0 ? new Date(new Date().getFullYear(), new Date().getMonth(), 1) : new Date(m.getFullYear(), m.getMonth() + v, 1);
    if (v === 0) state.calDay = null;
    render();
  } else if (act === "cal-open") {
    state.calPick = state.calPick === el.dataset.id ? null : el.dataset.id;
    if (state.calPick) state.open.add(state.calPick);
    render();
    if (state.calPick) document.querySelector(".cal + .slist")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  } else if (act === "note-open") {
    const k = "n:" + el.dataset.id, q = document.getElementById("notesearch")?.value || "";
    state.open.has(k) ? state.open.delete(k) : state.open.add(k);
    render();
    const box = document.getElementById("notesearch");
    if (box && q) { box.value = q; box.dispatchEvent(new Event("input", { bubbles: true })); }
  } else if (act === "copy-code") {
    try { await navigator.clipboard.writeText(MEMBER_CODE); toast("Code copied"); }
    catch { toast(`Your code: ${MEMBER_CODE}`); }
  } else if (act === "map-pick") {
    pickCountry(el.dataset.v);
  } else if (act === "map-zoom") {
    document.getElementById("worldmap")?._zoom?.(el.dataset.v === "in" ? 1.5 : 1 / 1.5);
  } else if (act === "boot-ask") {
    state.bootAsk = el.dataset.k; render();
  } else if (act === "boot-cancel") {
    state.bootAsk = null; render();
  } else if (act === "boot-send") {
    el.disabled = true;
    const { data, error } = await sb.from("bootcamp_requests").insert({ bootcamp: el.dataset.k, title: el.dataset.title, status: el.dataset.status }).select("bootcamp, created_at").single();
    if (error && error.code !== "23505") { el.disabled = false; toast("Couldn't send your request. Please try again."); return; }
    state.bootReq.set(el.dataset.k, data?.created_at || new Date().toISOString());
    state.bootAsk = null; state.bootJust = el.dataset.k; render();
  } else if (act === "hb-give") {
    el.disabled = true; await giveHongbao(el.dataset.id); el.disabled = false;
  } else if (act === "app-reload") {
    const reg = await navigator.serviceWorker?.getRegistration(); if (reg) await reg.update().catch(() => {});
    location.reload();
  } else if (act === "reward-ok") {
    state.rewardQueue.shift(); render();
  } else if (act === "seasonal-ok") {
    state.seasonalPopup = null; render();
  } else if (act === "hb-seen") {
    for (const h of state.hbIn) h.seen_at = h.seen_at || new Date().toISOString();
    render();
    await sb.rpc("hongbao_seen");
  } else if (act === "back-custom") {
    state.custOpen = true;
  } else if (act === "host-all") {
    state.hostAll = !!el.dataset.v; render();
  } else if (act === "catf" || act === "lvf" || act === "clearf") {
    if (act === "clearf") { state.lvFilter = ""; state.catFilters = []; }
    else if (act === "lvf") state.lvFilter = el.dataset.v;
    else if (!el.dataset.v) state.catFilters = [];
    else { const k = el.dataset.v; state.catFilters = state.catFilters.includes(k) ? state.catFilters.filter((x) => x !== k) : [...state.catFilters, k]; }
    try { localStorage.setItem("mz-lv", state.lvFilter); localStorage.setItem("mz-cats", JSON.stringify(state.catFilters)); } catch { /* storage off */ }
    render();
  } else if (act === "mtab") {
    state.membersTab = el.dataset.v; render();
  } else if (act === "lbp") {
    state.lbPeriod = el.dataset.v; render();
  } else if (act === "award-kind") {
    state.awardKind = el.dataset.v; state.awardSticker = undefined; render();
  } else if (act === "rw-edit") {
    const rw = state.rewards.get(el.dataset.k);
    state.rwEdit = el.dataset.k; state.rwDraft = { xp: rw ? rw.xp : XP_BOOTCAMP, sticker: rw ? rw.sticker : "" }; render();
  } else if (act === "rw-cancel") {
    state.rwEdit = null; render();
  } else if (act === "rw-stk") {
    const f = el.closest("form"); if (f) state.rwDraft.xp = f.xp.value;
    state.rwDraft.sticker = el.dataset.key; render();
  } else if (act === "award-stk") {
    state.awardSticker = el.dataset.key; render();
  } else if (act === "stk-del") {
    if (!confirm("Take this sticker back?")) return;
    const a = state.stickerAwards.find((x) => x.id === el.dataset.id);
    const { error } = await sb.from("sticker_awards").delete().eq("id", el.dataset.id);
    if (error) { toast("Couldn't remove it."); return; }
    state.stickerAwards = state.stickerAwards.filter((x) => x.id !== el.dataset.id);
    const p = a && state.profiles.get(a.user_id);
    if (p && p.sticker === a.sticker && state.roles.get(a.user_id) === "member") p.sticker = null;
    if (a && state.worn.get(a.user_id) === a.sticker) state.worn.delete(a.user_id);
    await refreshBoard();
  } else if (act === "sticker") {
    keepForm(() => { draft().sticker = el.dataset.key || null; render(); });
  } else if (act === "idea-open") {
    state.idea = ideaNew(); render(); document.querySelector(".ideasheet .ideacat")?.focus();
  } else if (act === "idea-close") {
    state.idea = null; render();
  } else if (act === "idea-cat") {
    state.idea.cat = el.dataset.v; render();
  } else if (act === "idea-day" || act === "idea-time") {
    const set = act === "idea-day" ? state.idea.days : state.idea.times;
    set.has(el.dataset.v) ? set.delete(el.dataset.v) : set.add(el.dataset.v); render();
  } else if (act === "idea-send") {
    const f = state.idea; f.busy = true; render();
    const s = f.cat === "sessions";
    const order = (list, set) => list.filter((x) => set.has(x));
    const { error } = await sb.from("ideas").insert({
      category: f.cat, message: (s ? f.topic : f.msg).trim(), level: s ? f.level : "", timezone: s ? f.tz : "",
      days: s ? order(IDEA_DAYS, f.days) : [], times: s ? order(IDEA_TIMES, f.times) : [],
    });
    f.busy = false;
    if (error) { toast("Couldn't send your idea. Please try again."); render(); return; }
    f.sent = true; render();
  } else if (act === "adm-tab") {
    state.adminTab = el.dataset.v; render();
  } else if (act === "adm-filter") {
    state.adm.filter = el.dataset.v; render();
  } else if (act === "adm-group") {
    state.adm.group = el.dataset.v; actFeed(false);
  } else if (act === "adm-older") {
    el.disabled = true; actFeed(true);
  } else if (act === "adm-refresh") {
    actLoad(true);
  } else if (act === "bc-aud") {
    Object.assign(bcState(), { audience: el.dataset.v, confirm: false }); render();
  } else if (act === "bc-none") {
    bcState().ids.clear(); render();
  } else if (act === "bc-ask") {
    bcState().confirm = true; render();
  } else if (act === "bc-cancel") {
    bcState().confirm = false; render();
  } else if (act === "bc-test") {
    el.disabled = true; await bcSend(true); el.disabled = false;
  } else if (act === "bc-send") {
    const b = bcState(); b.busy = true; render();
    const ok = await bcSend(false);
    b.busy = false; b.confirm = false;
    if (ok) { Object.assign(b, { title: "", body: "" }); b.ids.clear(); state.broadcasts = null; state.broadcastsLoading = false; }
    render();
  } else if (act === "act-filter") {
    state.actFilter = el.dataset.v; state.actLimit = 25; render();
  } else if (act === "act-more") {
    state.actLimit = (state.actLimit || 25) + 50; render();
  } else if (act === "book-pick") {
    const p = (state.giveBooks ||= new Set()); el.checked ? p.add(el.dataset.id) : p.delete(el.dataset.id); render();
  } else if (act === "book-give") {
    const uid = routeArg(), ids = [...(state.giveBooks || [])]; if (!ids.length) return;
    el.disabled = true; let n = 0;
    for (const b of ids) { const { data } = await sb.rpc("library_give_book", { p_user: uid, p_book: b }); if (data === "ok") n++; }
    state.giveBooks = new Set(); if (state.memberBooks) delete state.memberBooks[uid];
    toast(n ? `Gave ${n} book${n > 1 ? "s" : ""}. It's on their shelf now.` : "Couldn't give the book."); render();
  } else if (act === "book-take") {
    if (!confirm("Take this book back from their shelf?")) return;
    const uid = routeArg(); const { data } = await sb.rpc("library_take_book", { p_user: uid, p_book: el.dataset.id });
    if (state.memberBooks) delete state.memberBooks[uid];
    toast(data === "ok" ? "Book taken back." : "Couldn't take it back."); render();
  } else if (act === "award-del") {
    if (!confirm("Remove this XP award?")) return;
    const { error } = await sb.from("xp_awards").delete().eq("id", el.dataset.id);
    if (error) { toast("Couldn't remove it."); return; }
    state.awards = state.awards.filter((a) => a.id !== el.dataset.id);
    await refreshBoard();
  } else if (act === "notes-pdf") {
    el.disabled = true;
    await downloadNotesPdf(el.dataset.id);
    el.disabled = false;
  }
});

document.addEventListener("toggle", (e) => {
  if (e.target.matches?.("details.sbdet")) state.bookOpen = e.target.open;
  else if (e.target.matches?.("details.custom")) state.custOpen = e.target.open;
}, true);

document.addEventListener("change", (e) => {
  const el = e.target;
  if (el.dataset.pref) savePref(el.dataset.pref, el.checked);
  else if (el.dataset.actChange === "attend-add" && el.value) setAttendance(routeArg(), el.value, true);
  else if (el.dataset.actChange === "map-pick") pickCountry(el.value);
  else if (el.dataset.actChange === "award-camp") { state.awardCamp = el.value; state.awardSticker = undefined; render(); }
  else if (el.dataset.actChange === "bc-ch") { bcState().channel = el.value; bcState().confirm = false; render(); }
  else if (el.dataset.bcpick) {
    const ids = bcState().ids; el.checked ? ids.add(el.dataset.bcpick) : ids.delete(el.dataset.bcpick);
    const c = document.querySelector('[data-act="bc-none"]'); if (c) c.textContent = `Clear (${ids.size})`;
    bcUpdate();
  }
});

// Re-render the profile without losing typed values in text fields.
function keepForm(fn) {
  const form = document.querySelector('form[data-form="profile"]');
  if (form) for (const input of form.querySelectorAll("input[name], select[name], textarea[name]")) {
    draft()[input.name] = input.type === "checkbox" ? input.checked : input.value;
  }
  const y = scrollY;
  fn();
  scrollTo(0, y);
}

async function toggleIn(id) {
  const set = state.interests.get(id) || new Set();
  const on = set.has(state.user.id);
  // Optimistic update, rolled back on error.
  on ? set.delete(state.user.id) : set.add(state.user.id);
  state.interests.set(id, set);
  render();
  const q = on
    ? sb.from("interests").delete().eq("session_id", id).eq("user_id", state.user.id)
    : sb.from("interests").insert({ session_id: id, user_id: state.user.id });
  const { error } = await q;
  if (error) {
    on ? set.add(state.user.id) : set.delete(state.user.id);
    render();
    toast("Couldn't save that. Check your connection.");
  } else toast(on ? "Okay, you're no longer going. Tap I'm in if your plans change." : "See you there!");
}

addEventListener("hashchange", () => {
  if (route() !== "me") state.draft = null;
  if (route() !== "host") state.noteDraft.clear();
  if (state.lu && !(route() === "learn" && routeArg() === "cards")) state.lu.review = null;
  if (state.lu) { state.lu.sheet = null; state.lu.word = null; state.lu.pick = null; if (state.lu.forest) state.lu.forest.sel = null; }
  render();
  document.getElementById("main")?.focus?.();
  scrollTo(0, 0);
});

// Refresh when the app comes back to the front.
let lastLoad = Date.now();
document.addEventListener("visibilitychange", async () => {
  if (document.visibilityState !== "visible" || !state.role || Date.now() - lastLoad < 60e3) return;
  lastLoad = Date.now();
  try {
    await loadAll();
    // Flashcards and the streak tree may have changed on another device: reload them (not in the middle of a review).
    if (state.lu?.loaded && !state.lu.review) await ztLoad(true);
    if (route() !== "me") render();
  } catch { /* offline: keep what we have */ }
});
setInterval(() => { if (state.role && route() === "home") render(); }, 60e3); // keep "in 2 h" fresh
let wasWide = wide();
addEventListener("resize", () => { if (wide() !== wasWide) { wasWide = wide(); if (state.role && route() === "home") render(); } });

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
(async () => {
  try {
    const { data } = await sb.auth.getSession();
    if (data.session?.user) await startSession(data.session.user);
    else render();
  } catch (e) {
    console.error(e);
    app.innerHTML = `<main class="login"><div class="hero"><img class="mascot" src="icons/mascot.svg" alt="" width="150" height="150"><h1>Can't reach the Club</h1><p class="muted">Check your internet connection and try again.</p></div><button class="btn block" onclick="location.reload()">Try again</button></main>`;
  }
})();

sb.auth.onAuthStateChange((event) => {
  if (event === "SIGNED_OUT" && state.user) { state.user = null; state.role = null; render(); }
});

// ---------- Tooltip for [data-tip] (stickers, special avatars) ----------
const tipEl = document.createElement("div");
tipEl.className = "tip"; tipEl.setAttribute("role", "tooltip"); tipEl.hidden = true;
document.body.appendChild(tipEl);
let tipFor = null;
function showTip(el) {
  tipFor = el;
  tipEl.innerHTML = `<b>${esc(el.dataset.tip)}</b>${el.dataset.tipBody ? `<span>${esc(el.dataset.tipBody)}</span>` : ""}`;
  tipEl.hidden = false;
  const r = el.getBoundingClientRect(), w = tipEl.offsetWidth, h = tipEl.offsetHeight;
  let x = r.left + r.width / 2 - w / 2, y = r.top - h - 8;
  if (y < 8) y = r.bottom + 8;
  x = Math.max(8, Math.min(x, innerWidth - w - 8));
  tipEl.style.left = `${x}px`; tipEl.style.top = `${y}px`;
}
function hideTip() { tipFor = null; tipEl.hidden = true; }
document.addEventListener("pointerover", (e) => { if (e.pointerType !== "mouse") return; const el = e.target.closest?.("[data-tip]"); if (el) showTip(el); });
document.addEventListener("pointerout", (e) => { if (e.pointerType !== "mouse") return; const el = e.target.closest?.("[data-tip]"); if (el && !el.contains(e.relatedTarget)) hideTip(); });
document.addEventListener("click", (e) => {
  const el = e.target.closest?.("[data-tip]");
  if (el) { e.preventDefault(); e.stopPropagation(); tipFor === el && !tipEl.hidden && e.pointerType !== "mouse" ? hideTip() : showTip(el); return; }
  hideTip();
}, true);
document.addEventListener("focusin", (e) => { const el = e.target.closest?.("[data-tip]"); if (el) showTip(el); });
document.addEventListener("focusout", hideTip);
addEventListener("scroll", hideTip, { passive: true });
addEventListener("hashchange", hideTip);

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js?v=147").catch(() => {});

// Escape closes the Idea box.
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && state.idea?.open) { state.idea = null; render(); }
});

// ---------------------------------------------------------------------------
// Session notes: word suggestions from the HSK lists while a host types characters or pinyin.
// Picking one fills characters (in the host's script), pinyin and meaning.
// ---------------------------------------------------------------------------
const PY_TONES = { ā: "a", á: "a", ǎ: "a", à: "a", ē: "e", é: "e", ě: "e", è: "e", ī: "i", í: "i", ǐ: "i", ì: "i",
  ō: "o", ó: "o", ǒ: "o", ò: "o", ū: "u", ú: "u", ǔ: "u", ù: "u", ǖ: "u", ǘ: "u", ǚ: "u", ǜ: "u", ü: "u", v: "u" };
const pinyinKey = (s) => String(s || "").toLowerCase().replace(/[āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜüv]/g, (c) => PY_TONES[c] || c).replace(/[^a-z]/g, "");
const HAN = /[㐀-鿿]/;
let vsugg = { el: null, input: null, items: [], active: -1, timer: 0, seq: 0, more: false, q: "", loading: false };

function vsuggClose() {
  vsugg.el?.remove();
  vsugg.input?.setAttribute("aria-expanded", "false");
  vsugg.input?.removeAttribute("aria-activedescendant");
  vsugg = { ...vsugg, el: null, input: null, items: [], active: -1 };
}

const VS_PAGE = 6;
async function vsuggFetch(q, kind, offset) {
  const { data } = await sb.rpc("hsk_suggest", { p_q: q, p_kind: kind, p_limit: VS_PAGE + 1, p_offset: offset });
  const rows = data || [];
  return { rows: rows.slice(0, VS_PAGE), more: rows.length > VS_PAGE };
}

async function vsuggSearch(input) {
  const k = input.dataset.k, seq = ++vsugg.seq;
  const q = k === "hanzi" ? [...input.value].filter((c) => HAN.test(c)).join("") : pinyinKey(input.value);
  if (!q || (k === "pinyin" && q.length < 2)) return vsuggClose();
  const { rows, more } = await vsuggFetch(q, k, 0);
  if (seq !== vsugg.seq || document.activeElement !== input) return;
  if (!rows.length) return vsuggClose();
  vsuggShow(input, rows, more, q);
}

async function vsuggMore() {
  if (!vsugg.el || vsugg.loading) return;
  const { input, q, items } = vsugg, seq = vsugg.seq;
  vsugg.loading = true;
  const btn = vsugg.el.querySelector(".vsmore"); if (btn) btn.textContent = "Loading…";
  const { rows, more } = await vsuggFetch(q, input.dataset.k, items.length);
  if (seq !== vsugg.seq || vsugg.input !== input) return;
  const keep = vsugg.active;
  vsuggShow(input, items.concat(rows), more, q, true);
  vsuggMove(0, keep < items.length ? keep : items.length); // land on the first new word
}

function vsuggShow(input, items, more, q, keepScroll) {
  const listTop = vsugg.el?.scrollTop || 0;
  vsuggClose();
  const row = input.closest(".vedit"), i = input.dataset.vocab;
  const el = document.createElement("div");
  el.className = "vsugg"; el.id = `vsugg-${i}`; el.setAttribute("role", "listbox"); el.setAttribute("aria-label", "Suggested words");
  el.innerHTML = `<div class="vslist">${items.map((w, j) => `<button type="button" class="vsopt" role="option" id="vsopt-${i}-${j}" data-j="${j}" tabindex="-1">
    <b lang="zh">${esc(trad() ? w.hanzi_trad || w.hanzi : w.hanzi)}</b><span class="vsp">${esc(py(w.pinyin))}</span><span class="vsm">${esc(w.meaning)}</span><span class="vsl">HSK ${esc(w.level)}</span></button>`).join("")}</div>`
    + (more ? `<button type="button" class="vsmore" id="vsopt-${i}-more" tabindex="-1">Show more words</button>` : "")
    + `<div class="vsfoot">From the HSK lists · ↑↓ then Enter, or tap</div>`;
  el.addEventListener("mousedown", (e) => e.preventDefault()); // keep focus in the input
  el.addEventListener("click", (e) => {
    if (e.target.closest(".vsmore")) return vsuggMore();
    const b = e.target.closest(".vsopt"); if (b) vsuggPick(+b.dataset.j);
  });
  row.after(el);
  if (keepScroll) el.querySelector(".vslist").scrollTop = listTop;
  else el.scrollIntoView({ block: "nearest", behavior: "smooth" });
  input.setAttribute("aria-expanded", "true");
  vsugg = { ...vsugg, el, input, items, more, q, active: -1, loading: false };
}

function vsuggMove(d, to) {
  if (!vsugg.el) return;
  const n = vsugg.items.length + (vsugg.more ? 1 : 0); // the "Show more" button is the last stop
  vsugg.active = to ?? (vsugg.active + d + n) % n;
  const opts = [...vsugg.el.querySelectorAll(".vsopt, .vsmore")];
  opts.forEach((b, j) => b.setAttribute("aria-selected", j === vsugg.active ? "true" : "false"));
  opts[vsugg.active]?.scrollIntoView({ block: "nearest" });
  vsugg.input.setAttribute("aria-activedescendant", opts[vsugg.active]?.id || "");
}

function vsuggPick(j) {
  const w = vsugg.items[j], input = vsugg.input;
  if (!w || !input) return;
  const i = input.dataset.vocab, val = { hanzi: trad() ? w.hanzi_trad || w.hanzi : w.hanzi, pinyin: w.pinyin, meaning: w.meaning };
  for (const k of ["hanzi", "pinyin", "meaning"]) {
    const f = document.querySelector(`[data-vocab="${i}"][data-k="${k}"]`);
    if (f) { f.value = val[k]; f.dispatchEvent(new Event("input", { bubbles: true })); }
  }
  vsuggClose();
  // Jump to the next empty row's characters so the host can keep going.
  const next = document.querySelector(`[data-vocab="${+i + 1}"][data-k="hanzi"]`);
  if (next && !next.value) next.focus(); else document.querySelector(`[data-vocab="${i}"][data-k="meaning"]`)?.focus();
}

document.addEventListener("input", (e) => {
  const el = e.target;
  if (!el.dataset?.vocab || !["hanzi", "pinyin"].includes(el.dataset.k) || !e.isTrusted) return;
  clearTimeout(vsugg.timer);
  vsugg.timer = setTimeout(() => vsuggSearch(el), 180);
});
document.addEventListener("keydown", (e) => {
  if (!vsugg.el || e.target !== vsugg.input) return;
  if (e.key === "ArrowDown") { e.preventDefault(); vsuggMove(1); }
  else if (e.key === "ArrowUp") { e.preventDefault(); vsuggMove(-1); }
  else if (e.key === "Enter" && vsugg.active >= 0) { e.preventDefault(); vsugg.active >= vsugg.items.length ? vsuggMore() : vsuggPick(vsugg.active); }
  else if (e.key === "Escape") { e.preventDefault(); vsuggClose(); }
});
document.addEventListener("focusout", (e) => { if (vsugg.input && e.target === vsugg.input) setTimeout(() => { if (document.activeElement !== vsugg.input) vsuggClose(); }, 120); });

// ---------------------------------------------------------------------------
// Zest Town · Learning Universe (live for all members since 18 Nov 2026; is_beta() on the server is the off switch)
// Streak tree, HSK Temple and Flashcard Center. Art: icons/zt/*.png (pixel art, see the design canvas).
// ---------------------------------------------------------------------------
const ZT_MAP = { // town4-*.png (20 Nov): sandy plots, stone paths, flowers, fences; trees are swaying overlays [x, y, big]
  phone: { w: 118, h: 266, tree: [38, 49], temple: [86, 31], house: [31, 36], library: [30, 172], callig: [88, 172], gallery: [59, 236], plaza: [59, 86], post: [88, 236],
    river: [110, 29], bridge: [54, 117, 11, 18], fsign: [91, 98, 24],
    trees: [[42, -10, 0], [-6, -8, 1], [100, -8, 1], [106, 116, 0], [-4, 120, 0], [102, 194, 1], [-6, 196, 1], [-4, 248, 1], [100, 250, 1]],
    hops: [[11, 71], [16, 93], [79, 98], [91, 74], [71, 105], [33, 105]] },
  wide: { w: 235, h: 216, tree: [97, 84], temple: [172, 43], house: [62, 49], library: [40, 128], callig: [195, 128], gallery: [117, 36], plaza: [118, 120], post: [60, 212],
    river: [160, 30], bridge: [113, 160, 11, 17], fsign: [196, 186, 32],
    trees: [[-4, -6, 1], [178, -6, 0], [196, -6, 1], [28, -4, 0], [214, 2, 1], [12, 4, 1], [2, 18, 0], [222, 30, 0], [216, 80, 1], [2, 82, 1], [222, 100, 0], [-2, 104, 0], [0, 188, 1], [18, 196, 1], [150, 196, 1], [222, 196, 0], [34, 196, 0], [170, 200, 0]],
    hops: [[71, 115], [76, 141], [146, 141], [151, 115], [127, 151], [93, 151]] },
};
// With the Post Office (town7 backgrounds): on phones it sits next to the Sticker Gallery (which moves left);
// on computers the town is 30px taller and the post office sits just under the river. Trees over its lot are hidden.
function ztMap(k) {
  const M = ZT_MAP[k];
  if (!postOpen()) return { ...M, bg: `town4-${k}` };
  const [px, py] = M.post, clear = ([x, y, big]) => x + (big ? 24 : 17) < px - 30 || x > px + 30 || y + (big ? 30 : 22) < py - 20 || y > py + 30;
  return { ...M, bg: `town7-${k}`, h: M.h + (k === "phone" ? 0 : 30), trees: M.trees.filter(clear), ...(k === "phone" ? { gallery: [30, 236] } : {}) };
}
const ZT_STAGES = [ // [en, simplified, traditional, first day]
  ["Seed", "种子", "種子", 0], ["Sprout", "嫩芽", "嫩芽", 1], ["Seedling", "幼苗", "幼苗", 7], ["Sapling", "小树", "小樹", 30],
  ["Young tree", "青年树", "青年樹", 90], ["Leafy tree", "茂盛树", "茂盛樹", 180], ["Blossom tree", "开花树", "開花樹", 270],
  ["Fruiting tree", "结果树", "結果樹", 330], ["Orange tree", "橘子树", "橘子樹", 365],
];
const HSK_LEVELS = ["1", "2", "3", "4", "5", "6", "7-9"];
const ZT_LEARNED = 3; // good answers in a row (kept for the streak counter on each card)
const ZT_KNOWN_DAYS = 90; // a word counts as known (dark green) once its next review is 3 months or more away (21 Nov)
const ztKnown = (c) => !!c && (c.interval_days || 0) >= ZT_KNOWN_DAYS;
const ZT_CHEERS = [["加油！", "加油！"], ["你好！", "你好！"], ["太棒了！", "太棒了！"], ["我们走吧！", "我們走吧！"], ["好开心！", "好開心！"], ["学中文吧！", "學中文吧！"]];
const ZT_FLAME = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M12 2c1 4 6 6 6 12a6 6 0 0 1-12 0c0-3 2-5 3-6 0 2 1 3 2 3 0-4-1-6 1-9z" fill="#f37a48"/><path d="M12 12c1 2 3 3 3 5a3 3 0 0 1-6 0c0-1.5 1-2.5 1.5-3 .2 1 .8 1.5 1.5 1.5 0-1.5-.5-2.5 0-3.5z" fill="#ffd95a"/></svg>';
const ZT_LEAF = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M20 3C11 3 4.5 7.5 4.5 14.5c0 2 .6 3.7 1.6 5C8 12.8 12 9.5 16 8c-4 2.8-7 6.6-8.4 12.2 1.2.6 2.6.8 4 .8C18.6 21 21 13 20 3z" fill="#3f8f2f"/><path d="M8 18.5C10 13.5 13 10.5 16 8" stroke="#b9e98b" stroke-width="1.4" fill="none" stroke-linecap="round"/></svg>';
const ZT_DROP = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M12 2.5C9 7 5.5 10.5 5.5 14.5a6.5 6.5 0 0 0 13 0C18.5 10.5 15 7 12 2.5z" fill="#4aa3df"/><path d="M9 14.5a3 3 0 0 0 3 3" stroke="#d6efff" stroke-width="1.8" fill="none" stroke-linecap="round"/></svg>';
ICON.tree = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="9" r="6"/><path d="M12 15v7M8 22h8M10 10l2 2 2-3"/></svg>';

state.lu = {
  loaded: false, loading: false, cards: [], days: [], hsk: new Map(), hskLoading: new Set(),
  view: lsGet("mz-zt-view") || "town", lv: lsGet("mz-zt-lv") || "1", show: 300, pick: null, word: null,
  sheet: null, review: null, perDay: +(lsGet("mz-zt-new") || 10),
};
// Learning (Zest Town) is live for everyone; is_beta() on the server can switch it off again.
const isBeta = () => isAdmin() || state.beta !== false;
const ztPad = (n) => String(n).padStart(2, "0");
const dkey = (d) => `${d.getFullYear()}-${ztPad(d.getMonth() + 1)}-${ztPad(d.getDate())}`;
const dayBack = (n) => { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - n); return dkey(d); };
const todayKey = () => dayBack(0);
const cardZh = (c) => (trad() ? c.hanzi_trad || c.hanzi : c.hanzi);
const wordZh = (w) => (trad() ? w.hanzi_trad || w.hanzi : w.hanzi);
const ztImg = (name, cls = "", alt = "") => `<img class="px ${cls}" src="icons/zt/${name}.png" alt="${esc(alt)}" draggable="false">`;
const ZT_FRUITS = new Set(["orange", "apple", "peach", "strawberry", "lemon", "mango", "watermelon", "pineapple", "kiwi", "cherry", "coconut", "dragonfruit", "lychee", "pomelo", "starfruit", "guava", "passionfruit", "persimmon", "rambutan", "durian", "corn"]);
const myFruitKey = () => (ZT_FRUITS.has(state.me?.fruit) ? state.me.fruit : "orange");

async function ztCheckBeta() {
  if (isAdmin()) { state.beta = true; return; }
  const { data, error } = await sb.rpc("is_beta");
  if (error) return; // keep it on if the check can't run
  const on = data === true;
  if (on !== state.beta) { state.beta = on; render(); }
}

// Sessions you attended (or hosted) with published notes: their words become flashcards.
function ztMySessionIds() {
  const uid = state.user.id, out = new Set();
  for (const [sid, set] of state.attendance) if (set.has(uid)) out.add(sid);
  if (isHost()) for (const [sid, hid] of state.sessionHost || []) if (hid === uid) out.add(sid);
  return out;
}
function ztSessionVocab() {
  const ids = ztMySessionIds(), out = [];
  for (const sid of ids) {
    const n = state.notes.get(sid);
    if (!n?.published_at) continue;
    for (const v of n.vocab || []) if ((v.hanzi || "").trim()) out.push({ ...v, hanzi: v.hanzi.trim(), session_id: sid });
  }
  return out;
}
function ztSession(sid) { return [...state.sessions, ...(state.extraSessions || [])].find((s) => s.id === sid); }

async function ztLoad(force) {
  const L = state.lu;
  if (L.loading || (L.loaded && !force)) return;
  L.loading = true;
  await Promise.resolve();
  try {
    // The server returns at most 1,000 rows per request, and a deck with whole HSK levels is bigger: load it page by page.
    const loadCards = async () => {
      const all = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await sb.from("learn_cards").select("*").order("created_at").order("id").range(from, from + 999);
        if (error) throw error;
        all.push(...data);
        if (data.length < 1000) return all;
      }
    };
    const [cards, d] = await Promise.all([loadCards(), sb.from("learn_days").select("day, kind, created_at")]);
    L.cards = cards; L.days = d.error ? [] : d.data;
    // Older attended sessions (for titles in the Flashcard Center).
    if (!state.notesLoaded) await loadNoteSessions();
    // Session words are NOT added automatically: members add them from the notes (Add to flashcards).
    L.loaded = true;
  } catch (e) {
    console.error(e); L.error = true;
  }
  L.loading = false;
  if (["learn", "notes", "sessions", "home"].includes(route())) render();
}

async function ztSyncSessionCards() {
  const L = state.lu, have = new Set(L.cards.flatMap((c) => [c.hanzi, c.hanzi_trad].filter(Boolean)));
  const fresh = [], seen = new Set();
  for (const v of ztSessionVocab()) if (!have.has(v.hanzi) && !seen.has(v.hanzi)) { seen.add(v.hanzi); fresh.push(v); }
  if (!fresh.length) return;
  const list = fresh.map((v) => v.hanzi);
  const [a, b] = await Promise.all([
    sb.from("hsk_words").select("hanzi, hanzi_trad, level").in("hanzi", list),
    sb.from("hsk_words").select("hanzi, hanzi_trad, level").in("hanzi_trad", list),
  ]);
  const hsk = new Map();
  for (const w of [...(a.data || []), ...(b.data || [])]) { if (!hsk.has(w.hanzi)) hsk.set(w.hanzi, w); if (w.hanzi_trad && !hsk.has(w.hanzi_trad)) hsk.set(w.hanzi_trad, w); }
  const rows = fresh.map((v) => {
    const w = hsk.get(v.hanzi) || (v.hsk ? { hanzi: v.hanzi, level: v.hsk.level } : null);
    return { hanzi: w ? w.hanzi : v.hanzi, hanzi_trad: w?.hanzi_trad || null, pinyin: v.pinyin || "", meaning: v.meaning || "",
      hsk_level: w?.level || null, session_id: v.session_id, source: "session" };
  }).filter((r, i, arr) => !have.has(r.hanzi) && arr.findIndex((x) => x.hanzi === r.hanzi) === i);
  if (!rows.length) return;
  const { data, error } = await sb.from("learn_cards").upsert(rows, { onConflict: "user_id,hanzi", ignoreDuplicates: true }).select("*");
  if (!error && data) L.cards.push(...data);
}

async function ztLoadLevel(lv) {
  const L = state.lu;
  if (L.hsk.has(lv) || L.hskLoading.has(lv)) return;
  L.hskLoading.add(lv);
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from("hsk_words").select("id, level, num, hanzi, hanzi_trad, pinyin, meaning, types, sense")
      .eq("level", lv).order("num").order("sense", { nullsFirst: true }).range(from, from + 999);
    if (error) { L.hskLoading.delete(lv); toast("Couldn't load the HSK list. Check your connection."); return; }
    rows.push(...data);
    if (data.length < 1000) break;
  }
  L.hsk.set(lv, rows); L.hskLoading.delete(lv);
  if (route() === "learn") render();
}

// ---- streak tree -----------------------------------------------------------
function ztActiveDays() {
  const days = new Map(); // key -> "session" | "game" | "water"
  const mine = ztMySessionIds();
  for (const s of [...state.sessions, ...(state.extraSessions || [])]) {
    if (mine.has(s.id) && Date.parse(s.starts_at) <= Date.now()) days.set(dkey(new Date(s.starts_at)), "session");
  }
  for (const d of state.lu.days) {
    if (d.kind === "water") { if (!days.has(d.day)) days.set(d.day, "water"); }
    else if (days.get(d.day) !== "session") days.set(d.day, "game");
  }
  return days;
}
function ztWaterLeft() {
  const now = new Date(), m = `${now.getFullYear()}-${ztPad(now.getMonth() + 1)}`;
  return state.lu.days.some((d) => d.kind === "water" && dkey(new Date(d.created_at)).startsWith(m)) ? 0 : 1;
}
function ztStreak() {
  const days = ztActiveDays(), doneToday = days.has(todayKey());
  let n = 0;
  for (let i = doneToday ? 0 : 1; days.has(dayBack(i)); i++) n++;
  // Missed exactly yesterday, with a streak before it: the tree wilts (water saves it, once a month).
  let lost = 0;
  if (!days.has(dayBack(1)) && days.has(dayBack(2))) for (let i = 2; days.has(dayBack(i)); i++) lost++;
  const restarted = lsGet("mz-zt-restart") === dayBack(1);
  const wilted = lost > 0 && !restarted;
  return { n, doneToday, lost, wilted, days, stage: ztStage(wilted ? lost : n) };
}
function ztStage(n) { let i = 0; ZT_STAGES.forEach((s, j) => { if (n >= s[3]) i = j; }); return i; }
const stageName = (i) => `${ZT_STAGES[i][0]} ${trad() ? ZT_STAGES[i][2] : ZT_STAGES[i][1]}`;
function ztNext(st) {
  const i = ztStage(st.n);
  if (i >= ZT_STAGES.length - 1) return { text: "Your tree is fully grown. Keep it alive!", pct: 100 };
  const [en, , , day] = ZT_STAGES[i + 1], from = ZT_STAGES[i][3];
  return { text: `Next: <b>${esc(en)}</b> on day ${day} (${day - st.n} day${day - st.n === 1 ? "" : "s"} to go)`, pct: Math.round(((st.n - from) / (day - from)) * 100) };
}
const treeImg = (st, cls = "") => (st.wilted ? ztImg("tree-dead", cls, "Your wilted tree") : ztImg(`tree-${st.stage}`, cls, stageName(st.stage)));

// ---- flashcards: simple spaced repetition ----------------------------------
const addDays = (n) => { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() + n); return dkey(d); };
// New cards started today, on any device (first_review is saved with the card), so phone and computer agree.
function ztNewToday() {
  const today = todayKey(), n = (state.lu.cards || []).filter((c) => c.first_review && dkey(new Date(c.first_review)) === today).length;
  return Math.max(n, +(lsGet("mz-zt-newdone-" + today) || 0));
}
function ztDeck(filter) {
  const today = todayKey(), cards = state.lu.cards.filter(filter || (() => true));
  const due = cards.filter((c) => c.reps > 0 && c.due <= today);
  const fresh = cards.filter((c) => c.reps === 0);
  return { cards, due, fresh, learning: due.filter((c) => c.interval_days <= 1) };
}
function ztQueueAll() {
  const d = ztDeck(), room = Math.max(0, state.lu.perDay - ztNewToday());
  // New cards are picked in a random order that stays the same all day (not in list/alphabetical order).
  const day = todayKey(), key = (c) => { let h = 0; for (const ch of c.id + day) h = (h * 31 + ch.charCodeAt(0)) | 0; return h; };
  return [...d.due, ...[...d.fresh].sort((a, b) => key(a) - key(b)).slice(0, room)];
}
// Spaced repetition like Anki's default (SM-2): https://docs.ankiweb.net/faqs/what-spaced-repetition-algorithm
// New / relearning cards: Again = again today, Hard = 1 day, Good = 1 day, Easy = 4 days.
// Review cards: Hard = interval × 1.2, Good = interval × ease, Easy = interval × ease × 1.3 (easy bonus),
// each button always at least 1 day more than the one before. Ease starts at 250%, Again −20, Hard −15, Easy +15 (min 130%).
function ztPreview(c, g) {
  const iv = c.interval_days || 0, ease = c.ease || 2.5;
  if (g === 0) return 0;
  if (iv === 0) return [0, 1, 1, 4][g];
  const hard = Math.max(iv + 1, Math.round(iv * 1.2));
  if (g === 1) return hard;
  const good = Math.max(hard + 1, Math.round(iv * ease));
  if (g === 2) return good;
  return Math.max(good + 1, Math.round(iv * ease * 1.3));
}
const ivText = (n) => (n === 0 ? "now" : n === 1 ? "1 day" : n < 30 ? `${n} days` : n < 365 ? `${+(n / 30).toFixed(1)} mo` : `${+(n / 365).toFixed(1)} yr`);
async function ztGrade(g) {
  const R = state.lu.review; if (!R) return;
  const c = R.queue[R.i]; if (!c) return;
  // Every answer reschedules the card, also a card reviewed before it's due (by session / HSK level), like Anki's
  // "review ahead"; until 25 Nov those were practice only and the buttons showed no days.
  {
    const iv = ztPreview(c, g), wasNew = c.reps === 0;
    const upd = {
      interval_days: iv, due: addDays(iv), reps: c.reps + 1, last_review: new Date().toISOString(),
      // Ease only changes on review cards (not while a card is new or being relearned), as in Anki.
      ease: (c.interval_days || 0) > 0 ? Math.max(1.3, (c.ease || 2.5) + [-0.2, -0.15, 0, 0.15][g]) : c.ease || 2.5,
      good_streak: g >= 2 ? c.good_streak + 1 : g === 1 ? c.good_streak : 0,
      lapses: c.lapses + (g === 0 && c.reps > 0 ? 1 : 0),
    };
    // Several good answers on the same day only count once towards "learned".
    if (g >= 2 && c.last_review && dkey(new Date(c.last_review)) === todayKey()) upd.good_streak = c.good_streak;
    Object.assign(c, upd);
    if (wasNew) { lsSet("mz-zt-newdone-" + todayKey(), String(ztNewToday() + 1)); upd.first_review = c.first_review = new Date().toISOString(); qLog("fc_new"); }
    qLog("fc_review");
    sb.from("learn_cards").update(upd).eq("id", c.id).then(({ error }) => { if (error) toast("Couldn't save that card. Check your connection."); });
  }
  R.done++;
  if (g === 0 && !R.again.has(c.id)) { R.again.add(c.id); R.queue.push(c); }
  R.i++; R.flipped = false;
  if (R.i >= R.queue.length) await ztFinish();
  render();
}
// A flashcard review, a Library chapter read, a character written in the Calligraphy School or a letter sent
// today makes the streak tree grow (one "game" day, +1 XP).
// Returns true when this call counted today for the first time.
async function ztCountDay() {
  const days = state.lu?.days;
  if (days?.some((d) => d.day === todayKey() && d.kind === "game")) return false;
  const row = { day: todayKey(), kind: "game" };
  const { error } = await sb.from("learn_days").upsert(row, { onConflict: "user_id,day,kind", ignoreDuplicates: true });
  if (error) return false;
  if (days) days.push({ ...row, created_at: new Date().toISOString() });
  return !!days;
}
async function ztFinish() {
  const R = state.lu.review; R.finished = true;
  // Nothing due left today: counts for "Clear every flashcard due today" (once a day).
  if (R.done > 0 && !R.cram && !state.lu.cards.some((c) => c.reps > 0 && c.due <= todayKey()) && lsGet("mz-ql-clear") !== todayKey()) { lsSet("mz-ql-clear", todayKey()); qLog("fc_clear"); }
  if (R.done > 0) tEvent("fc_session", `${R.done} card${R.done === 1 ? "" : "s"}${R.title ? " · " + R.title : ""}`);
  if (R.done > 0 && await ztCountDay()) R.counted = true;
}
function ztStart(title, queue, cram) {
  if (!queue.length) { toast("Nothing to review here right now."); return; }
  // Shuffle (Fisher-Yates) so cards never come in list order; due reviews first, then new cards.
  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const due = shuffle(queue.filter((c) => c.reps > 0)), fresh = shuffle(queue.filter((c) => c.reps === 0));
  state.lu.review = { title, queue: [...due, ...fresh], i: 0, flipped: false, done: 0, again: new Set(), cram };
  render(); scrollTo(0, 0);
}

// ---- word status for the HSK Temple ----------------------------------------
function ztWordStatus() {
  const m = new Map();
  for (const v of ztSessionVocab()) m.set(v.hanzi, "seen");
  for (const c of state.lu.cards) {
    // A card added from the HSK Temple only counts as "seen" once it has been reviewed at least once.
    const s = ztKnown(c) ? "learned" : c.reps > 0 || c.source === "session" ? "seen" : null;
    if (!s) continue;
    for (const h of [c.hanzi, c.hanzi_trad]) if (h && m.get(h) !== "learned") m.set(h, s);
  }
  return m;
}
const statusOf = (w, m) => m.get(w.hanzi) || (w.hanzi_trad && m.get(w.hanzi_trad)) || "none";

// ---- views -----------------------------------------------------------------
function learnView() {
  if (!isBeta()) { location.hash = "#/home"; return homeView(); }
  const L = state.lu;
  if (!L.loaded) { ztLoad(); return `${ztHeader(null)}<p class="muted small">${L.error ? "Couldn't load Zest Town. Pull to refresh or try again later." : "Opening Zest Town…"}</p>`; }
  const sub = routeArg(), bld = sub.split(/[/?]/)[0];
  if (["cards", "temple", "forest", "gallery", "post", "callig", "library"].includes(bld)) qlVisit(bld);
  if (sub === "cards") return L.review ? reviewView() : cardsView();
  if (sub === "temple") return templeView();
  if (sub === "forest") return forestView();
  if (sub === "forest/board") return nbView();
  if (sub === "gallery") return galleryView();
  if (sub === "post" || sub.startsWith("post/") || sub.startsWith("post?")) {
    const [path, qs] = sub.split("?");
    return postView(path.split("/").slice(1).filter(Boolean), Object.fromEntries(new URLSearchParams(qs || "")));
  }
  if (sub === "callig" || sub.startsWith("callig/")) return calligView(sub.split("?")[0].split("/").slice(1).filter(Boolean));
  if (sub === "library" || sub.startsWith("library/") || sub.startsWith("library?")) {
    const [path, qs] = sub.split("?");
    return libraryView(path.split("/").slice(1).filter(Boolean), Object.fromEntries(new URLSearchParams(qs || "")));
  }
  return townView();
}
function ztHeader(st, back) {
  const pills = st ? `<span class="ztpill leaf ${st.wilted ? "off" : ""}" title="Streak (days in a row)">${ZT_LEAF}${st.wilted ? 0 : st.n}</span><span class="ztpill drop" title="Watering cans left this month">${ZT_DROP}${ztWaterLeft()}</span>` : "";
  return `<header class="zthead">${back ? `<a class="ztback" href="#/learn">‹ Zest Town</a>` : `<div class="eyebrow">Learning Universe · ${trad() ? "學習宇宙" : "学习宇宙"}</div>`}
    <div class="row between" style="align-items:center;gap:10px"><h1>${back || "Zest Town"}</h1><span class="row" style="gap:6px">${pills}</span></div></header>`;
}
function todayCard(st) {
  return st.doneToday
    ? `<div class="zttoday done">${ZT_LEAF}<span><b>Today counts!</b><br><span class="small">Your tree grows again tomorrow. Come back for day ${st.n + 1}.</span></span></div>`
    : `<div class="zttoday">${ZT_LEAF}<span><b>Keep your tree growing</b><br><span class="small">Review flashcards, read a Library chapter, write characters, send a letter or join a session today.</span></span></div>`;
}
function treeCard(st, big) {
  const nx = ztNext(st);
  return `<button type="button" class="card zttree ${big ? "big" : ""}" data-zt="sheet">
    <span class="zttreeart ${st.wilted ? "dead" : ""}">${treeImg(st)}</span>
    <span class="grow"><span class="eyebrow">Streak tree</span>
      <span class="ztday">${st.wilted ? "Wilted" : `Day ${st.n}`}</span>
      <span class="ztstage">${st.wilted ? `Your ${st.lost}-day tree needs water` : esc(stageName(st.stage))}</span>
      ${st.wilted ? "" : `<span class="small muted">${nx.text}</span><span class="ztbar"><i style="width:${nx.pct}%"></i></span>`}
    </span></button>`;
}
function placeCards(big) {
  const d = ztDeck(), dueN = ztQueueAll().length, ws = ztWordStatus();
  const lv = state.lu.lv, words = state.lu.hsk.get(lv);
  let hskLine = `HSK ${lv}`;
  if (words?.length) { const learned = words.filter((w) => statusOf(w, ws) === "learned").length; hskLine = `HSK ${lv} · ${Math.round((learned / words.length) * 100)}% learned`; }
  else ztLoadLevel(lv);
  const card = (href, img, t, z, line, sub, btn) => `<a class="card ztplace ${big ? "big" : ""}" href="${href}"><span class="ztplaceart">${ztImg(img)}</span>
    <span class="grow"><b>${t}</b> <span class="muted">${z}</span><br><span class="small">${line}</span><br><span class="small muted">${sub}</span></span><span class="btn small">${btn}</span></a>`;
  return card("#/learn/cards", "house", "Flashcard Center", trad() ? "字卡中心" : "字卡中心", dueN ? `${dueN} card${dueN === 1 ? "" : "s"} to review today` : "All done for today", `${d.cards.length.toLocaleString()} in your deck · ${state.lu.perDay} new a day`, "Review")
    + card("#/learn/temple", "temple", "HSK Temple", trad() ? "漢語廟" : "汉语庙", hskLine, "Every HSK word, and how well you know it", "Explore")
    + (() => { const c = sbCount(); return card("#/learn/gallery", "gallery", "Sticker Gallery", trad() ? "貼紙館" : "贴纸馆", `${c.n} of ${c.total} stickers collected`, "Every sticker you've earned, and how to get the others", "Visit"); })()
    + (libOpen() ? card("#/learn/library", "library", "Library", trad() ? "圖書館" : "图书馆", "Workbooks & graded readers", "Read your books in the app, and get new ones in the Bookshop", "Open") : "")
    + (calligOpen() ? card("#/learn/callig", "callig", "Calligraphy School", trad() ? "書法學校" : "书法学校", "Stroke order, character box & packages", "Look up any character, watch its strokes, and practise writing it", "Enter") : "")
    + (postOpen() ? (() => { const n = postUnread(); postLoad(); return card("#/learn/post", "post", "Post Office", trad() ? "郵局" : "邮局", n ? `✉️ ${n} new letter${n === 1 ? "" : "s"}` : "Letters in Chinese", "Write short letters to members and hosts", n ? "Read" : "Open"); })() : "");
}
function soonCards(big) {
  const card = (img, t, z, line) => `<div class="card ztplace soon ${big ? "big" : ""}"><span class="ztplaceart">${ztImg(img)}</span>
    <span class="grow"><b>${t}</b> <span class="muted">${z}</span><br><span class="small muted">${line}</span></span><span class="ztsoon">Open soon</span></div>`;
  return (libOpen() ? "" : card("library", "Library", trad() ? "圖書館" : "图书馆", "Still closed. Coming soon to Zest Town."))
    + (calligOpen() ? "" : card("callig", "Calligraphy School", trad() ? "書法學校" : "书法学校", "Still closed. Coming soon to Zest Town."));
}
function townMap(st) {
  const k = wide() ? "wide" : "phone", M = ztMap(k), pct = (x, w) => `${(x / w) * 100}%`;
  const at = (x, y) => `left:${pct(x, M.w)};top:${pct(y, M.h)}`;
  const dueN = ztQueueAll().length, fruit = myFruitKey(), h0 = ztPosFor("fruit", k);
  return `<div class="ztmap ${k}" style="aspect-ratio:${M.w}/${M.h}">
    ${ztImg(M.bg, "ztbg")}
    ${[["house", 21, 18, 43, 33, "a", "#/learn/cards", "Flashcard Center"], ["temple", 23, 19, 46, 36, "a", "#/learn/temple", "HSK Temple"], ["gallery", 21, 18, 42, 34, "a", "#/learn/gallery", "Sticker Gallery"],
      libOpen() ? ["library", 21, 18, 42, 34, "a", "#/learn/library", "Library"] : ["library", 21, 18, 42, 34, "b", "library", "Library, opening soon"], calligOpen() ? ["callig", 21, 18, 42, 34, "a", "#/learn/callig", "Calligraphy School"] : ["callig", 21, 18, 42, 34, "b", "callig", "Calligraphy School, opening soon"],
      ...(postOpen() ? [["post", 21, 18, 42, 34, "a", "#/learn/post", "Post Office"]] : [])]
      .map(([key, ox, oy, bw, bh, tag, to, label]) => { const [x, y] = M[key], st = `${at(x - ox, y - oy)};width:${pct(bw, M.w)};height:${pct(bh, M.h)}`;
        return tag === "a" ? `<a class="zthit" href="${to}" style="${st}" aria-label="${label}"></a>` : `<button type="button" class="zthit" data-zt="soon" data-v="${to}" style="${st}" aria-label="${label}"></button>`; }).join("")}
    <div class="ztriver" style="top:${pct(M.river[0], M.h)};height:${pct(M.river[1], M.h)}" aria-hidden="true"><img class="px" src="icons/zt/river3-${k}.png" alt="" draggable="false"></div>
    <img class="px ztbridge" src="icons/zt/bridge-${k}.png" alt="" draggable="false" style="${at(M.bridge[0], M.bridge[1])};width:${pct(M.bridge[2], M.w)}">
    ${(() => { const [x, y, sz] = M.fsign, k = sz / 24; return `<a class="ztsignwrap" href="#/learn/forest" style="${at(x, y)};width:${pct(sz, M.w)}" aria-label="To the Magical Forest">${ztImg("sign-forest")}<span class="ztsigntext" style="width:${(16 / 24) * 100}%;height:${(11 / 18) * 100}%;font-size:${(k * 1.75 / M.w) * 100}cqw">MAGICAL<br>FOREST</span></a>`; })()}
    ${M.trees.map(([x, y, big], i) => `<img class="px ztbush" src="icons/zt/tree4-${big ? "big" : "small"}.png" alt="" draggable="false" style="${at(x, y)};width:${pct(big ? 24 : 17, M.w)};animation-delay:-${(i * 0.7) % 3}s">`).join("")}
    <button type="button" class="zttreebtn" data-zt="sheet" style="${at(...M.tree)};width:${pct(42, M.w)}" aria-label="Your streak tree">${treeImg(st)}</button>
    ${qlOpen() ? (() => { qlLoad(); const [qx, qy] = ztPosFor("qilin", k); return `<button type="button" class="ztqilin" data-ql="open" style="${at(qx, qy)};width:${pct(26, M.w)}" aria-label="The qilin: daily, weekly and monthly challenges">${qlBang() ? `<span class="qlbang" aria-hidden="true">!</span>` : ""}${ztImg("qilin-0", "q0")}${ztImg("qilin-1", "q1")}</button>`; })() : ""}
    ${st.wilted ? "" : `<button type="button" class="ztfruit" data-zt="cheer" style="${at(...h0)};width:${pct(18, M.w)}" aria-label="Your fruit"><span class="ztbubble" hidden></span>${ztImg("fruit-" + fruit)}</button>`}
    <a class="ztlabel" href="#/learn/cards" style="${at(M.house[0], M.house[1] + 15)}" aria-label="Flashcard Center, ${dueN} due">FLASHCARDS${dueN ? `<em>${dueN}</em>` : ""}</a>
    <a class="ztlabel" href="#/learn/temple" style="${at(M.temple[0], M.temple[1] + 17)}" aria-label="HSK Temple">HSK TEMPLE</a>
    <a class="ztlabel gal" href="#/learn/gallery" style="${at(M.gallery[0], M.gallery[1] + 15)}" aria-label="Sticker Gallery">STICKER GALLERY</a>
    ${libOpen() ? `<a class="ztlabel lib" href="#/learn/library" style="${at(M.library[0], M.library[1] + 15)}" aria-label="Library">LIBRARY</a>`
      : `<button type="button" class="ztlabel soon" data-zt="soon" data-v="library" style="${at(M.library[0], M.library[1] + 15)}" aria-label="Library, opening soon">LIBRARY<em>SOON</em></button>`}
    ${calligOpen() ? `<a class="ztlabel cg" href="#/learn/callig" style="${at(M.callig[0], M.callig[1] + 15)}" aria-label="Calligraphy School">CALLIGRAPHY</a>`
      : `<button type="button" class="ztlabel soon" data-zt="soon" data-v="callig" style="${at(M.callig[0], M.callig[1] + 15)}" aria-label="Calligraphy School, opening soon">CALLIGRAPHY<em>SOON</em></button>`}
    ${postOpen() ? (() => { const n = postUnread(); postLoad(); return `${n ? `<span class="ztmail" style="${at(M.post[0], M.post[1] - 27)};width:${pct(12, M.w)}" aria-hidden="true">${POST_ENV}</span>` : ""}<a class="ztlabel post" href="#/learn/post" style="${at(M.post[0], M.post[1] + 15)}" aria-label="Post Office${n ? `, ${n} new letter${n === 1 ? "" : "s"}` : ""}">POST OFFICE${n ? `<em>${n}</em>` : ""}</a>`; })() : ""}
    <button type="button" class="ztlabel day ${st.wilted ? "dead" : ""}" data-zt="sheet" style="${at(M.plaza[0], M.plaza[1] + 11)}">${st.wilted ? "WILTED" : `DAY ${st.n}`}</button>
  </div>`;
}
// ---------------------------------------------------------------------------
// Notice board 公告栏 in the Magical Forest (26 Nov 2026): the club's wins from the last 14 days, 加油！ cheers,
// and short announcements pinned by hosts/admins. Table notices (+ notice_cheers). Stickers, sessions attended and
// new members are posted by the database; streak-tree stages, level ups, a finished book and the Oracle Bone course
// by the app (nbPost). Members only; profiles.show_milestones = false keeps someone off the board.
// Route: #/learn/forest/board
// ---------------------------------------------------------------------------
const NB_TREE_DAYS = ZT_STAGES.map((x) => x[3]).filter((d) => d >= 7); // a new stage of the streak tree: day 7, 30, 90…
const nbState = () => (state.nb ??= { list: null, loading: false, at: 0, draft: "", days: 7 });
async function nbLoad(force) {
  const N = nbState();
  if (N.loading || (!force && N.list && Date.now() - N.at < 60e3)) return;
  N.loading = true;
  const { data, error } = await sb.rpc("notice_board");
  N.loading = false; N.at = Date.now();
  N.list = error ? (N.list || []) : data;
  if (route() === "learn") render();
}
const nbSeen = () => lsGet("mz-nb-seen") || "";
const nbNew = () => (nbState().list || []).filter((n) => n.user_id !== state.user.id && n.created_at > nbSeen()).length;
function nbPost(kind, key, label) {
  if (state.role !== "member" || state.me?.show_milestones === false) return;
  const k = `mz-nb-${kind}-${key}`; if (lsGet(k)) return; lsSet(k, "1");
  sb.rpc("post_notice", { p_kind: kind, p_key: String(key), p_label: label || null }).then(({ error }) => { if (error) console.error(error); });
}
// Streak-tree stage reached today (called when the town is drawn).
function nbTreeCheck(st) { if (st.doneToday && !st.wilted && NB_TREE_DAYS.includes(st.n)) nbPost("tree", `${st.n}-${todayKey()}`, String(st.n)); }
// "4 people cheered you on" (once, the next time the app opens after someone cheered).
async function nbCheersCheck() {
  if (state.role !== "member") return;
  const since = lsGet("mz-nb-cheers") || new Date(Date.now() - 864e5).toISOString();
  const { data, error } = await sb.rpc("my_new_cheers", { p_since: since });
  lsSet("mz-nb-cheers", new Date().toISOString());
  const r = !error && data?.[0];
  if (r?.n) toast(`🎉 ${r.n === 1 ? `${esc(r.names?.[0] || "Someone")} cheered you on` : `${r.n} cheers for you`} on the notice board. 加油！`);
}
function nbText(n) {
  const L = esc(n.label || ""), k = n.key;
  switch (n.kind) {
    case "tree": { const d = +String(k).split("-")[0]; const i = ZT_STAGES.findIndex((s) => s[3] === d); return [`reached <b>day ${d}</b> of their streak tree${i >= 0 ? `: it's now a ${esc(stageName(i))}` : ""} 🌳`, "Streak tree"]; }
    case "level": { const lv = +k, f = FRUITS.filter((x) => x.level === lv).map((x) => x.en); return [`reached <b>Level ${lv}</b>${f.length ? ` and unlocked the ${esc(f.join(" and "))}` : ""} ⭐`, "Level up"]; }
    case "sticker": { const s = stickerInfo(k); return [`unlocked the <b class="lzh">${esc((Array.isArray(s?.zh) ? s.zh[trad() ? 1 : 0] : s?.zh) || "")} ${esc(s?.en || k)}</b> sticker`, "Sticker"]; }
    case "book": return [`finished the book <b class="lzh">${L}</b> 📖`, "Library"];
    case "course": return [`finished the <b>Oracle Bone Mystery</b> course 🦴`, "Calligraphy School"];
    case "sessions": return [`joined their <b>${esc(k)}th</b> live session 🎉`, "Sessions"];
    case "joined": return ["just joined the club. Say hi! 👋", "New member"];
    default: return [L, ""];
  }
}
const NB_COLORS = ["#fffaf0", "#e8f4ff", "#fff0f0", "#fff6d6", "#eef8e6", "#f3ecff"];
function nbBody() {
  const N = nbState(), me = state.user.id, staff = state.role === "host" || state.role === "admin";
  nbLoad();
  if (N.list) lsSet("mz-nb-seen", new Date().toISOString());
  const items = (N.list || []).map((n, i) => {
    if (n.kind === "announce") return `<div class="nbnote ann" style="--r:.5deg"><i class="nbpin"></i>
      <div class="nbann">📌 From the hosts</div><div class="nbtext">${esc(n.label)}</div>
      <div class="nbmeta">${esc(n.name)} · ${ago(n.created_at)} · until ${new Date(n.until).toLocaleDateString([], { day: "numeric", month: "short" })}${isAdmin() || n.user_id === me ? ` · <button type="button" class="linkbtn" data-nb="del" data-id="${n.id}">Remove</button>` : ""}</div></div>`;
    const [txt, cat] = nbText(n), mine = n.user_id === me;
    return `<div class="nbnote" style="--bg:${NB_COLORS[i % NB_COLORS.length]};--r:${[-1.1, 0.9, -0.5, 1.2, -0.8, 0.4][i % 6]}deg"><i class="nbpin"></i>
      <div class="row" style="gap:10px;align-items:center">${ztImg("fruit-" + (ZT_FRUITS.has(n.fruit) ? n.fruit : "orange"), "nbfruit")}
        <div class="grow" style="min-width:0"><div class="nbtext"><b>${mine ? "You" : esc(n.name)}</b> ${txt}</div><div class="nbmeta">${cat ? `${cat} · ` : ""}${ago(n.created_at)}${isAdmin() ? ` · <button type="button" class="linkbtn" data-nb="del" data-id="${n.id}">Remove</button>` : ""}</div></div></div>
      <div class="nbfoot">${mine ? `<span class="nbcheer mine">加油！ ${n.cheers}</span>` : `<button type="button" class="nbcheer ${n.cheered ? "on" : ""}" data-nb="cheer" data-id="${n.id}" ${n.cheered ? "disabled" : ""} aria-label="Cheer ${esc(n.name)} on">加油！ ${n.cheers}</button>`}</div></div>`;
  }).join("");
  const form = staff ? `<form class="card nbform" data-nb-form><b>Pin an announcement</b><span class="tiny muted">Shown at the top of the board for everyone, then it disappears.</span>
    <textarea maxlength="200" rows="2" data-nb-draft placeholder="Saturday's session moves to 10:00 (Taiwan time)…">${esc(N.draft)}</textarea>
    <div class="row between" style="gap:8px;align-items:center"><label class="small">Show for <select data-nb-days>${[1, 3, 7, 14, 30].map((d) => `<option value="${d}" ${N.days === d ? "selected" : ""}>${d} day${d === 1 ? "" : "s"}</option>`).join("")}</select></label><button class="btn small">📌 Pin it</button></div></form>` : "";
  return `<div class="nbboard"><div class="nbtop">${ztImg("noticeboard", "nbart")}<div><h1>Notice board <span class="zhsub">${trad() ? "公告欄" : "公告栏"}</span></h1><span class="small">The club's wins from the last 2 weeks</span></div></div>
      <div class="nbnotes">${N.list ? items || `<div class="nbnote" style="--bg:#fffaf0;--r:-.6deg"><i class="nbpin"></i><div class="nbtext">Nothing pinned yet. Grow your streak tree, unlock a sticker or finish a book, and your win shows up here!</div></div>` : `<p class="small" style="color:#fff7e8">Reading the board…</p>`}</div></div>
    ${form}
    <p class="tiny muted" style="margin:0">Only these milestones are shown: streak-tree stages, level ups, stickers, finished books and courses, sessions joined, new members. ${state.role === "member" ? `Don't want yours here? Turn it off in <a href="#/me">Me</a>.` : ""}</p>`;
}
const nbView = () => `<header class="zthead"><a class="ztback" href="#/learn/forest">‹ Magical Forest</a></header>${nbBody()}`;
// On a computer the board opens as a pop-up over the forest (like the qilin's challenges); on a phone it's its own page.
function nbSheet() {
  const N = nbState();
  return `<div class="ztover center ${Date.now() - (N.openedAt || 0) > 300 ? "still" : ""}" data-nb="close"><div class="ztsheet nbsheet" role="dialog" aria-label="Notice board" data-stop>
    <button type="button" class="ztx nbx" data-nb="close" aria-label="Close">×</button>${nbBody()}</div></div>`;
}
const nbLink = () => (wide() ? `href="#/learn/forest" data-nb="open"` : `href="#/learn/forest/board"`);
// The board in the forest, and the summary card under it.
const NB_SPOT = { phone: [68, 26, 26], wide: [150, 16, 28] };
function nbForestSprite(k, M) {
  const [x, y, w] = NB_SPOT[k], n = nbNew(), pct = (v, t) => `${(v / t) * 100}%`;
  return `<a class="nbsprite" ${nbLink()} style="left:${pct(x, M.w)};top:${pct(y, M.h)};width:${pct(w, M.w)}" aria-label="Notice board${n ? `, ${n} new` : ""}">${ztImg("noticeboard")}${n ? `<i class="dbadge">${n}</i>` : ""}<span class="nblabel">NOTICE BOARD</span></a>`;
}
function nbCard() {
  nbLoad();
  const N = nbState(), n = nbNew(), fresh = (N.list || []).filter((x) => x.kind !== "announce" && x.user_id !== state.user.id && x.created_at > nbSeen()).slice(0, 3);
  const ann = (N.list || []).find((x) => x.kind === "announce");
  const names = [...new Set(fresh.map((x) => x.name))];
  const line = ann ? `📌 ${esc(ann.label)}` : n ? `${n} new · ${esc(names.join(", "))}${n > names.length ? "…" : ""}` : N.list?.length ? `${N.list.length} win${N.list.length === 1 ? "" : "s"} in the last 2 weeks` : "The club's wins show up here";
  return `<a class="card nbcard" ${nbLink()}>${ztImg("noticeboard", "nbcardart")}<span class="grow" style="min-width:0"><b>Notice board ${trad() ? "公告欄" : "公告栏"}</b>${n ? ` <i class="dbadge static">${n}</i>` : ""}<br><span class="small muted">${line}</span></span><b class="dgo">›</b></a>`;
}
document.addEventListener("click", async (e) => {
  const el = e.target.closest("[data-nb]"); if (!el) return;
  const N = nbState(), a = el.dataset.nb, id = +el.dataset.id;
  if (a === "open") { e.preventDefault(); N.open = true; N.openedAt = Date.now(); render(); nbLoad(true); }
  else if (a === "close") {
    if (e.target.closest("[data-stop]") && !e.target.closest(".nbx")) return; // clicks inside the board
    N.open = false; render();
  } else if (a === "cheer") {
    const n = N.list?.find((x) => x.id === id); if (!n || n.cheered) return;
    n.cheered = true; n.cheers++; render();
    const { error } = await sb.rpc("notice_cheer", { p_id: id });
    if (error) { n.cheered = false; n.cheers--; render(); toast("Couldn't cheer. Check your connection."); }
  } else if (a === "del") {
    if (!confirm("Remove this from the notice board?")) return;
    const { error } = await sb.rpc("notice_delete", { p_id: id });
    if (error) return toast("Couldn't remove it.");
    N.list = N.list.filter((x) => x.id !== id); render();
  }
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && state.nb?.open) { state.nb.open = false; render(); } });
document.addEventListener("input", (e) => {
  if (e.target.matches("[data-nb-draft]")) nbState().draft = e.target.value;
  if (e.target.matches("[data-nb-days]")) nbState().days = +e.target.value;
});
document.addEventListener("submit", async (e) => {
  if (!e.target.matches("[data-nb-form]")) return;
  e.preventDefault();
  const N = nbState(), text = N.draft.trim(); if (!text) return toast("Write the announcement first.");
  const { error } = await sb.rpc("notice_announce", { p_text: text, p_days: N.days });
  if (error) return toast("Couldn't pin it.");
  N.draft = ""; toast("📌 Pinned on the notice board."); nbLoad(true);
});

// ---------------------------------------------------------------------------
// Zest Town dashboard (26 Nov 2026): replaces the List view. On a computer it sits next to the map, exactly as tall
// as the map, no scrolling (tiles stretch). On a phone it's the "Dashboard" side of the Town / Dashboard switch,
// one tile per line. Each tile opens its building; a tile with nothing waiting suggests something to do instead.
// ---------------------------------------------------------------------------
const dashState = () => (state.dash ??= { read: undefined, loading: false });
async function dashLoad() {
  const D = dashState();
  if (calligOpen() && !cgState().box && !cgState().boxLoading) cgBoxLoad();
  if (libOpen()) libLoad();
  if (postOpen()) postLoad();
  if (qlOpen()) qlLoad();
  forestLoad();
  if (D.read !== undefined || D.loading) return;
  D.loading = true;
  const { data } = await sb.from("library_progress").select("book_id, state, updated_at").eq("user_id", state.user.id).order("updated_at", { ascending: false }).limit(5);
  D.loading = false;
  // the book you're reading = the last one you opened that has a chapter ticked off (else the last one opened)
  D.read = (data || []).find((r) => Object.keys(r.state?.read || {}).length) || data?.[0] || null;
  if (route() === "learn") render();
}
function treeMini(st) {
  const nx = ztNext(st);
  return `<button type="button" class="card dtree" data-zt="sheet"><span class="zttreeart ${st.wilted ? "dead" : ""}">${treeImg(st)}</span>
    <span class="grow" style="min-width:0"><span class="deye">Streak tree</span>
      <span class="dtreeday"><b>${st.wilted ? "Wilted" : `Day ${st.n}`}</b> <span class="muted">· ${st.wilted ? `your ${st.lost}-day tree needs water` : esc(stageName(st.stage))}</span></span>
      <span class="dsub">${st.wilted ? "Tap to water it" : `${nx.text.replace(/^Next: /, "").replace(/ \(.*\)$/, "")}`} · ${st.doneToday ? `<b class="dok">today counts ${ZT_LEAF}</b>` : `<b class="dwarn">grow it today</b>`}</span>
    </span></button>`;
}
const dTile = ({ href, art, eye, big, sub, badge, extra = "", cls = "", attrs = "" }) =>
  `<a class="dtile ${cls}" href="${href}" ${attrs}><span class="dart">${art}${badge ? `<i class="dbadge">${badge}</i>` : ""}</span>
    <span class="dtxt"><span class="deye">${eye}</span><b class="dbig">${big}</b><span class="dsub">${sub}</span>${extra}</span></a>`;
const dBar = (pct, col) => `<span class="dbar"><i style="width:${Math.max(0, Math.min(100, pct))}%;background:${col}"></i></span>`;
function dashTiles() {
  const out = [], z = trad();
  // Flashcards
  const q = ztQueueAll(), newN = q.filter((c) => c.reps === 0).length, dueN = q.length - newN, deck = ztDeck().cards.length;
  out.push(dTile({ href: "#/learn/cards", art: ztImg("house"), eye: "Flashcards", badge: q.length || "",
    big: q.length ? `${q.length} to review` : deck ? "All done today" : "No cards yet",
    sub: deck ? (q.length ? [dueN ? `${dueN} due` : "", newN ? `${newN} new` : ""].filter(Boolean).join(" + ") : `${deck.toLocaleString()} in your deck`) : "Add words in the HSK Temple" }));
  // Character box
  if (calligOpen()) {
    const S = cgState(), box = S.box;
    if (box) {
      const due = cgDue(), n = due.length;
      out.push(dTile({ href: box.length ? "#/learn/callig/box" : "#/learn/callig", art: ztImg("callig"), eye: "Character box", badge: n || "",
        big: n ? `${n} to write` : box.length ? "All done today" : "Start your box",
        sub: box.length ? `${box.length} in your box` : "Add some at the School" }));
    } else out.push(dTile({ href: "#/learn/callig", art: ztImg("callig"), eye: "Character box", big: "…", sub: "" }));
  }
  // Letters
  if (postOpen()) {
    const P = postState(), n = postUnread(), from = [...new Set(P.letters.filter((l) => l.recipient === state.user.id && !l.read_at).map((l) => postPerson(l.sender).name))];
    out.push(dTile({ href: "#/learn/post", art: ztImg("post"), eye: "Post Office", badge: n || "",
      big: n ? `${n} new letter${n === 1 ? "" : "s"}` : "No new letters",
      sub: n ? `From ${esc(from.slice(0, 2).join(" and "))}${from.length > 2 ? ` +${from.length - 2}` : ""}` : "Write to someone" }));
  }
  // Reading
  if (libOpen()) {
    const D = dashState(), L = libState(), b = D.read && L.books?.find((x) => x.id === D.read.book_id);
    if (b) {
      const nRead = Object.keys(D.read.state?.read || {}).length, c = L.content.get(b.id), total = c?.s?.chapters?.length || 0;
      out.push(dTile({ href: `#/learn/library/${b.id}`, art: b.cover ? `<img class="dcover" src="${esc(b.cover)}" alt="">` : ztImg("library"), eye: "Reading", cls: "lzh",
        big: esc(b.title_zh || b.title), sub: nRead ? `${nRead}${total ? `/${total}` : ""} chapter${nRead === 1 && !total ? "" : "s"} read` : "Just started",
        extra: total ? dBar((nRead / total) * 100, "#2f6fa3") : "" }));
    } else out.push(dTile({ href: "#/learn/library", art: ztImg("library"), eye: "Reading", big: "Find a book", sub: "A free one is waiting" }));
  }
  // Latest sticker
  const mine = (state.stickerAwards || []).filter((a) => a.user_id === state.user.id && stickerInfo(a.sticker)).sort((a, b) => (b.awarded_at || "").localeCompare(a.awarded_at || ""));
  const sc = sbCount();
  if (isHost()) out.push(dTile({ href: "#/learn/gallery", art: ztImg("gallery"), eye: "Stickers", big: "Every sticker", sub: "Hosts have them all" }));
  else if (mine[0]) {
    const s = stickerInfo(mine[0].sticker);
    out.push(dTile({ href: "#/learn/gallery", art: `<span class="dstk">${stickerSvg(mine[0].sticker)}</span>`, eye: "Latest sticker", cls: "lzh",
      big: `${esc((Array.isArray(s.zh) ? s.zh[z ? 1 : 0] : s.zh) || "")} ${esc(s.en || "")}`.trim(), sub: `${mine[0].awarded_at ? ago(mine[0].awarded_at) + " · " : ""}${sc.n}/${sc.total}` }));
  } else out.push(dTile({ href: "#/learn/gallery", art: ztImg("gallery"), eye: "Stickers", big: "None yet", sub: "See how to earn them" }));
  // HSK Temple
  const lv = HSK_LEVELS.includes(state.lu.lv) ? state.lu.lv : "1", words = state.lu.hsk.get(lv), ws = ztWordStatus();
  const learnedAll = ztDeck().cards.filter((c) => c.hsk_level && (c.interval_days || 0) >= ZT_KNOWN_DAYS).length;
  let pct = null; if (words?.length) pct = Math.round((words.filter((w) => statusOf(w, ws) === "learned").length / words.length) * 100); else ztLoadLevel(lv);
  out.push(dTile({ href: "#/learn/temple", art: ztImg("temple"), eye: "HSK Temple",
    big: `${learnedAll.toLocaleString()} learned`, sub: pct === null ? `HSK ${esc(lv)} words` : `HSK ${esc(lv)} · ${pct}%`, extra: pct === null ? "" : dBar(pct, "#2e7d48") }));
  return out;
}
function dashQilin() {
  if (!qlOpen()) return "";
  const Q = qlState();
  if (!Q.log) return `<button type="button" class="dql" data-ql="open"><span class="dqlart">${ztImg("qilin-0")}</span><span class="dtxt"><span class="deye">Challenges ${trad() ? "麒麟" : "麒麟"}</span><span class="dsub">Loading…</span></span></button>`;
  const col = { day: "#c2410c", week: "#2e7d48", month: "#9b2c2c" }, lab = { day: "TODAY", week: "WEEK", month: "MONTH" };
  const rows = qlStatus().map((s) => `<span class="dqrow"><span class="dqlab" style="color:${col[s.p]}">${lab[s.p]}</span><span style="min-width:0"><b class="dqt">${esc(s.c.t)}</b>${dBar(s.done ? 100 : (s.have / s.c.n) * 100, s.done ? "#1b6f1b" : col[s.p])}</span>
    <b class="dqn ${s.done && !s.claimed ? "ready" : ""}">${s.claimed ? "✓" : s.done ? `Claim +${QL_XP[s.p]} XP` : `${Math.min(s.have, s.c.n)}/${s.c.n}`}</b></span>`).join("");
  return `<button type="button" class="dql ${qlBang() ? "ready" : ""}" data-ql="open" aria-label="Qilin challenges"><span class="dqlart">${ztImg("qilin-0")}${qlBang() ? `<i class="qlbang">!</i>` : ""}</span>
    <span class="dtxt"><span class="deye">Challenges ${trad() ? "麒麟" : "麒麟"}</span>${rows}</span></button>`;
}
function dashForest() {
  const F = state.lu.forest, list = F.list ? forestWithMe(F.list).filter((m) => m.user_id !== state.user.id) : null;
  const n = list?.length || 0, fr = (list || []).slice(0, 3).map((m) => ztImg("fruit-" + (ZT_FRUITS.has(m.fruit) ? m.fruit : "orange"))).join("");
  return `<a class="dforest" href="#/learn/forest"><span class="dfruits">${fr || ztImg("sign-forest")}</span><span class="grow"><b>${list === null ? "Magical Forest" : n ? `${n} in the Magical Forest today` : "Magical Forest: nobody yet today"}</b></span><b class="dgo">Go ›</b></a>`;
}
function townDash(st, one) {
  dashLoad();
  const ql = dashQilin(), tiles = dashTiles();
  const rows = Math.ceil(tiles.length / (one ? 1 : 2));
  return `<div class="dash ${one ? "one" : ""}">${treeMini(st)}
    <div class="dgrid" style="${one ? "" : `grid-template-rows:${ql ? "auto " : ""}repeat(${rows}, 1fr) auto`}">${ql}${tiles.join("")}${dashForest()}</div></div>`;
}

function townView() {
  const st = ztStreak(), L = state.lu, dash = L.view === "dash" || L.view === "list";
  nbTreeCheck(st); // "list" = the old List view, now the dashboard
  // Computer: map + dashboard side by side (no switch). Phone: Town / Dashboard.
  const toggle = wide() ? "" : `<div class="seg ztseg" role="group" aria-label="Show Zest Town as"><button type="button" data-zt="view" data-v="town" aria-pressed="${!dash}">Town</button><button type="button" data-zt="view" data-v="dash" aria-pressed="${dash}">Dashboard</button></div>`;
  let body;
  if (wide()) body = `<div class="ztwide town">${townMap(st)}<div class="ztside"><div class="ztsidein">${townDash(st)}</div></div></div>`;
  else if (dash) body = townDash(st, true);
  else body = `${townMap(st)}${todayCard(st)}`;
  setTimeout(ztHop, 50); if (qlOpen()) setTimeout(qlWalk, 50);
  return `${ztHeader(st)}${toggle}${body}${qlOpen() && state.ql?.open ? qlSheet() : ""}${L.sheet === "tree" ? treeSheet(st) : ""}${st.wilted && L.sheet !== "tree" ? wiltedModal(st) : ""}`;
}
function treeSheet(st) {
  const nx = ztNext(st), now = new Date(), dow = (now.getDay() + 6) % 7;
  const week = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d, i) => {
    const k = dayBack(dow - i), kind = st.days.get(k), future = i > dow, today = i === dow;
    const mark = kind === "water" ? ZT_DROP : kind ? "✓" : today ? "" : future ? "" : "·";
    return `<span class="ztwk"><small>${d}</small><i class="${kind ? (kind === "water" ? "w" : "y") : today ? "t" : future ? "f" : "n"}">${mark}</i></span>`;
  }).join("");
  const w = ztWaterLeft();
  return `<div class="ztover" data-zt="close"><div class="ztsheet" role="dialog" aria-label="Your streak tree" data-stop>
    <button type="button" class="ztx" data-zt="close" aria-label="Close">×</button>
    <div class="row" style="gap:14px;align-items:center"><span class="zttreeart lg ${st.wilted ? "dead" : ""}">${treeImg(st)}</span>
      <div><div class="eyebrow">Your streak tree</div><div class="ztday">${st.wilted ? "Wilted" : `Day ${st.n}`}</div><div class="ztstage">${esc(stageName(st.stage))}</div>
      ${st.wilted ? "" : `<div class="small muted" style="margin-top:6px">${nx.text}</div><span class="ztbar"><i style="width:${nx.pct}%"></i></span>`}</div></div>
    <div class="card" style="gap:8px"><b>This week</b><div class="ztweek">${week}</div></div>
    <div class="ztinfo"><div class="card"><b>What counts</b><span class="small">Joining a session, a flashcard review, reading a Library chapter (tap “I’ve read this chapter”), writing a character in the Calligraphy School (practice or character box), or sending a letter at the Post Office, once a day.</span></div>
      <div class="card water">${ZT_DROP}<b>${w} watering can</b><span class="small">${w ? "left this month. If you miss a day, it brings your tree back." : "used this month. You get a new one on the 1st."}</span></div></div>
    ${state.push?.subscribed ? "" : `<a class="ztnotif" href="#/settings" data-scroll="notifications">${ICON.bell}<span><b>Turn on notifications</b> so you never lose your streak. We'll remind you 1 hour before your day ends.</span><span class="chev" aria-hidden="true">›</span></a>`}
    <details class="ztstages"><summary>All 9 stages</summary><div class="ztstagegrid">${ZT_STAGES.map((s, i) => `<span>${ztImg("tree-" + i)}<b>${esc(s[0])}</b><small>Day ${s[3]}${i < 8 ? "+" : ""}</small></span>`).join("")}</div></details>
  </div></div>`;
}
function wiltedModal(st) {
  const w = ztWaterLeft();
  return `<div class="ztover center"><div class="ztmodal" role="dialog" aria-label="Your tree wilted">
    <span class="zttreeart lg dead">${ztImg("tree-dead")}</span>
    <h2>Oh no, your tree wilted!</h2>
    <p>You missed yesterday, so your <b>${st.lost}-day streak</b> stopped.${w ? ` Water your tree to bring it back as a <b>${esc(ZT_STAGES[ztStage(st.lost)][0])}</b>.` : " You already used this month's watering can."}</p>
    ${w ? `<button type="button" class="btn block water" data-zt="water">${ZT_DROP} Water it · 1 left this month</button>` : ""}
    <button type="button" class="btn ghost block" data-zt="restart">Start again from a seed</button>
    ${w ? `<p class="small muted" style="margin:0">No water left? Your tree goes back to a seed.</p>` : ""}
  </div></div>`;
}
function cardsView() {
  const d = ztDeck(), q = ztQueueAll(), room = Math.max(0, state.lu.perDay - ztNewToday());
  const newN = Math.min(room, d.fresh.length), dueN = d.due.length;
  // Sessions that gave you cards
  const bySes = new Map();
  for (const c of d.cards) if (c.session_id) { if (!bySes.has(c.session_id)) bySes.set(c.session_id, []); bySes.get(c.session_id).push(c); }
  const ses = [...bySes.entries()].map(([sid, cs]) => ({ sid, cs, s: ztSession(sid) })).sort((a, b) => (b.s?.starts_at || "").localeCompare(a.s?.starts_at || ""));
  const today = todayKey(), dueOf = (cs) => cs.filter((c) => c.reps === 0 || c.due <= today).length;
  const lvCards = (lv) => d.cards.filter((c) => (lv === "none" ? !c.hsk_level : c.hsk_level === lv));
  return `${ztHeader(ztStreak(), "Flashcard Center <span class='zhsub'>字卡中心</span>")}
  <p class="muted small" style="margin-top:-6px">${d.cards.length} card${d.cards.length === 1 ? "" : "s"} in your deck. Add words from your session notes (Add to flashcards) or from the HSK Temple.</p>
  <div class="card ztreviewall"><span class="ztplaceart">${ztImg("house")}</span><div class="grow"><b style="font-size:18px">Review all</b>
    <div class="small"><span style="color:#1f6fa3;font-weight:700">${newN} new today</span> · <span style="color:var(--green);font-weight:700">${dueN} to review</span></div>
    ${d.fresh.length > newN ? `<div class="small muted">${(d.fresh.length - newN).toLocaleString()} more new cards are waiting: they come in ${state.lu.perDay} a day (change it below).</div>` : ""}
    <button type="button" class="btn" data-zt="start-all" ${q.length ? "" : "disabled"}>${q.length ? `Start · about ${Math.max(1, Math.round(q.length * 0.25))} min` : "All done for today"}</button></div></div>
  <div class="card"><div class="row between"><b>From a session</b><span class="small muted">${ses.length} session${ses.length === 1 ? "" : "s"}</span></div>
    ${ses.length ? ses.map(({ sid, cs, s }) => { const n = dueOf(cs); return `<button type="button" class="ztrow" data-zt="start-ses" data-id="${esc(sid)}"><span class="grow"><b>${esc(s?.title || "Session")}</b><br><span class="small muted">${s ? esc(new Date(s.starts_at).toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" })) + " · " : ""}${cs.length} word${cs.length === 1 ? "" : "s"}</span></span><span class="small ${n ? "duec" : "muted"}">${n ? `${n} due` : "Practice"}</span><span class="chev">›</span></button>`; }).join("")
      : `<p class="small muted" style="margin:0">Open the notes of a session and tap <b>Add to flashcards</b> to practise its words here.</p><a class="small" style="font-weight:800" href="${wide() ? "#/notes" : "#/sessions"}">${wide() ? "Go to my notes ›" : "Go to my sessions ›"}</a>`}</div>
  <div class="card"><div class="row between"><b>By HSK level</b><a class="small" href="#/learn/temple">+ Add words in the HSK Temple</a></div>
    <div class="ztlvgrid">${[...HSK_LEVELS, "none"].map((lv) => { const cs = lvCards(lv), n = dueOf(cs); return `<button type="button" class="ztlv ${lv === "none" ? "other" : ""}" data-zt="start-lv" data-v="${lv}" ${cs.length ? "" : "disabled"}><b>${lv === "none" ? "Not in HSK" : `HSK ${lv}`}</b><small>${cs.length} card${cs.length === 1 ? "" : "s"}</small><small class="${n ? "duec" : ""}">${n ? `${n} due` : "—"}</small></button>`; }).join("")}</div><p class="small muted" style="margin:0">“Not in HSK”: words from your sessions that aren’t on the official HSK lists.</p></div>
  <div class="card row between" style="flex-direction:row;align-items:center"><span><b>New cards a day</b><br><span class="small muted">How many new words Review all adds each day. The rest of your deck waits its turn, so you're never flooded.</span></span>
    <span class="row" style="gap:8px;align-items:center"><button type="button" class="ztstep" data-zt="per" data-v="-1" aria-label="Fewer">−</button><b style="min-width:24px;text-align:center">${state.lu.perDay}</b><button type="button" class="ztstep" data-zt="per" data-v="1" aria-label="More">+</button></span></div>`;
}
function reviewView() {
  const R = state.lu.review;
  if (R.finished) {
    const st = ztStreak();
    return `${ztHeader(st, "Flashcard Center <span class='zhsub'>字卡中心</span>")}
    <div class="card ztdone"><span class="zttreeart lg">${treeImg(st)}</span><h2>太棒了！ Well done</h2>
      <p>You reviewed <b>${R.done} card${R.done === 1 ? "" : "s"}</b>.${R.counted || st.doneToday ? " Today counts for your streak tree." : ""}</p>
      ${R.counted && !isHost() ? `<div class="ztxp"><span>+1 XP</span>${st.n > 0 && st.n % 10 === 0 ? `<span class="bonus">+2 XP · ${st.n}-day streak bonus</span>` : ""}</div>` : st.doneToday && !isHost() ? `<p class="small muted" style="margin:0">You already got today's game XP. Come back tomorrow!</p>` : ""}
      <div class="row" style="gap:8px;flex-wrap:wrap;justify-content:center"><button type="button" class="btn" data-zt="end">Back to the Flashcard Center</button><a class="btn ghost" href="#/learn" data-zt="end">Go to Zest Town</a></div></div>`;
  }
  const c = R.queue[R.i], s = c.session_id && ztSession(c.session_id);
  const src = c.source === "session" && s ? `From “${esc(s.title)}”` : c.hsk_level ? `HSK ${esc(c.hsk_level)}` : "";
  const g = [["Again", 0, "again"], ["Hard", 1, "hard"], ["Good", 2, "good"], ["Easy", 3, "easy"]];
  return `${ztHeader(null, esc(R.title))}
  <div class="ztprog"><span>${Math.min(R.i + 1, R.queue.length)} / ${R.queue.length}</span><span class="ztbar"><i style="width:${(R.i / R.queue.length) * 100}%"></i></span><button type="button" class="link small" data-zt="end">Stop</button></div>
  <button type="button" class="ztcard ${R.flipped ? "flipped" : ""}" data-zt="flip" aria-label="${R.flipped ? "Answer shown" : "Show the answer"}">
    ${c.reps === 0 ? `<span class="ztnew">New</span>` : ""}
    <span class="ztzh">${esc(cardZh(c))}</span>
    ${R.flipped ? `<span class="ztpy">${esc(py(c.pinyin))}</span><span class="ztmean">${esc(c.meaning)}</span>${src ? `<span class="small muted">${src}</span>` : ""}` : `<span class="small muted">Say it out loud, then tap to check</span>`}
  </button>
  ${R.flipped ? `<div class="ztgrades">${g.map(([t, v, cls]) => `<button type="button" class="${cls}" data-zt="grade" data-v="${v}"><b>${t}</b><small>${ivText(ztPreview(c, v))}</small></button>`).join("")}</div>`
    : `<button type="button" class="btn block" data-zt="flip">Show answer</button>`}`;
}
function templeView() {
  const L = state.lu, lv = L.lv;
  const pills = HSK_LEVELS.map((l) => `<button type="button" class="ztlvpill" data-zt="lv" data-v="${l}" aria-pressed="${l === lv}">HSK ${l}</button>`).join("")
    + `<button type="button" class="ztlvpill ztmappill" data-zt="lv" data-v="map" aria-pressed="${lv === "map"}">▦ Map view</button>`;
  if (lv === "map") return templeMapView(pills);
  const words = L.hsk.get(lv), ws = ztWordStatus();
  if (!words) ztLoadLevel(lv);
  let main = `<p class="muted small">Loading HSK ${lv}…</p>`, side = "";
  if (words) {
    const cnt = { learned: 0, seen: 0, none: 0 };
    for (const w of words) cnt[statusOf(w, ws)]++;
    const T = words.length, pc = (n) => (n / T) * 100;
    const inDeck = new Set(L.cards.flatMap((c) => [c.hanzi, c.hanzi_trad].filter(Boolean)));
    const tiles = words.slice(0, L.show).map((w) => {
      const s = statusOf(w, ws), z = wordZh(w), picked = L.pick?.has(w.id), owned = inDeck.has(w.hanzi);
      return `<button type="button" class="zttile ${s} ${z.length > 2 ? "long" : ""} ${L.word === w.id ? "sel" : ""}" data-zt="${L.pick ? "tick" : "word"}" data-id="${w.id}" ${L.pick && s === "learned" ? "disabled" : ""} aria-label="${esc(z)} ${esc(py(w.pinyin))}">${esc(z)}${L.pick ? `<i class="tk ${picked ? "on" : ""}"></i>` : ""}</button>`;
    }).join("");
    const wsel = L.word && words.find((w) => w.id === L.word);
    if (wsel) side = ztWordCard(wsel, ws, inDeck);
    main = `<div class="card" style="gap:8px"><div class="row between"><b>HSK ${lv} · ${T.toLocaleString()} words</b><b style="color:var(--green)">${Math.round(pc(cnt.learned))}% learned</b></div>
      <div class="ztlvbar"><i class="l" style="width:${pc(cnt.learned)}%"></i><i class="s" style="width:${pc(cnt.seen)}%"></i></div>
      <div class="ztlegend"><span><i class="l"></i>Learned ${cnt.learned}</span><span><i class="s"></i>Seen ${cnt.seen}</span><span><i class="n"></i>Not yet ${cnt.none}</span></div>
      ${(() => { const left = new Set(words.filter((w) => !inDeck.has(w.hanzi)).map((w) => w.hanzi)).size;
        return left ? `<button type="button" class="btn ghost small ztaddall" data-zt="add-level">＋ Add all ${left === new Set(words.map((w) => w.hanzi)).size ? "" : "remaining "}${left.toLocaleString()} HSK ${lv} words to my flashcards</button>`
          : `<span class="small" style="color:var(--green);font-weight:800">✓ All HSK ${lv} words are in your flashcards</span>`; })()}</div>
      <div class="row between" style="align-items:center"><span class="small muted">${L.pick ? "Tick words, then add them or mark them as known" : "Tap a word to see it"}</span>
        <span class="row" style="gap:6px">${L.pick ? (() => { const avail = words.filter((w) => statusOf(w, ws) !== "learned").length, all = avail && L.pick.size >= avail;
          return `<button type="button" class="ztselbtn" data-zt="pick-all" data-v="${all ? "none" : "all"}" ${avail ? "" : "disabled"}>${all ? "Clear all" : "Select all"}</button>`; })() : ""}<button type="button" class="ztselbtn ${L.pick ? "on" : ""}" data-zt="pick">${L.pick ? "Cancel" : "Select words"}</button></span></div>
      <div class="zttiles">${tiles}</div>
      ${T > L.show ? `<button type="button" class="btn ghost block" data-zt="more">Show more (${(T - L.show).toLocaleString()} left)</button>` : ""}
      ${L.pick ? `<div class="ztselbar"><span class="ztselcount">${L.pick.size} word${L.pick.size === 1 ? "" : "s"} selected</span><span class="ztselbtns"><button type="button" class="btn ghost small" data-zt="know-picked" ${L.pick.size ? "" : "disabled"}>✓ I know them</button><button type="button" class="btn small" data-zt="add-picked" ${L.pick.size ? "" : "disabled"}>Add to flashcards</button></span></div>` : ""}`;
  }
  const head = `<div class="ztthead"><span class="ztplaceart">${ztImg("temple")}</span><span class="small muted">Every HSK word, and how well you know it.<br>Grey: not met yet · light green: seen · dark green: known (next review 3+ months away).</span></div>`;
  return `${ztHeader(ztStreak(), `HSK Temple <span class='zhsub'>${trad() ? "漢語廟" : "汉语庙"}</span>`)}${head}<div class="ztlvpills">${pills}</div>
    ${wide() && side ? `<div class="ztcols"><div class="grow" style="min-width:0;display:flex;flex-direction:column;gap:12px">${main}</div><div class="ztsidecol">${side}</div></div>` : `${main}${side ? `<div class="ztwordsheet">${side}</div>` : ""}`}`;
}

// The word card shown next to the tiles (also used by the Map view).
function ztWordCard(wsel, ws, inDeck) {
  const s = statusOf(wsel, ws), owned = inDeck.has(wsel.hanzi);
  return `<div class="card ztword" ${wide() ? "" : 'role="dialog"'}><div class="row between" style="align-items:flex-start"><span><span class="ztwz">${esc(wordZh(wsel))}</span> <span class="ztwp">${esc(py(wsel.pinyin))}</span></span>
    <button type="button" class="ztx" data-zt="word" data-id="" aria-label="Close">×</button></div>
    <div>${esc(wsel.meaning)}</div><div class="small muted">HSK ${esc(wsel.level)}${wsel.types ? " · " + esc(wsel.types) : ""}${wsel.hanzi_trad && wsel.hanzi_trad !== wsel.hanzi ? ` · ${trad() ? "简" : "繁"} ${esc(trad() ? wsel.hanzi : wsel.hanzi_trad)}` : ""}</div>
    <span class="ztst ${s}">${s === "learned" ? "Learned" : s === "seen" ? "Seen" : "Not yet"}</span>
    ${owned ? `<span class="small muted">In your flashcards</span>` : `<button type="button" class="btn" data-zt="add-word" data-id="${wsel.id}">+ Add to my flashcards</button>`}
    ${s === "learned" ? `<button type="button" class="link small" data-zt="unknow" data-id="${wsel.id}" style="align-self:flex-start">Not learned after all? Undo</button>`
      : `<button type="button" class="btn ghost ztknow" data-zt="know" data-id="${wsel.id}">✓ I already know this word</button>`}</div>`;
}

// ---- HSK Temple · Map view: every HSK 3.0 word as a square, one box per level (sized by its number of words) ----
// Same idea as the website's HSK Map (Mandarin-Zest-Class-Calendar/hskmap.html), coloured by the member's own status.
const TMAP_COL = { "1": "#4f9a4f", "2": "#2a8f86", "3": "#3f73b8", "4": "#7a5ab8", "5": "#c4457a", "6": "#e2632f", "7-9": "#b8901f" };
function tmapSquarify(items, x, y, w, h, out) {
  if (!items.length) return;
  if (items.length === 1) { out.push([items[0], x, y, w, h]); return; }
  const total = items.reduce((a, b) => a + b.v, 0), side = Math.min(w, h), rest = items.slice(); let row = [], best = Infinity;
  const worst = (r) => { const sum = r.reduce((a, b) => a + b.v, 0), len = (sum / total) * (w * h) / side; let m = 0; for (const it of r) { const q = (it.v / total) * (w * h) / len; m = Math.max(m, len / q, q / len); } return m; };
  while (rest.length) { const t = row.concat([rest[0]]), wv = worst(t); if (row.length && wv > best) break; row = t; best = wv; rest.shift(); }
  const rsum = row.reduce((a, b) => a + b.v, 0), frac = rsum / total;
  if (w >= h) { const rw = w * frac; let yy = y; for (const it of row) { const hh = (h * it.v) / rsum; out.push([it, x, yy, rw, hh]); yy += hh; } tmapSquarify(rest, x + rw, y, w - rw, h, out); }
  else { const rh = h * frac; let xx = x; for (const it of row) { const ww = (w * it.v) / rsum; out.push([it, xx, y, ww, rh]); xx += ww; } tmapSquarify(rest, x, y + rh, w, h - rh, out); }
}
function tmapLayout() {
  const L = state.lu;
  if (L.tmap && L.tmap.n === HSK_LEVELS.reduce((a, l) => a + (L.hsk.get(l)?.length || 0), 0)) return L.tmap;
  const byL = {}; let sum = 0;
  for (const l of HSK_LEVELS) { const seen = new Set(); byL[l] = (L.hsk.get(l) || []).filter((w) => !seen.has(w.hanzi) && seen.add(w.hanzi)); sum += byL[l].length; }
  const GW = Math.sqrt(sum * 1.3), GH = sum / GW, G = 0.9, rects = [];
  tmapSquarify(HSK_LEVELS.map((l) => ({ l, v: byL[l].length })).filter((i) => i.v).sort((a, b) => b.v - a.v), 0, 0, GW, GH, rects);
  const boxes = rects.map((r) => ({ l: r[0].l, x: GW - r[1] - r[3] + G / 2, y: GH - r[2] - r[4] + G / 2, w: r[3] - G, h: r[4] - G }));
  const b1 = boxes.find((b) => b.l === "1"), b2 = boxes.find((b) => b.l === "2");
  if (b1 && b2 && Math.abs(b1.y - b2.y) < 0.01 && b1.x > b2.x) { const left = b2.x; b2.x = left + b1.w + G; b1.x = left; }
  const conts = [], bb = [1e9, 1e9, -1e9, -1e9];
  for (const b of boxes) {
    const words = byL[b.l], n = words.length; let best = null;
    for (let c = 1; c <= n; c++) { const r = Math.ceil(n / c), t = Math.min(b.w / c, b.h / r), waste = b.w * b.h - n * t * t + (r * c - n) * t * t * 3; if (!best || waste < best.waste) best = { c, r, t, waste }; }
    const { c, r, t } = best, gx = b.x + (b.w - c * t) / 2, gy = b.y + (b.h - r * t) / 2;
    conts.push({ l: b.l, words, n, c, r, t, gx, gy, box: [gx, gy, gx + c * t, gy + r * t] });
    bb[0] = Math.min(bb[0], gx); bb[1] = Math.min(bb[1], gy); bb[2] = Math.max(bb[2], gx + c * t); bb[3] = Math.max(bb[3], gy + r * t);
  }
  L.tmap = { n: HSK_LEVELS.reduce((a, l) => a + (L.hsk.get(l)?.length || 0), 0), conts, bb };
  return L.tmap;
}
function templeMapView(pills) {
  const L = state.lu, missing = HSK_LEVELS.filter((l) => !L.hsk.has(l));
  missing.forEach((l) => ztLoadLevel(l));
  const head = `<div class="ztthead"><span class="ztplaceart">${ztImg("temple")}</span><span class="small muted">Every HSK word on one map, one box per level.<br>Grey: not met yet · light green: seen · dark green: known. Zoom in and tap a square.</span></div>`;
  const top = `${ztHeader(ztStreak(), `HSK Temple <span class='zhsub'>${trad() ? "漢語廟" : "汉语庙"}</span>`)}${head}<div class="ztlvpills">${pills}</div>`;
  if (missing.length) return `${top}<div class="card"><p class="muted small" style="margin:0">Loading every HSK word (${HSK_LEVELS.length - missing.length} of ${HSK_LEVELS.length} levels)…</p></div>`;
  const ws = ztWordStatus(), M = tmapLayout(), inDeck = new Set(L.cards.flatMap((c) => [c.hanzi, c.hanzi_trad].filter(Boolean)));
  let tl = 0, ts = 0, tn = 0;
  const chips = M.conts.slice().sort((a, b) => HSK_LEVELS.indexOf(a.l) - HSK_LEVELS.indexOf(b.l)).map((c) => {
    let l = 0; for (const w of c.words) { const st = statusOf(w, ws); if (st === "learned") l++; else if (st === "seen") ts++; } tl += l; tn += c.n;
    const p = Math.round((l / c.n) * 100);
    return `<button type="button" class="tmchip" data-zt="tmap-go" data-v="${c.l}"><b style="color:${TMAP_COL[c.l]}">HSK ${c.l}</b><span>${p}%</span><i><em style="width:${p}%;background:${TMAP_COL[c.l]}"></em></i></button>`;
  }).join("");
  const wsel = L.word && M.conts.flatMap((c) => c.words).find((w) => w.id === L.word);
  const side = wsel ? ztWordCard(wsel, ws, inDeck) : "";
  const main = `<div class="card" style="gap:8px"><div class="row between"><b>All HSK · ${tn.toLocaleString()} words</b><b style="color:var(--green)">${tl.toLocaleString()} learned</b></div>
      <div class="ztlvbar"><i class="l" style="width:${(tl / tn) * 100}%"></i><i class="s" style="width:${(ts / tn) * 100}%"></i></div>
      <div class="tmchips">${chips}</div></div>
    <div class="tmap" id="tmap"><canvas id="tmapCv" aria-label="Map of every HSK word, coloured by how well you know it"></canvas>
      <div class="tmzoom"><button type="button" data-zt="tmap-zoom" data-v="in" aria-label="Zoom in">+</button><button type="button" data-zt="tmap-zoom" data-v="out" aria-label="Zoom out">−</button><button type="button" data-zt="tmap-zoom" data-v="fit" aria-label="See the whole map">⤢</button></div>
      <span class="tmhint">Drag to move · pinch or scroll to zoom · tap a square</span></div>`;
  return `${top}${wide() && side ? `<div class="ztcols"><div class="grow" style="min-width:0;display:flex;flex-direction:column;gap:12px">${main}</div><div class="ztsidecol">${side}</div></div>` : `${main}${side ? `<div class="ztwordsheet">${side}</div>` : ""}`}`;
}
// draws the map after each render (the camera is kept in state.lu.tcam)
function tmapAfterRender() {
  const cv = document.getElementById("tmapCv"); if (!cv) return;
  const L = state.lu, M = L.tmap, wrap = cv.parentElement, ctx = cv.getContext("2d"), ws = ztWordStatus();
  const hex = (c, a) => { const n = parseInt(c.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; };
  const cam = L.tcam || (L.tcam = { x: 0, y: 0, s: 0 });
  let W = 0, H = 0, dpr = 1, raf = 0;
  const fit = () => { const b = M.bb; cam.s = Math.min(W / (b[2] - b[0] + 4), H / (b[3] - b[1] + 4)); cam.x = (b[0] + b[2]) / 2; cam.y = (b[1] + b[3]) / 2; };
  const toS = (x, y) => [(x - cam.x) * cam.s + W / 2, (y - cam.y) * cam.s + H / 2];
  const toW = (px, py) => [(px - W / 2) / cam.s + cam.x, (py - H / 2) / cam.s + cam.y];
  const COL = { learned: "#3f8f2f", seen: "#b8e2aa", none: "#e9e4df" };
  function paint() {
    raf = 0; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.fillStyle = "#f6f2ee"; ctx.fillRect(0, 0, W, H);
    const tl = toW(0, 0), br = toW(W, H), z = trad();
    for (const c of M.conts) {
      const a = toS(c.box[0], c.box[1]), e = toS(c.box[2], c.box[3]), col = TMAP_COL[c.l];
      if (c.box[2] < tl[0] || c.box[0] > br[0] || c.box[3] < tl[1] || c.box[1] > br[1]) continue;
      const ts = c.t * cam.s, gap = ts > 6 ? Math.max(1, ts * 0.07) : 0, txt = ts >= 24;
      c.words.forEach((w, j) => {
        const X = c.gx + (j % c.c) * c.t, Y = c.gy + Math.floor(j / c.c) * c.t;
        if (X + c.t < tl[0] || X > br[0] || Y + c.t < tl[1] || Y > br[1]) return;
        const p = toS(X, Y), st = statusOf(w, ws);
        ctx.fillStyle = COL[st]; ctx.fillRect(p[0] + gap / 2, p[1] + gap / 2, ts - gap, ts - gap);
        if (w.id === L.word) { ctx.strokeStyle = "#2a2420"; ctx.lineWidth = Math.max(2, ts * 0.08); ctx.strokeRect(p[0] + 1, p[1] + 1, ts - 2, ts - 2); }
        if (txt) { const h = z && w.hanzi_trad ? w.hanzi_trad : w.hanzi, fs = Math.min(ts * 0.42, (ts * 0.86) / Math.max(1, h.length));
          ctx.fillStyle = st === "learned" ? "#fff" : "#2a2420"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
          ctx.font = `700 ${fs}px "Noto Sans ${z ? "TC" : "SC"}", sans-serif`; ctx.fillText(h, p[0] + ts / 2, p[1] + ts * (ts >= 40 ? 0.6 : 0.52));
          if (ts >= 40) { ctx.font = `600 ${Math.min(ts * 0.17, (ts * 1.55) / Math.max(1, (w.pinyin || "").length))}px Outfit, sans-serif`; ctx.fillStyle = st === "learned" ? "rgba(255,255,255,.9)" : "#a8431a"; ctx.fillText(py(w.pinyin || ""), p[0] + ts / 2, p[1] + ts * 0.22); } }
      });
      ctx.strokeStyle = hex(col, 0.8); ctx.lineWidth = 2; ctx.strokeRect(a[0] - 1.5, a[1] - 1.5, e[0] - a[0] + 3, e[1] - a[1] + 3);
      if (ts < 16) { // level name + % learned
        const bw = e[0] - a[0], bh = e[1] - a[1], big = Math.max(12, Math.min(52, bw * 0.2, bh * 0.32)), cx = (a[0] + e[0]) / 2, cy = (a[1] + e[1]) / 2;
        let l = 0; for (const w of c.words) if (statusOf(w, ws) === "learned") l++;
        const lab = (t, y, f, color) => { ctx.font = f; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.lineJoin = "round"; ctx.lineWidth = 5; ctx.strokeStyle = "rgba(255,255,255,.9)"; ctx.strokeText(t, cx, y); ctx.fillStyle = color; ctx.fillText(t, cx, y); };
        lab(`HSK ${c.l.replace("-", "–")}`, cy - big * 0.2, `800 ${big}px Outfit, sans-serif`, col);
        if (bh > big * 2.6 && bw > big * 3.2) lab(`${Math.round((l / c.n) * 100)}% learned`, cy + big * 0.55, `700 ${Math.max(10, big * 0.34)}px Outfit, sans-serif`, "#5c4f47");
      }
    }
  }
  const draw = () => { if (!raf) raf = requestAnimationFrame(paint); };
  function size() { dpr = Math.min(2, devicePixelRatio || 1); W = wrap.clientWidth; H = wrap.clientHeight; cv.width = W * dpr; cv.height = H * dpr; if (!cam.s) fit(); draw(); }
  const zoomAt = (px, py, f) => { const a = toW(px, py); cam.s = Math.max(1, Math.min(120, cam.s * f)); const b = toW(px, py); cam.x += a[0] - b[0]; cam.y += a[1] - b[1]; draw(); };
  const flyTo = (x, y, s) => { const s0 = cam.s, x0 = cam.x, y0 = cam.y, t0 = performance.now();
    const step = (t) => { const k = Math.min(1, (t - t0) / 450), e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2; cam.x = x0 + (x - x0) * e; cam.y = y0 + (y - y0) * e; cam.s = s0 + (s - s0) * e; draw(); if (k < 1) requestAnimationFrame(step); }; requestAnimationFrame(step); };
  const hit = (x, y) => { for (const c of M.conts) { if (x < c.box[0] || y < c.box[1] || x >= c.box[2] || y >= c.box[3]) continue; const j = Math.floor((y - c.gy) / c.t) * c.c + Math.floor((x - c.gx) / c.t); return j < c.n ? [c, c.words[j]] : [c, null]; } return null; };
  const pts = new Map(); let moved = false, last = null, pinch = null;
  cv.onpointerdown = (e) => { cv.setPointerCapture(e.pointerId); pts.set(e.pointerId, [e.offsetX, e.offsetY]); moved = false; last = [e.offsetX, e.offsetY];
    if (pts.size === 2) { const a = [...pts.values()]; pinch = { d: Math.hypot(a[0][0] - a[1][0], a[0][1] - a[1][1]), s: cam.s }; } };
  cv.onpointermove = (e) => { if (!pts.has(e.pointerId)) return; pts.set(e.pointerId, [e.offsetX, e.offsetY]);
    if (pts.size === 2 && pinch) { const a = [...pts.values()], d = Math.hypot(a[0][0] - a[1][0], a[0][1] - a[1][1]); zoomAt((a[0][0] + a[1][0]) / 2, (a[0][1] + a[1][1]) / 2, (pinch.s * d) / pinch.d / cam.s); moved = true; return; }
    const dx = e.offsetX - last[0], dy = e.offsetY - last[1]; if (Math.abs(dx) + Math.abs(dy) > 4) moved = true;
    if (moved) { cam.x -= dx / cam.s; cam.y -= dy / cam.s; last = [e.offsetX, e.offsetY]; draw(); } };
  cv.onpointerup = (e) => { const tap = pts.size === 1 && !moved; pts.delete(e.pointerId); if (pts.size < 2) pinch = null;
    if (!tap) return; const p = toW(e.offsetX, e.offsetY), h = hit(p[0], p[1]); if (!h) return;
    if (h[1] && h[0].t * cam.s >= 14) { L.word = h[1].id; render(); } else flyTo(p[0], p[1], 30 / h[0].t); };
  cv.onpointercancel = (e) => { pts.delete(e.pointerId); pinch = null; };
  cv.onwheel = (e) => { e.preventDefault(); zoomAt(e.offsetX, e.offsetY, Math.exp(-e.deltaY * 0.0016)); };
  L.tmapApi = { zoom: (v) => (v === "fit" ? (fit(), draw()) : zoomAt(W / 2, H / 2, v === "in" ? 1.6 : 1 / 1.6)),
    go: (l) => { const c = M.conts.find((c) => c.l === l); if (c) flyTo((c.box[0] + c.box[2]) / 2, (c.box[1] + c.box[3]) / 2, Math.min(W / (c.box[2] - c.box[0] + 2), H / (c.box[3] - c.box[1] + 2))); } };
  size(); if (document.fonts) document.fonts.ready.then(draw);
}

async function ztAddWords(ws, source = "hsk") {
  const have = new Set(state.lu.cards.map((c) => c.hanzi));
  const rows = ws.filter((w) => !have.has(w.hanzi)).map((w) => ({ hanzi: w.hanzi, hanzi_trad: w.hanzi_trad, pinyin: w.pinyin, meaning: w.meaning, hsk_level: w.level, source }))
    .filter((r, i, a) => a.findIndex((x) => x.hanzi === r.hanzi) === i);
  if (!rows.length) return 0;
  let n = 0;
  for (let i = 0; i < rows.length; i += 400) {
    const { data, error } = await sb.from("learn_cards").upsert(rows.slice(i, i + 400), { onConflict: "user_id,hanzi", ignoreDuplicates: true }).select("*");
    if (error) { toast("Couldn't add all of those words. Check your connection."); return n; }
    state.lu.cards.push(...data); n += data.length;
  }
  if (source === "hsk" && n) { qLog("hsk_add", n); tEventDaily("hsk_temple"); }
  return n;
}

// "I already know this word": a known card due in 3 months (so it still comes back once in a while).
async function ztMarkKnown(words, known) {
  const L = state.lu, byHanzi = new Map(L.cards.map((c) => [c.hanzi, c]));
  const upd = known
    ? { good_streak: ZT_LEARNED, interval_days: ZT_KNOWN_DAYS, due: addDays(ZT_KNOWN_DAYS), reps: 1, last_review: new Date().toISOString() }
    : { good_streak: 0, interval_days: 0, due: todayKey() };
  const have = words.filter((w) => byHanzi.has(w.hanzi)), fresh = known ? words.filter((w) => !byHanzi.has(w.hanzi)) : [];
  let n = 0;
  if (have.length) {
    const ids = have.map((w) => byHanzi.get(w.hanzi).id);
    for (let i = 0; i < ids.length; i += 150) { // small batches: the ids go in the address
      const { error } = await sb.from("learn_cards").update(upd).in("id", ids.slice(i, i + 150));
      if (error) { toast("Couldn't save that. Check your connection."); return n; }
    }
    for (const id of ids) Object.assign(L.cards.find((c) => c.id === id), upd);
    n += ids.length;
  }
  if (fresh.length) {
    const rows = fresh.filter((w, i, a) => a.findIndex((x) => x.hanzi === w.hanzi) === i)
      .map((w) => ({ hanzi: w.hanzi, hanzi_trad: w.hanzi_trad, pinyin: w.pinyin, meaning: w.meaning, hsk_level: w.level, source: "hsk", ...upd }));
    const { data, error } = await sb.from("learn_cards").upsert(rows, { onConflict: "user_id,hanzi", ignoreDuplicates: true }).select("*");
    if (error) { toast("Couldn't save that. Check your connection."); return n; }
    L.cards.push(...data); n += data.length;
  }
  if (known && n) { qLog("hsk_known", n); tEventDaily("hsk_temple"); }
  return n;
}

// Walking around town: your fruit and the qilin each wander on their own over the town's grass and paths.
// ZT_WALK = spots where a character can stand (left/top in map units on a g-unit grid, flat [x, y, x, y…]), worked
// out from the town7 backgrounds: grass, paths and plots, no buildings, river (the bridge is the only way across),
// streak tree, trees or forest sign. Redo it when the town art changes (script walk2.py, kept outside the repo).
const ZT_WALK = { phone: { g: 3, p: [68,36,71,36,74,36,77,36,80,36,83,36,86,36,14,39,17,39,20,39,23,39,26,39,29,39,32,39,65,39,68,39,71,39,74,39,77,39,80,39,83,39,86,39,89,39,11,42,14,42,17,42,20,42,23,42,26,42,29,42,32,42,65,42,68,42,71,42,74,42,77,42,80,42,83,42,86,42,89,42,92,42,95,42,98,42,101,42,-4,45,-1,45,2,45,5,45,8,45,11,45,14,45,17,45,20,45,23,45,26,45,29,45,32,45,65,45,68,45,71,45,74,45,77,45,80,45,83,45,86,45,89,45,92,45,95,45,98,45,101,45,-4,48,-1,48,2,48,5,48,8,48,11,48,14,48,17,48,20,48,23,48,26,48,29,48,32,48,65,48,68,48,71,48,74,48,77,48,80,48,83,48,86,48,89,48,92,48,95,48,98,48,101,48,-4,51,-1,51,2,51,5,51,8,51,11,51,14,51,17,51,20,51,23,51,26,51,74,51,77,51,80,51,83,51,86,51,89,51,92,51,95,51,98,51,101,51,-4,54,-1,54,2,54,5,54,8,54,11,54,14,54,17,54,74,54,77,54,80,54,83,54,86,54,89,54,92,54,95,54,98,54,101,54,-4,57,-1,57,2,57,5,57,8,57,11,57,14,57,17,57,74,57,77,57,80,57,83,57,86,57,89,57,92,57,95,57,98,57,101,57,-4,60,-1,60,2,60,5,60,8,60,11,60,14,60,17,60,74,60,77,60,80,60,83,60,86,60,89,60,92,60,95,60,98,60,101,60,5,63,8,63,11,63,14,63,17,63,20,63,23,63,26,63,74,63,77,63,80,63,83,63,86,63,89,63,92,63,95,63,98,63,101,63,5,66,8,66,11,66,14,66,17,66,20,66,23,66,26,66,74,66,77,66,80,66,83,66,86,66,89,66,92,66,95,66,98,66,101,66,-4,69,-1,69,2,69,5,69,8,69,11,69,14,69,17,69,20,69,23,69,26,69,74,69,77,69,80,69,83,69,86,69,98,69,101,69,-4,72,-1,72,2,72,5,72,8,72,11,72,14,72,17,72,20,72,23,72,26,72,74,72,77,72,80,72,83,72,86,72,98,72,101,72,-4,75,-1,75,2,75,5,75,8,75,11,75,14,75,17,75,20,75,23,75,26,75,74,75,77,75,80,75,83,75,86,75,98,75,101,75,-4,78,-1,78,2,78,5,78,8,78,11,78,14,78,17,78,20,78,23,78,26,78,74,78,77,78,80,78,83,78,86,78,89,78,92,78,95,78,98,78,101,78,-4,81,5,81,8,81,11,81,14,81,17,81,20,81,23,81,26,81,29,81,32,81,35,81,38,81,41,81,44,81,47,81,50,81,53,81,56,81,59,81,62,81,71,81,74,81,77,81,-4,84,5,84,8,84,11,84,14,84,17,84,20,84,23,84,26,84,29,84,41,84,44,84,47,84,50,84,53,84,56,84,59,84,62,84,74,84,77,84,-4,87,8,87,11,87,14,87,17,87,20,87,23,87,26,87,29,87,41,87,44,87,47,87,50,87,53,87,56,87,59,87,62,87,74,87,77,87,-4,90,8,90,11,90,14,90,17,90,20,90,23,90,26,90,29,90,41,90,44,90,47,90,50,90,53,90,56,90,59,90,62,90,65,90,68,90,71,90,74,90,77,90,47,93,50,93,47,96,50,96,47,99,50,99,47,102,50,102,47,105,50,105,47,108,50,108,47,111,50,111,47,114,50,114,47,117,50,117,47,120,50,120,47,123,50,123,47,126,50,126,5,129,8,129,11,129,14,129,17,129,20,129,23,129,26,129,29,129,32,129,35,129,38,129,41,129,44,129,47,129,50,129,53,129,56,129,59,129,62,129,65,129,68,129,71,129,74,129,77,129,80,129,83,129,86,129,8,132,11,132,14,132,17,132,20,132,23,132,26,132,29,132,32,132,35,132,38,132,41,132,44,132,47,132,50,132,53,132,56,132,59,132,62,132,65,132,68,132,71,132,74,132,77,132,80,132,8,135,11,135,14,135,17,135,20,135,23,135,26,135,29,135,32,135,35,135,38,135,41,135,44,135,47,135,50,135,53,135,56,135,59,135,62,135,65,135,68,135,71,135,74,135,77,135,80,135,-4,138,-1,138,2,138,5,138,8,138,11,138,26,138,29,138,32,138,35,138,38,138,41,138,44,138,47,138,50,138,53,138,56,138,59,138,-4,141,-1,141,2,141,5,141,32,141,35,141,38,141,41,141,44,141,47,141,50,141,53,141,56,141,-4,144,-1,144,38,144,41,144,44,144,47,144,50,144,53,144,44,147,47,147,50,147,53,147,44,150,47,150,50,150,53,150,44,153,47,153,50,153,53,153,41,156,44,156,47,156,50,156,53,156,41,159,44,159,47,159,50,159,53,159,56,159,41,162,44,162,47,162,50,162,53,162,56,162,47,165,50,165,50,168,50,171,50,174,11,177,14,177,17,177,20,177,23,177,26,177,29,177,32,177,50,177,68,177,71,177,74,177,77,177,80,177,83,177,86,177,-4,180,-1,180,2,180,5,180,8,180,11,180,14,180,17,180,20,180,23,180,26,180,29,180,32,180,35,180,38,180,41,180,44,180,47,180,50,180,53,180,56,180,59,180,62,180,65,180,68,180,71,180,74,180,77,180,80,180,83,180,86,180,89,180,-4,183,-1,183,2,183,5,183,8,183,11,183,14,183,17,183,20,183,23,183,26,183,29,183,32,183,35,183,38,183,41,183,44,183,47,183,50,183,53,183,56,183,59,183,62,183,65,183,68,183,71,183,74,183,77,183,80,183,83,183,86,183,89,183,92,183,95,183,98,183,101,183,-4,186,-1,186,2,186,5,186,8,186,11,186,14,186,17,186,20,186,23,186,26,186,29,186,32,186,35,186,38,186,41,186,44,186,47,186,50,186,53,186,56,186,59,186,62,186,65,186,68,186,71,186,74,186,77,186,80,186,83,186,86,186,89,186,92,186,95,186,98,186,101,186,-4,189,-1,189,2,189,5,189,8,189,11,189,14,189,17,189,20,189,23,189,26,189,29,189,32,189,35,189,38,189,41,189,44,189,47,189,50,189,53,189,56,189,59,189,62,189,65,189,68,189,71,189,74,189,77,189,80,189,83,189,86,189,89,189,92,189,95,189,98,189,101,189,-4,192,-1,192,2,192,5,192,8,192,11,192,14,192,17,192,20,192,23,192,26,192,29,192,32,192,35,192,38,192,41,192,44,192,47,192,50,192,53,192,56,192,59,192,62,192,65,192,68,192,71,192,74,192,77,192,80,192,83,192,86,192,89,192,92,192,95,192,98,192,101,192,-4,195,-1,195,2,195,5,195,8,195,11,195,14,195,17,195,20,195,23,195,26,195,29,195,32,195,35,195,38,195,41,195,44,195,47,195,50,195,53,195,56,195,59,195,62,195,65,195,68,195,71,195,74,195,77,195,80,195,83,195,86,195,89,195,92,195,95,195,98,195,101,195,-4,198,-1,198,2,198,5,198,8,198,11,198,14,198,17,198,20,198,23,198,26,198,29,198,32,198,35,198,38,198,41,198,44,198,47,198,50,198,53,198,56,198,59,198,62,198,65,198,68,198,71,198,74,198,77,198,80,198,83,198,86,198,89,198,92,198,8,201,32,201,35,201,38,201,41,201,44,201,47,201,50,201,53,201,56,201,59,201,62,201,65,201,68,201,71,201,74,201,77,201,80,201,83,201,86,201,89,201,92,201,41,204,44,204,47,204,50,204,53,204,56,204,59,204,62,204,65,204,68,204,86,204,89,204,92,204,44,207,47,207,50,207,53,207,56,207,59,207,44,210,47,210,50,210,53,210,44,213,47,213,50,213,53,213,44,216,47,216,50,216,53,216,41,219,44,219,47,219,50,219,53,219,41,222,44,222,47,222,50,222,53,222,56,222,41,225,44,225,47,225,50,225,53,225,56,225,41,228,44,228,47,228,50,228,53,228,56,228] },
  wide: { g: 4, p: [196,12,200,12,204,12,196,16,200,16,204,16,196,20,200,20,204,20,208,20,212,20,216,20,188,24,192,24,196,24,200,24,204,24,208,24,212,24,216,24,8,28,188,28,192,28,196,28,200,28,204,28,208,28,212,28,-4,32,0,32,4,32,8,32,184,32,188,32,192,32,196,32,200,32,204,32,208,32,212,32,-4,36,0,36,4,36,8,36,12,36,16,36,20,36,24,36,28,36,200,36,204,36,208,36,212,36,-4,40,0,40,4,40,8,40,12,40,16,40,96,40,100,40,104,40,108,40,112,40,116,40,120,40,124,40,204,40,208,40,212,40,216,40,-4,44,0,44,4,44,8,44,12,44,16,44,92,44,96,44,100,44,104,44,108,44,112,44,116,44,120,44,124,44,128,44,132,44,204,44,208,44,212,44,216,44,-4,48,0,48,4,48,8,48,12,48,16,48,92,48,96,48,100,48,104,48,108,48,112,48,116,48,120,48,124,48,128,48,132,48,152,48,156,48,160,48,164,48,168,48,172,48,176,48,180,48,200,48,204,48,208,48,212,48,216,48,-4,52,0,52,4,52,8,52,12,52,16,52,20,52,24,52,28,52,32,52,36,52,40,52,44,52,48,52,52,52,56,52,60,52,64,52,68,52,88,52,92,52,96,52,100,52,104,52,108,52,112,52,116,52,120,52,124,52,128,52,132,52,136,52,140,52,144,52,148,52,152,52,156,52,160,52,164,52,168,52,172,52,176,52,180,52,184,52,188,52,192,52,196,52,200,52,204,52,208,52,212,52,216,52,-4,56,0,56,4,56,8,56,12,56,16,56,20,56,24,56,28,56,32,56,36,56,40,56,44,56,48,56,52,56,56,56,60,56,64,56,68,56,72,56,76,56,80,56,84,56,88,56,92,56,96,56,100,56,104,56,108,56,112,56,116,56,120,56,124,56,128,56,132,56,136,56,140,56,144,56,148,56,152,56,156,56,160,56,164,56,168,56,172,56,176,56,180,56,184,56,188,56,192,56,196,56,200,56,204,56,208,56,212,56,216,56,-4,60,0,60,4,60,8,60,12,60,16,60,20,60,24,60,28,60,32,60,36,60,40,60,44,60,48,60,52,60,56,60,60,60,64,60,68,60,72,60,76,60,80,60,84,60,88,60,92,60,96,60,100,60,104,60,108,60,112,60,116,60,120,60,124,60,128,60,132,60,136,60,140,60,144,60,148,60,152,60,156,60,160,60,164,60,168,60,172,60,176,60,180,60,184,60,188,60,192,60,196,60,208,60,212,60,216,60,-4,64,0,64,4,64,8,64,12,64,16,64,20,64,24,64,28,64,32,64,36,64,40,64,44,64,48,64,52,64,56,64,60,64,64,64,68,64,72,64,76,64,80,64,84,64,88,64,92,64,96,64,100,64,104,64,108,64,112,64,116,64,120,64,124,64,128,64,132,64,136,64,140,64,144,64,148,64,152,64,156,64,160,64,164,64,168,64,172,64,176,64,180,64,184,64,188,64,192,64,196,64,208,64,212,64,216,64,-4,68,0,68,4,68,8,68,12,68,16,68,20,68,24,68,28,68,32,68,36,68,40,68,44,68,48,68,52,68,56,68,60,68,64,68,68,68,72,68,76,68,80,68,84,68,88,68,92,68,96,68,100,68,104,68,108,68,112,68,116,68,120,68,124,68,128,68,132,68,136,68,140,68,144,68,148,68,152,68,156,68,160,68,164,68,168,68,172,68,176,68,180,68,184,68,188,68,192,68,196,68,200,68,204,68,208,68,212,68,216,68,-4,72,0,72,4,72,8,72,12,72,16,72,20,72,24,72,28,72,32,72,36,72,40,72,44,72,48,72,52,72,56,72,60,72,64,72,68,72,72,72,76,72,80,72,84,72,88,72,92,72,124,72,128,72,132,72,136,72,140,72,144,72,148,72,152,72,156,72,160,72,164,72,168,72,172,72,176,72,180,72,184,72,188,72,192,72,196,72,200,72,204,72,208,72,212,72,216,72,-4,76,0,76,4,76,8,76,12,76,16,76,20,76,24,76,28,76,32,76,36,76,40,76,44,76,48,76,52,76,56,76,60,76,64,76,68,76,72,76,76,76,80,76,84,76,88,76,132,76,136,76,140,76,144,76,148,76,152,76,156,76,160,76,164,76,168,76,172,76,176,76,180,76,184,76,188,76,192,76,196,76,200,76,204,76,208,76,212,76,216,76,-4,80,0,80,4,80,8,80,12,80,16,80,20,80,24,80,28,80,32,80,36,80,40,80,44,80,48,80,52,80,56,80,68,80,72,80,76,80,80,80,84,80,88,80,132,80,136,80,148,80,152,80,156,80,160,80,164,80,168,80,172,80,176,80,180,80,184,80,188,80,192,80,196,80,200,80,204,80,208,80,212,80,216,80,-4,84,0,84,4,84,8,84,12,84,16,84,20,84,24,84,28,84,32,84,36,84,40,84,44,84,48,84,52,84,68,84,72,84,76,84,80,84,84,84,88,84,92,84,124,84,128,84,132,84,136,84,140,84,144,84,148,84,152,84,156,84,160,84,164,84,168,84,172,84,176,84,180,84,184,84,188,84,192,84,196,84,200,84,204,84,16,88,20,88,24,88,28,88,32,88,36,88,40,88,44,88,48,88,52,88,56,88,68,88,72,88,76,88,80,88,84,88,136,88,140,88,144,88,148,88,152,88,156,88,160,88,164,88,168,88,172,88,176,88,180,88,184,88,188,88,192,88,196,88,200,88,204,88,16,92,20,92,24,92,36,92,40,92,44,92,48,92,52,92,56,92,60,92,64,92,68,92,72,92,76,92,80,92,84,92,136,92,140,92,144,92,148,92,152,92,156,92,160,92,164,92,168,92,172,92,176,92,180,92,188,92,192,92,196,92,200,92,204,92,16,96,40,96,44,96,48,96,52,96,56,96,60,96,64,96,68,96,72,96,76,96,80,96,84,96,132,96,136,96,140,96,144,96,148,96,152,96,156,96,160,96,164,96,204,96,48,100,52,100,56,100,60,100,64,100,68,100,72,100,76,100,80,100,84,100,132,100,136,100,140,100,144,100,148,100,152,100,156,100,160,100,208,100,56,104,60,104,64,104,68,104,72,104,76,104,80,104,84,104,132,104,136,104,140,104,144,104,148,104,152,104,156,104,160,104,56,108,60,108,64,108,68,108,72,108,76,108,80,108,84,108,132,108,136,108,140,108,144,108,148,108,152,108,156,108,160,108,52,112,56,112,60,112,64,112,68,112,72,112,76,112,80,112,84,112,132,112,136,112,140,112,144,112,148,112,152,112,156,112,160,112,60,116,64,116,68,116,72,116,76,116,80,116,84,116,88,116,92,116,96,116,100,116,104,116,108,116,112,116,116,116,120,116,124,116,128,116,132,116,136,116,140,116,144,116,148,116,152,116,156,116,160,116,64,120,68,120,72,120,76,120,80,120,84,120,88,120,92,120,96,120,100,120,104,120,108,120,112,120,116,120,120,120,124,120,128,120,132,120,136,120,140,120,144,120,148,120,152,120,156,120,160,120,68,124,72,124,76,124,80,124,84,124,88,124,92,124,96,124,100,124,104,124,108,124,112,124,116,124,120,124,124,124,128,124,132,124,136,124,140,124,144,124,148,124,152,124,156,124,160,124,68,128,72,128,76,128,80,128,84,128,88,128,92,128,96,128,100,128,104,128,108,128,112,128,116,128,120,128,124,128,128,128,132,128,136,128,140,128,144,128,148,128,152,128,156,128,160,128,68,132,72,132,76,132,80,132,84,132,88,132,92,132,104,132,108,132,112,132,116,132,120,132,132,132,136,132,140,132,144,132,156,132,160,132,164,132,168,132,172,132,176,132,180,132,184,132,188,132,192,132,196,132,200,132,72,136,76,136,80,136,84,136,104,136,108,136,112,136,116,136,120,136,136,136,140,136,144,136,160,136,164,136,168,136,172,136,176,136,180,136,184,136,188,136,72,140,76,140,80,140,84,140,104,140,108,140,112,140,116,140,120,140,124,140,128,140,132,140,136,140,140,140,144,140,156,140,160,140,164,140,168,140,172,140,176,140,180,140,184,140,188,140,108,144,108,148,108,152,108,156,108,160,108,164,108,168,108,172,108,176,56,180,60,180,64,180,68,180,84,180,88,180,92,180,96,180,100,180,104,180,108,180,112,180,116,180,120,180,124,180,128,180,140,180,144,180,148,180,152,180,156,180,160,180,164,180,168,180,172,180,176,180,180,180,68,184,84,184,88,184,92,184,96,184,100,184,104,184,108,184,112,184,116,184,120,184,124,184,128,184,140,184,144,184,148,184,152,184,156,184,160,184,164,184,168,184,172,184,176,184,180,184,72,188,76,188,80,188,84,188,88,188,92,188,96,188,100,188,104,188,108,188,112,188,116,188,120,188,124,188,128,188,132,188,136,188,140,188,144,188,148,188,152,188,156,188,172,188,176,188,180,188,72,192,76,192,80,192,84,192,88,192,92,192,96,192,100,192,104,192,108,192,112,192,116,192,120,192,124,192,128,192,132,192,136,192,140,192,144,192,148,192,152,192,156,192,168,192,172,192,176,192,180,192,76,196,80,196,84,196,88,196,92,196,96,196,100,196,104,196,108,196,112,196,116,196,120,196,124,196,128,196,132,196,136,196,140,196,144,196,148,196,152,196,156,196,160,196,180,196,76,200,80,200,84,200,88,200,92,200,96,200,100,200,104,200,108,200,112,200,116,200,120,200,124,200,128,200,132,200,136,200,140,200,180,200,184,200,188,200,192,200,196,200,200,200,204,200,208,200,212,200,76,204,80,204,84,204,88,204,92,204,96,204,100,204,104,204,108,204,112,204,116,204,120,204,124,204,128,204,132,204,136,204,140,204,180,204,184,204,188,204,192,204,196,204,200,204,204,204,208,204,212,204,84,208,88,208,92,208,96,208,100,208,104,208,108,208,112,208,116,208,120,208,124,208,128,208,132,208,136,208,140,208,180,208,184,208,188,208,192,208,196,208,200,208,204,208,208,208,212,208,84,212,88,212,92,212,96,212,100,212,104,212,108,212,112,212,116,212,120,212,124,212,128,212,132,212,136,212,140,212,172,212,176,212,180,212,184,212,188,212,192,212,196,212,200,212,204,212,208,212,212,212,40,216,44,216,48,216,52,216,56,216,60,216,84,216,88,216,92,216,96,216,100,216,104,216,108,216,112,216,116,216,120,216,124,216,128,216,140,216,144,216,148,216,152,216,156,216,160,216,172,216,176,216,180,216,184,216,188,216,192,216,196,216,200,216,204,216,208,216,212,216,216,216,36,220,40,220,44,220,48,220,52,220,56,220,60,220,64,220,68,220,84,220,88,220,92,220,96,220,100,220,104,220,108,220,112,220,116,220,120,220,124,220,128,220,140,220,144,220,148,220,152,220,156,220,160,220,164,220,168,220,172,220,176,220,180,220,184,220,188,220,192,220,196,220,200,220,204,220,208,220,212,220,216,220,36,224,40,224,44,224,48,224,52,224,56,224,60,224,64,224,68,224,72,224,76,224,80,224,84,224,88,224,92,224,96,224,100,224,104,224,108,224,112,224,116,224,120,224,124,224,128,224,132,224,136,224,140,224,144,224,148,224,152,224,156,224,160,224,164,224,168,224,172,224,176,224,180,224,184,224,188,224,192,224,196,224,200,224,204,224,208,224,212,224,216,224] } };
const ztSpotCache = {};
function ztSpots(k) { // only spots where the qilin (26 wide) stays inside the map
  if (!ztSpotCache[k]) { const a = ZT_WALK[k].p, w = ZT_MAP[k].w, list = []; for (let i = 0; i < a.length; i += 2) if (a[i] >= -2 && a[i] <= w - 26) list.push([a[i], a[i + 1]]); ztSpotCache[k] = { list, set: new Set(list.map((q) => q.join())) }; }
  return ztSpotCache[k].list;
}
// A straight walk from a to b stays on walkable ground (every grid point along the way is a spot).
function ztClear(k, a, b) {
  ztSpots(k); const g = ZT_WALK[k].g, set = ztSpotCache[k].set, n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / (g / 2));
  for (let i = 1; i < n; i++) { const x = a[0] + ((b[0] - a[0]) * i) / n, y = a[1] + ((b[1] - a[1]) * i) / n; if (!set.has(`${Math.round((x + 4) / g) * g - 4},${Math.round(y / g) * g}`)) return false; }
  return true;
}
const ztPos = {}; // who -> { k, x, y, dx, dy }
function ztPosFor(who, k) {
  const p = ztPos[who];
  if (p && p.k === k) return [p.x, p.y];
  const s = ztSpots(k), others = Object.entries(ztPos).filter(([w, q]) => w !== who && q.k === k);
  let pick;
  for (let t = 0; t < 30; t++) { pick = s[Math.floor(Math.random() * s.length)]; if (!others.some(([, q]) => Math.hypot(q.x - pick[0], q.y - pick[1]) < 30)) break; }
  ztPos[who] = { k, x: pick[0], y: pick[1] };
  return pick;
}
// Shortest way between two spots over the walkable grid (breadth-first search, 8 directions).
function ztRoute(k, a, b) {
  ztSpots(k); const g = ZT_WALK[k].g, set = ztSpotCache[k].set, key = (q) => q.join(), prev = new Map([[key(a), null]]), q = [a];
  while (q.length) {
    const c = q.shift();
    if (c[0] === b[0] && c[1] === b[1]) { const path = []; for (let n = c; n; n = prev.get(key(n))) path.unshift(n); return path.slice(1); }
    for (const [dx, dy] of [[g, 0], [-g, 0], [0, g], [0, -g], [g, g], [g, -g], [-g, g], [-g, -g]]) {
      const n = [c[0] + dx, c[1] + dy], nk = key(n);
      if (set.has(nk) && !prev.has(nk)) { prev.set(nk, c); q.push(n); }
    }
  }
  return null;
}
// One step: each character picks a place somewhere in town and walks there along the paths, in hops of up to ~22
// units, then picks another. They never aim for the same spot and keep out of each other's way.
function ztStep(who, el) {
  const map = el.closest(".ztmap"); if (!map) return;
  const k = map.classList.contains("wide") ? "wide" : "phone", M = ztMap(k), [x0, y0] = ztPosFor(who, k), me = ztPos[who];
  const others = Object.entries(ztPos).filter(([w, q]) => w !== who && q.k === k).map(([, q]) => q);
  if (!me.route?.length) {
    const spots = ztSpots(k);
    for (let t = 0; t < 12 && !me.route?.length; t++) {
      const d = spots[Math.floor(Math.random() * spots.length)];
      if (Math.hypot(d[0] - x0, d[1] - y0) < 30 || others.some((q) => q.goal && Math.hypot(q.goal[0] - d[0], q.goal[1] - d[1]) < 30)) continue;
      me.route = ztRoute(k, [x0, y0], d); me.goal = d;
    }
    if (!me.route?.length) return;
  }
  // furthest point along the route that's a straight, short walk away
  let n = 0;
  for (let i = 0; i < me.route.length; i++) { const r = me.route[i]; if (Math.hypot(r[0] - x0, r[1] - y0) > 22) break; if (ztClear(k, [x0, y0], r)) n = i; }
  const c = me.route[n];
  if (others.some((q) => Math.hypot(q.x - c[0], q.y - c[1]) < 14)) { me.route = null; return; } // someone's in the way: pick somewhere else
  me.route = me.route.slice(n + 1);
  const d = Math.hypot(c[0] - x0, c[1] - y0);
  Object.assign(me, { x: c[0], y: c[1] });
  const secs = Math.max(0.6, d / 11);
  el.style.transitionDuration = `${secs}s`;
  if (c[0] !== x0) el.classList.toggle("flip", c[0] < x0);
  el.classList.add("hopping");
  el.style.left = `${(c[0] / M.w) * 100}%`; el.style.top = `${(c[1] / M.h) * 100}%`;
  clearTimeout(el._hopEnd); el._hopEnd = setTimeout(() => el.classList.remove("hopping"), secs * 1000);
}
const ztWalkers = {};
function ztWalk(who, sel) {
  if (ztWalkers[who] || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const tick = () => {
    const el = document.querySelector(sel);
    if (!el) { ztWalkers[who] = null; return; }
    if (!el.classList.contains("talk") && !(who === "qilin" && state.ql?.open)) {
      // now and then it stops to look around for a while
      if (Math.random() < (ztPos[who]?.route?.length ? 0.08 : 0.35)) el.classList.toggle("flip");
      else ztStep(who, el);
    }
    ztWalkers[who] = setTimeout(tick, (ztPos[who]?.route?.length ? 1500 : 2500) + Math.random() * 1800);
  };
  ztWalkers[who] = setTimeout(tick, 400 + Math.random() * 1500);
}
function ztHop() { ztWalk("fruit", ".ztfruit"); }

document.addEventListener("click", async (e) => {
  const el = e.target.closest("[data-zt]");
  if (!el) return;
  if (el.dataset.zt === "close" && e.target.closest("[data-stop]") && !e.target.closest(".ztx")) return; // clicks inside the sheet
  const L = state.lu, a = el.dataset.zt;
  if (a === "view") { L.view = el.dataset.v; lsSet("mz-zt-view", L.view); render(); }
  else if (a === "sheet") { L.sheet = "tree"; render(); }
  else if (a === "soon") toast(`The ${el.dataset.v === "library" ? "Library" : "Calligraphy School"} is still closed. It opens soon!`);
  else if (a === "close") { L.sheet = null; render(); }
  else if (a === "cheer") {
    const b = el.querySelector(".ztbubble"); el.classList.add("talk");
    b.textContent = zh(ZT_CHEERS[Math.floor(Math.random() * ZT_CHEERS.length)]); b.hidden = false;
    setTimeout(() => { b.hidden = true; el.classList.remove("talk"); }, 1800);
  } else if (a === "water") {
    el.disabled = true;
    const row = { day: dayBack(1), kind: "water" };
    const { error } = await sb.from("learn_days").insert(row);
    if (error) { toast(/already used/.test(error.message) ? "You already used your watering can this month." : "Couldn't water your tree. Check your connection."); el.disabled = false; return; }
    L.days.push({ ...row, created_at: new Date().toISOString() });
    toast("Your tree is back! 💧"); render();
  } else if (a === "restart") { lsSet("mz-zt-restart", dayBack(1)); render(); }
  else if (a === "lv") { L.lv = el.dataset.v; lsSet("mz-zt-lv", L.lv); L.show = 300; L.word = null; render(); }
  else if (a === "tmap-zoom") L.tmapApi?.zoom(el.dataset.v);
  else if (a === "tmap-go") L.tmapApi?.go(el.dataset.v);
  else if (a === "more") { L.show += 600; render(); }
  else if (a === "word") { L.word = el.dataset.id ? +el.dataset.id : null; render(); }
  else if (a === "pick") { L.pick = L.pick ? null : new Set(); L.word = null; render(); }
  else if (a === "pick-all") {
    const ws = ztWordStatus(), words = L.hsk.get(L.lv) || [];
    L.pick = new Set(el.dataset.v === "all" ? words.filter((w) => statusOf(w, ws) !== "learned").map((w) => w.id) : []);
    render();
  }
  else if (a === "tick") { const id = +el.dataset.id; L.pick.has(id) ? L.pick.delete(id) : L.pick.add(id); keepForm(() => render()); }
  else if (a === "add-word" || a === "add-picked") {
    const words = L.lv === "map" ? HSK_LEVELS.flatMap((l) => L.hsk.get(l) || []) : L.hsk.get(L.lv) || [];
    const list = a === "add-word" ? words.filter((w) => w.id === +el.dataset.id) : words.filter((w) => L.pick.has(w.id));
    el.disabled = true;
    const n = await ztAddWords(list);
    if (a === "add-picked") L.pick = null;
    toast(n ? `Added ${n} word${n === 1 ? "" : "s"} to your flashcards.` : "Those words are already in your flashcards.");
    render();
  } else if (a === "add-level") {
    const words = L.hsk.get(L.lv) || [], have = new Set(L.cards.map((c) => c.hanzi));
    const left = words.filter((w) => !have.has(w.hanzi));
    if (left.length > 50 && !confirm(`Add ${left.length.toLocaleString()} HSK ${L.lv} words to your flashcards?\n\nThey'll come in a few at a time: ${L.perDay} new cards a day (you can change this in the Flashcard Center).`)) return;
    el.disabled = true; el.textContent = "Adding…";
    const n = await ztAddWords(left);
    toast(n ? `Added ${n.toLocaleString()} HSK ${L.lv} words to your flashcards.` : "They're already in your flashcards.");
    render();
  } else if (a === "know" || a === "know-picked" || a === "unknow") {
    const words = L.lv === "map" ? HSK_LEVELS.flatMap((l) => L.hsk.get(l) || []) : L.hsk.get(L.lv) || [];
    const list = a === "know-picked" ? words.filter((w) => L.pick.has(w.id)) : words.filter((w) => w.id === +el.dataset.id);
    el.disabled = true;
    const n = await ztMarkKnown(list, a !== "unknow");
    if (a === "know-picked") L.pick = null;
    if (n) toast(a === "unknow" ? "Back to learning. It'll come up in your reviews." : `Marked ${n} word${n === 1 ? "" : "s"} as learned.`);
    render();
  } else if (a === "start-all") ztStart("Review all", ztQueueAll());
  else if (a === "start-ses") {
    const cs = L.cards.filter((c) => c.session_id === el.dataset.id), s = ztSession(el.dataset.id), t = todayKey();
    const due = cs.filter((c) => c.reps === 0 || c.due <= t);
    ztStart(s?.title || "Session", due.length ? due : cs, !due.length);
  } else if (a === "start-lv") {
    const v = el.dataset.v, cs = L.cards.filter((c) => (v === "none" ? !c.hsk_level : c.hsk_level === v)), t = todayKey();
    const due = cs.filter((c) => c.reps === 0 || c.due <= t);
    ztStart(v === "none" ? "Words not in HSK" : `HSK ${v}`, due.length ? due : cs, !due.length);
  } else if (a === "flip") { if (L.review && !L.review.flipped) { L.review.flipped = true; render(); } }
  else if (a === "grade") await ztGrade(+el.dataset.v);
  else if (a === "end") { L.review = null; if (el.tagName !== "A") render(); }
  else if (a === "per") { L.perDay = Math.max(0, Math.min(50, L.perDay + +el.dataset.v * 5)); lsSet("mz-zt-new", String(L.perDay)); render(); }
});
document.addEventListener("keydown", (e) => {
  const R = state.lu.review;
  if (route() !== "learn" || !R || R.finished || e.target.closest("input, textarea, select")) return;
  if ((e.key === " " || e.key === "Enter") && !R.flipped) { e.preventDefault(); R.flipped = true; render(); }
  else if (R.flipped && ["1", "2", "3", "4"].includes(e.key)) { e.preventDefault(); ztGrade(+e.key - 1); }
});


// ---- Magical Forest (beta): members who opened the app in the last 24 hours --------------------
const ZT_FOREST = {
  phone: { w: 98, h: 178, c: [49, 103], r: [36, 38], sign: [2, 156], fish: [[66, 156, 16, 3, 9, 0], [78, 166, -14, -4, 11, -4], [84, 148, -10, 5, 8, -2]] },
  wide: { w: 196, h: 180, c: [98, 100], r: [72, 46], sign: [4, 158], fish: [[146, 158, 24, 4, 10, 0], [168, 148, -20, 6, 12, -5], [160, 170, 18, -5, 9, -2], [182, 162, -16, -3, 11, -7]] },
};
state.lu.forest = { list: null, loading: false, at: 0, sel: null, view: lsGet("mz-forest-view") || "forest", pos: new Map() };
async function forestLoad(force) {
  const F = state.lu.forest;
  if (F.loading || (!force && F.list && Date.now() - F.at < 120e3)) return;
  F.loading = true;
  const [{ data, error }, msgs] = await Promise.all([sb.rpc("forest_members"), sb.from("forest_messages").select("user_id, body, updated_at")]);
  F.msgs = new Map((msgs.data || []).map((m) => [m.user_id, m]));
  F.loading = false; F.at = Date.now();
  F.list = error ? [] : data;
  if (error) console.error(error);
  if (route() === "learn" && routeArg() === "forest") render();
}
function forestSpot(k, id, fresh) {
  const F = state.lu.forest, M = ZT_FOREST[k], key = k + id;
  if (!fresh && F.pos.has(key)) return F.pos.get(key);
  let best = null;
  for (let t = 0; t < 30; t++) { // a free spot inside the clearing, away from the others
    const a = Math.random() * 6.283, r = Math.sqrt(Math.random()) * 0.82;
    const p = [M.c[0] + Math.cos(a) * M.r[0] * r - 8, M.c[1] + Math.sin(a) * M.r[1] * r - 10];
    const near = [...F.pos.entries()].filter(([q]) => q.startsWith(k) && q !== key).some(([, o]) => Math.hypot(o[0] - p[0], o[1] - p[1]) < 15);
    best = p; if (!near) break;
  }
  F.pos.set(key, best);
  return best;
}
function forestWithMe(list) { // you always see yourself in the forest (hosts aren't in forest_members)
  if (!list) return [];
  if (list.some((m) => m.user_id === state.user.id)) return list;
  const me = state.me || {}, st = ztStreak();
  return [{ user_id: state.user.id, name: me.display_name, fruit: me.fruit, bg: me.bg, country: me.country, last_seen: new Date().toISOString(), streak: st.wilted ? 0 : st.n }, ...list];
}
const forestMember = (id) => forestWithMe(state.lu.forest.list).find((m) => m.user_id === id);
function forestMap(list) {
  const k = wide() ? "wide" : "phone", M = ZT_FOREST[k], F = state.lu.forest, pct = (x, w) => `${(x / w) * 100}%`;
  const at = (x, y) => `left:${pct(x, M.w)};top:${pct(y, M.h)}`;
  const fish = M.fish.map(([x, y, dx, dy, t, d]) => `<img class="px ztfish" src="icons/zt/fish.png" alt="" draggable="false" style="${at(x, y)};width:${pct(8, M.w)};--dx:${(dx / 8) * 100}%;--dy:${(dy / 4) * 100}%;animation-duration:${t}s;animation-delay:${d}s">`).join("");
  let bub = 0;
  const members = list.map((m) => {
    const [x, y] = forestSpot(k, m.user_id), me = m.user_id === state.user.id, f = ZT_FRUITS.has(m.fruit) ? m.fruit : "orange";
    const msg = F.msgs?.get(m.user_id), since = (Date.now() - (F.enterAt || 0)) / 1000, delay = (bub++) * 0.8 - since;
    const bubble = msg && delay > -6 ? `<span class="ztmsg" style="animation-delay:${delay.toFixed(2)}s" aria-hidden="true">${esc(msg.body)}</span>` : "";
    return `<button type="button" class="ztmem ${F.sel === m.user_id ? "sel" : ""} ${me ? "me" : ""}" data-zt="mem" data-id="${m.user_id}" data-k="${k}" style="${at(x, y)};width:${pct(16, M.w)}" aria-label="${esc(m.name || "Member")}${msg ? `: ${esc(msg.body)}` : ""}">${bubble}${ztImg("fruit-" + f)}<span class="ztmname">${esc((m.name || "Member").split(" ")[0])}${me ? " (you)" : ""}</span></button>`;
  }).join("");
  const [sx, sy] = M.sign;
  return `<div class="ztmap forest ${k}" style="aspect-ratio:${M.w}/${M.h}">
    ${ztImg(`forest4-${k}`, "ztbg")}${fish}
    ${nbForestSprite(k, M)}
    <a class="ztforestsign" href="#/learn" style="${at(sx + 4, sy - 1)};width:${pct(23, M.w)};height:${pct(9, M.h)};font-size:${((k === "wide" ? 2.35 : 1.85) / M.w) * 100}cqw" aria-label="Back to Zest Town">ZEST TOWN</a>
    ${members}
    ${list.some((m) => m.user_id !== state.user.id) ? "" : `<div class="ztempty">Nobody else has been here in the last 24 hours. Come back later!</div>`}
  </div>`;
}
function forestCard(m) {
  const p = { ...(state.profiles.get(m.user_id) || {}), id: m.user_id, fruit: m.fruit, bg: m.bg, country: m.country };
  const b = state.board.find((x) => x.user_id === m.user_id), st = ztStage(m.streak), n = state.stats.get(m.user_id) || 0;
  const me = m.user_id === state.user.id;
  return `<div class="card ztmcard">
    <div class="row" style="gap:12px;align-items:center">${avatar(p, 64)}
      <div class="grow"><div style="font-size:20px;font-weight:800">${esc(m.name || "Member")}${me ? " (you)" : ""}</div>
      <div class="small muted">${b ? `Level ${b.level} · ` : ""}here ${esc(ago(m.last_seen).toLowerCase())}</div></div>
      <button type="button" class="ztx" data-zt="mem" data-id="" aria-label="Close">×</button></div>
    <div class="ztmstats"><div class="ztmtree"><span class="zttreeart">${ztImg("tree-" + st)}</span><span><b class="ztleafn">${ZT_LEAF}${m.streak} day${m.streak === 1 ? "" : "s"}</b><br><span class="small muted">${esc(stageName(st))}</span></span></div>
      <div class="ztmses"><b>${n}</b><span class="small muted">session${n === 1 ? "" : "s"} joined</span></div></div>
    ${(() => { const msg = state.lu.forest.msgs?.get(m.user_id); return msg ? `<div class="ztmcardmsg"><span class="ztmq lzh">${esc(msg.body)}</span><span class="tiny muted">${esc(ago(msg.updated_at))}${isAdmin() && !me ? ` · <button type="button" class="linkbtn" data-zt="msgdel" data-id="${m.user_id}">Remove message</button>` : ""}</span></div>` : ""; })()}
    ${me ? "" : hongbaoGiveBlock(m.user_id) || `<p class="small muted" style="margin:0">Only members can send each other hongbaos.</p>`}
    <a class="small" style="font-weight:800;text-align:center" href="#/member/${m.user_id}">See ${esc((m.name || "their").split(" ")[0])}'s profile ›</a>
  </div>`;
}
function forestRows(list) {
  return list.map((m) => `<button type="button" class="ztfrow" data-zt="mem" data-id="${m.user_id}">${avatar({ ...(state.profiles.get(m.user_id) || {}), id: m.user_id, fruit: m.fruit, bg: m.bg }, 40, { flag: false })}
    <span class="grow"><b>${esc(m.name || "Member")}</b>${m.user_id === state.user.id ? " (you)" : ""}<br><span class="small muted">here ${esc(ago(m.last_seen).toLowerCase())}</span></span>
    <span class="ztleafn">${ZT_LEAF}${m.streak}</span></button>`).join("");
}
// Magical Forest → Club Discord (same link as "Chat on Discord").
const forestDiscord = () => `<a class="chatcard thin" style="display:flex" href="${DISCORD_CHAT}" target="_blank" rel="noopener">${ICON.chat}<b class="grow">Talk to the community on Discord</b><span aria-hidden="true">↗</span></a>`;
function forestView() {
  const F = state.lu.forest, st = ztStreak();
  forestLoad();
  const list = forestWithMe(F.list);
  const head = `${ztHeader(st, "Magical Forest <span class='zhsub'>魔法森林</span>")}
    <p class="muted small" style="margin:-6px 0 0">${F.list ? `${list.length} member${list.length === 1 ? "" : "s"} opened the app in the last 24 hours.` : "Looking around the forest…"} ${list.length ? (wide() ? "Click one to see their streak or send a hongbao." : "Tap one to say hi.") : ""}</p>`;
  if (!F.inForest) { F.inForest = true; F.enterAt = Date.now(); if (state.nb) state.nb.open = false; }
  const sel = F.sel && forestMember(F.sel);
  const toggle = `<div class="seg ztseg" role="group" aria-label="Show the forest as"><button type="button" data-zt="fview" data-v="forest" aria-pressed="${F.view !== "list"}">Forest</button><button type="button" data-zt="fview" data-v="list" aria-pressed="${F.view === "list"}">List</button></div>`;
  setTimeout(forestHop, 60);
  if (F.view === "list") return `${head}${toggle}${wide() && state.nb?.open ? nbSheet() : ""}${nbCard()}${forestMsgBox()}${forestDiscord()}<div class="card" style="gap:0;padding:4px 14px">${forestRows(list) || `<p class="small muted">Nobody yet today.</p>`}</div>${sel ? (wide() ? `<div style="max-width:420px">${forestCard(sel)}</div>` : `<div class="ztover" data-zt="mem" data-id=""><div class="ztsheet" data-stop>${forestCard(sel)}</div></div>`) : ""}`;
  if (wide()) return `${head}${toggle}<div class="ztwide">${forestMap(list)}<div class="ztside">${nbCard()}${forestDiscord()}${sel ? forestCard(sel) : `<div class="card"><p class="small muted" style="margin:0">Click a fruit to see their streak tree and send them a hongbao.</p></div>`}${forestMsgBox()}
    ${list.length ? `<div class="card" style="gap:0;padding:6px 14px"><b style="padding:6px 0">Here today · ${list.length}</b>${forestRows(list)}</div>` : ""}</div></div>${state.nb?.open ? nbSheet() : ""}`;
  return `${head}${toggle}${forestMap(list)}${nbCard()}${forestMsgBox()}${forestDiscord()}${sel ? `<div class="ztover" data-zt="mem" data-id=""><div class="ztsheet" data-stop>${forestCard(sel)}</div></div>` : ""}`;
}
// Your message in the forest: Chinese only (traditional or simplified), up to 30 characters. Shown over your fruit when people arrive.
const FOREST_MSG_OK = /^[\u3400-\u4dbf\u4e00-\u9fff\u3000-\u303f\uff01\uff08\uff09\uff0c\uff1a\uff1b\uff1f\uff5e\u2026\u2014\u00b7\u201c\u201d\u2018\u2019 ]+$/;
function forestMsgBox() {
  const F = state.lu.forest, mine = F.msgs?.get(state.user.id);
  if (!F.list) return "";
  if (mine && !F.editMsg) return `<div class="card ztmybox"><div class="row between" style="gap:10px;align-items:center;flex-wrap:wrap"><span class="grow"><span class="tiny muted">Your message in the forest</span><br><b class="ztmq lzh">${esc(mine.body)}</b></span>
    <span class="row" style="gap:8px"><button type="button" class="btn small ghost" data-zt="msgedit">Change</button><button type="button" class="linkbtn" data-zt="msgdel" data-id="${state.user.id}">Delete</button></span></div></div>`;
  return `<form class="card ztmybox" data-zt-form="msg"><label for="ztmsgin"><b>Leave a message ${trad() ? "留言" : "留言"}</b><br><span class="small muted">In Chinese only (traditional or simplified), up to 30 characters. Others see it over your fruit when they arrive.</span></label>
    <div class="row" style="gap:8px"><input id="ztmsgin" class="lzh" maxlength="30" autocomplete="off" placeholder="${trad() ? "大家好！今天也一起加油吧。" : "大家好！今天也一起加油吧。"}" value="${esc(F.draft ?? mine?.body ?? "")}"><button class="btn small" type="submit">${mine ? "Save" : "Post"}</button>${mine ? `<button type="button" class="linkbtn" data-zt="msgcancel">Cancel</button>` : ""}</div>
    <span class="tiny ztmsgerr" role="alert"></span></form>`;
}
async function forestMsgSave(text) {
  const F = state.lu.forest, body = text.trim().replace(/\s+/g, " "), err = document.querySelector(".ztmsgerr");
  const bad = (m) => { if (err) err.textContent = m; };
  if (!body) return bad("Write something first.");
  if (!FOREST_MSG_OK.test(body) || !/[\u3400-\u4dbf\u4e00-\u9fff]/.test(body)) return bad("Only Chinese characters and Chinese punctuation, please (no letters, pinyin or emoji).");
  if ([...body].length > 30) return bad("Up to 30 characters.");
  const { error } = await sb.from("forest_messages").upsert({ user_id: state.user.id, body, updated_at: new Date().toISOString() });
  if (error) return bad("Couldn't save it. Check your connection and try again.");
  F.msgs.set(state.user.id, { user_id: state.user.id, body, updated_at: new Date().toISOString() });
  F.editMsg = false; F.draft = null; F.enterAt = Date.now(); // show the bubbles again, with yours
  toast("Message posted in the forest."); render();
}
document.addEventListener("submit", (e) => {
  const f = e.target.closest("[data-zt-form='msg']"); if (!f) return;
  e.preventDefault(); forestMsgSave(f.querySelector("input").value);
});
document.addEventListener("input", (e) => { if (e.target.id === "ztmsgin") state.lu.forest.draft = e.target.value; });
window.addEventListener("hashchange", () => { if (!location.hash.startsWith("#/learn/forest")) state.lu.forest.inForest = false; });
let forestTimer = null;
function forestHop() {
  if (forestTimer || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  forestTimer = setInterval(() => {
    const els = [...document.querySelectorAll(".ztmem")];
    if (!els.length) { clearInterval(forestTimer); forestTimer = null; return; }
    const el = els[Math.floor(Math.random() * els.length)];
    if (el.classList.contains("sel")) return;
    const k = el.dataset.k, M = ZT_FOREST[k], old = state.lu.forest.pos.get(k + el.dataset.id);
    const [x, y] = forestSpot(k, el.dataset.id, true);
    el.classList.toggle("flip", old && x < old[0]); el.classList.add("hopping");
    el.style.left = `${(x / M.w) * 100}%`; el.style.top = `${(y / M.h) * 100}%`;
    setTimeout(() => el.classList.remove("hopping"), 1500);
  }, 1300);
}
document.addEventListener("click", async (e) => {
  const el = e.target.closest("[data-zt]");
  if (!el) return;
  const a = el.dataset.zt, F = state.lu.forest;
  if (a === "mem") {
    if (e.target.closest("[data-stop]") && !e.target.closest(".ztx") && el.classList.contains("ztover")) return;
    if (e.target.closest(".hbcard, a")) return;
    F.sel = el.dataset.id || null; render();
  } else if (a === "fview") { F.view = el.dataset.v; lsSet("mz-forest-view", F.view); render(); }
  else if (a === "msgedit") { F.editMsg = true; render(); setTimeout(() => document.getElementById("ztmsgin")?.focus(), 30); }
  else if (a === "msgcancel") { F.editMsg = false; F.draft = null; render(); }
  else if (a === "msgdel") {
    const id = el.dataset.id;
    const { error } = await sb.from("forest_messages").delete().eq("user_id", id);
    if (error) { toast("Couldn't remove it. Try again."); return; }
    F.msgs.delete(id); F.editMsg = false; toast("Message removed."); render();
  }
});


// ---- Word of the day (part of the Learning beta; shows for everyone once Learning is live) -------------
const SPEAK = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/></svg>';
async function wodLoad() {
  const day = todayKey();
  if (state.wodLoading || state.wod?.day === day) return;
  state.wodLoading = true;
  const { data, error } = await sb.rpc("word_of_day", { p_day: day });
  state.wodLoading = false;
  state.wod = { day, w: error ? null : data?.[0] || null };
  if (route() === "home") render();
}
function wodCard() {
  wodLoad();
  if (!state.lu.loaded) ztLoad();
  const w = state.wod?.w;
  if (!w) return "";
  const card = state.lu.cards.find((c) => c.hanzi === w.hanzi || (w.hanzi_trad && c.hanzi === w.hanzi_trad));
  const learned = ztKnown(card);
  const actions = !state.lu.loaded ? ""
    : learned ? `<div class="wodbtns"><span class="wodstate known">✓ Learned · dark green in the HSK Temple</span><button type="button" class="link small" data-wod="unknow">Undo</button></div>`
    : card ? `<div class="wodbtns"><span class="wodstate">✓ In your flashcards</span><button type="button" class="btn ghost small wodknow" data-wod="know">✓ I know this word</button></div>`
    : `<div class="wodbtns"><button type="button" class="btn green small" data-wod="add">＋ Add to flashcards</button><button type="button" class="btn ghost small wodknow" data-wod="know">✓ I know this word</button></div>`;
  return `<section class="card wod" aria-label="Word of the day">
    <div class="row" style="align-items:center;gap:8px"><span class="eyebrow grow" style="margin:0">Word of the day · ${trad() ? "每日一詞" : "每日一词"}</span><span class="hskchip">HSK ${esc(w.level)}</span></div>
    <div class="wodword"><span class="wodzh">${esc(wordZh(w))}</span><span class="wodpy">${esc(py(w.pinyin))}</span><button type="button" class="wodspeak" data-wod="say" aria-label="Listen">${SPEAK}</button></div>
    <div class="small">${esc(w.meaning)}${w.types ? ` <span class="muted">· ${esc(w.types)}</span>` : ""}</div>
    ${actions}
  </section>`;
}
document.addEventListener("click", async (e) => {
  const el = e.target.closest("[data-wod]");
  if (!el) return;
  const w = state.wod?.w; if (!w) return;
  const a = el.dataset.wod, word = { ...w, level: w.level };
  if (a === "say") {
    try { const u = new SpeechSynthesisUtterance(wordZh(w)); u.lang = trad() ? "zh-TW" : "zh-CN"; u.rate = 0.85; speechSynthesis.cancel(); speechSynthesis.speak(u); } catch { toast("Your browser can't read this word aloud."); }
    return;
  }
  el.disabled = true;
  if (a === "add") { const n = await ztAddWords([word]); if (n) toast("Added to your flashcards. It'll come up in today's review."); }
  else { const n = await ztMarkKnown([word], a === "know"); if (n) toast(a === "know" ? "Marked as learned in the HSK Temple." : "Back to learning."); }
  render();
});

document.addEventListener("click", (e) => { const a = e.target.closest("[data-scroll]"); if (a) state.scrollTo = a.dataset.scroll; }, true);

// ---- Stay up to date: an app left open in the background keeps running old code until it reloads.
// When the app comes back to the screen (or every 30 min), check the published version and reload if it changed,
// unless the member is in the middle of something (a review, a form, an open pop-up).
async function checkForUpdate() {
  try {
    const txt = await (await fetch("sw.js", { cache: "no-store" })).text();
    const live = (txt.match(/mz-club-v(\d+)/) || [])[1];
    if (!live || `v=${live}` === APP_BUILD) return;
    const busy = state.lu?.review || document.querySelector(".hbover, .ztover, form input:focus, textarea:focus") || state.noteDraft?.size;
    if (busy) return;
    // Install the new service worker first, then reload once (never loop if the update isn't ready yet).
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) { await reg.update().catch(() => {}); await new Promise((r) => setTimeout(r, 2500)); }
    if (sessionStorage.getItem("mz-reloaded") === live) return;
    sessionStorage.setItem("mz-reloaded", live);
    location.reload();
  } catch { /* offline or storage blocked: try again later */ }
}
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") checkForUpdate(); });
setInterval(checkForUpdate, 30 * 60e3);

// ---------------------------------------------------------------------------
// Library 圖書館 (Zest Town): digital workbooks. Beta: admins only (books.published = false).
// Books: library_books; texts: library_book_content (only for owners and admins); purchases: library_purchases;
// progress: library_progress. Bookshop = Stripe Checkout through the library-checkout function.
// Routes: #/learn/library · #/learn/library/<book> · #/learn/library/<book>/<ch|culture|grammar|ex|words>/<n>
// ---------------------------------------------------------------------------
const LIB_LEVELS = ["1", "2", "3", "4", "5", "6", "7-9"];
const libOpen = () => true; // live for everyone with Zest Town since 21 Nov 2026 (was admins only)
function libState() {
  if (!state.lib) state.lib = { books: null, owned: new Set(), content: new Map(), progress: new Map(), tab: "shelf", lv: lsGet("mz-lib-lv") || "", py: lsGet("mz-lib-py") === "on" ? "on" : "off" };
  return state.lib;
}
async function libLoad(force) {
  const S = libState();
  if (S.loading || (S.books && !force)) return;
  S.loading = true;
  const [b, p] = await Promise.all([sb.from("library_books").select("*").order("sort").order("level"), sb.from("library_purchases").select("book_id, source, created_at")]);
  S.loading = false;
  if (b.error) { S.error = true; render(); return; }
  S.books = b.data; S.owned = libWithFree((p.data || []).map((r) => r.book_id)); S.claimed = (p.data || []).some((r) => r.source === "claim");
  render();
  if (!S.checked) { S.checked = true; libVerify(); } // a payment finished after the app was closed still unlocks its book
}
const libHas = (id) => libState().owned.has(id) || isAdmin();
async function libContent(id) {
  const S = libState();
  if (S.content.has(id) || S.contentLoading === id) return;
  S.contentLoading = id;
  const [c, pr] = await Promise.all([sb.from("library_book_content").select("content").eq("book_id", id).maybeSingle(), sb.from("library_progress").select("state").eq("book_id", id).maybeSingle()]);
  S.contentLoading = null;
  if (c.error || !c.data) { toast("Couldn't open this book. Check your connection."); location.hash = "#/learn/library"; return; }
  try { S.content.set(id, await libUnpack(c.data.content)); } catch { toast("Couldn't open this book. Please update the app."); location.hash = "#/learn/library"; return; }
  S.progress.set(id, pr.data?.state || {});
  render();
}
// Stored compressed: {gz: base64 of gzipped {s: book, tmap: "简簡体體…"}}; the traditional version is made here, character by character.
const LIB_HOW = [
  "A graded reader is a story written at your level, so you can read Chinese as a whole piece, not as a series of exercises. It builds fluency and trains your eye to recognise words in context.",
  "Tap any word in the story to see its pinyin, meaning and HSK level, and add it to your flashcards. Turn pinyin on above the text if you need it. Each chapter ends with its new words and a quick check.",
  "Suggested method: first just read, without stopping. Then read again with the word list. Then read the dialogues aloud and give each character a voice.",
];
const LIB_FIXED = new Set(["bank", "choice", "order"]); // exercises with one right answer, checked by the app
async function libUnpack(c) {
  const fixed = (b) => { b.exercises = (b.exercises || []).filter((x) => LIB_FIXED.has(x.kind)); return b; };
  if (!c.gz) return { s: fixed(c.s), t: fixed(c.t) };
  const bytes = Uint8Array.from(atob(c.gz), (ch) => ch.charCodeAt(0));
  const { s, tmap } = await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"))).json();
  const m = new Map(); for (let i = 0; i < tmap.length; i += 2) m.set(tmap[i], tmap[i + 1]);
  const cv = (x) => x.replace(/[\u4e00-\u9fff]/g, (ch) => m.get(ch) || ch);
  const deep = (o) => typeof o === "string" ? cv(o) : Array.isArray(o) ? o.map(deep) : o && typeof o === "object" ? Object.fromEntries(Object.entries(o).map(([k, v]) => [cv(k), deep(v)])) : o;
  fixed(s); const t = deep(s);
  for (const k of Object.keys(s.dict)) t.dict[cv(k)].s = k;
  return { s, t };
}
const libBook = (id) => { const c = libState().content.get(id); return c && (trad() ? c.t : c.s); };
const libProg = (id) => libState().progress.get(id) || {};
let libSaveT = null;
const libChLabel = (c, i) => c.chapters[i]?.label || `第${LIB_NUM[c.chapters.slice(0, i).filter((x) => !x.label).length] || i + 1}章`;
const libChLabelEn = (c, i) => c.chapters[i]?.label_en || `Chapter ${c.chapters.slice(0, i).filter((x) => !x.label).length + 1}`;
const LIB_NUM = ["一", "二", "三", "四", "五", "六", "七", "八", "九", "十", "十一", "十二", "十三", "十四", "十五", "十六", "十七", "十八", "十九", "二十"];
function libSave(id) {
  clearTimeout(libSaveT);
  libSaveT = setTimeout(async () => {
    const { error } = await sb.from("library_progress").upsert({ user_id: state.user.id, book_id: id, state: libProg(id), updated_at: new Date().toISOString() });
    if (error) toast("Couldn't save your progress. Check your connection.");
  }, 800);
}
function libSet(id, path, val) {
  const P = libProg(id); let o = P; const keys = path.split(".");
  keys.slice(0, -1).forEach((k) => { o = o[k] = o[k] || {}; });
  o[keys[keys.length - 1]] = val; libState().progress.set(id, P); libSave(id);
}
const libGet = (id, path) => path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), libProg(id));
const money = (c, cur) => new Intl.NumberFormat("en-US", { style: "currency", currency: (cur || "usd").toUpperCase(), minimumFractionDigits: c % 100 ? 2 : 0 }).format(c / 100);
const hskTag = (l) => (l ? `HSK ${l}` : "");
function libParts(c) { // what's inside a book
  return [`${c.chapters.length} chapters`, c.culture?.length ? "culture notes" : "", c.grammar?.length ? `${c.grammar.length} grammar points` : "", c.exercises?.length ? `${c.exercises.length} exercises` : ""].filter(Boolean).join(" · ");
}
function libReadCount(id) { const r = libGet(id, "read") || {}; return Object.values(r).filter(Boolean).length; }

// ---- words: tap to see pinyin, meaning, HSK level; add to flashcards ----
function libTok(t, d, opts = {}) {
  const e = d[t];
  if (!e) return esc(t);
  const inner = opts.py === "on" && e.p ? `<ruby>${esc(t)}<rt>${esc(py(e.p))}</rt></ruby>` : esc(t);
  return `<span class="lw" data-lw="${esc(t)}" role="button" tabindex="0">${inner}</span>`;
}
const libLine = (toks, d, opts) => toks.map((t) => libTok(t, d, opts)).join("");
function libWordEntry(book, w) {
  const e = book.dict[w]; if (!e) return null;
  return { hanzi: e.s || w, hanzi_trad: trad() ? w : null, pinyin: e.p, meaning: e.m || (e.parts || []).map((x) => book.dict[x]?.m).filter(Boolean).join("; "), level: e.l || null };
}
const libInDeck = (book, w) => { const h = book.dict[w]?.s || w; return state.lu.cards.some((c) => c.hanzi === h); };
function libPopHtml(id, w) {
  const book = libBook(id), e = book?.dict[w]; if (!e) return "";
  const inDeck = libInDeck(book, w);
  const parts = (e.parts || []).map((x) => `<button type="button" class="lpart" data-lw="${esc(x)}"><b>${esc(x)}</b> <span>${esc(py(book.dict[x].p))}</span> ${esc(book.dict[x].m)}</button>`).join("");
  const tag = e.b ? `<span class="ltag book">In this book's word list</span>` : "";
  return `<div class="ztover lpopover" data-lib="popclose"><div class="ztsheet lpop" role="dialog" aria-label="${esc(w)}" data-stop>
    <button type="button" class="ztx" data-lib="popclose" aria-label="Close">×</button>
    <div class="lpophz">${esc(w)}</div>
    <div class="lpoppy">${esc(py(e.p))}</div>
    ${e.m ? `<div class="lpopm">${esc(e.m)}</div>` : ""}
    ${parts ? `<div class="lparts">${parts}</div>` : ""}
    <div class="row" style="gap:6px;flex-wrap:wrap">${e.l ? `<span class="ltag hsk">${hskTag(e.l)}</span>` : `<span class="ltag">Not in the HSK lists</span>`}${tag}</div>
    ${inDeck ? `<div class="lindeck">✓ In your flashcards</div>` : `<button type="button" class="btn" data-lib="addword" data-w="${esc(w)}">+ Add to flashcards</button>`}
    ${!e.l && !e.b && e.m ? `<p class="tiny muted" style="margin:0">Dictionary: CC-CEDICT</p>` : ""}
  </div></div>`;
}
function libShowPop(w) {
  const id = libState().open; document.querySelector(".lpopover")?.remove();
  const html = libPopHtml(id, w); if (html) app.insertAdjacentHTML("beforeend", html);
}

// ---- views ----
function libraryView(parts, q) {
  const S = libState();
  if (!libOpen()) { location.hash = "#/learn"; return townView(); }
  if (!S.books) { libLoad(); return `${ztHeader(null, libTitle())}<p class="muted small">${S.error ? "Couldn't load the Library. Try again later." : "Opening the Library…"}</p>`; }
  if (q.paid && S.verifying !== q.paid && !S.verified?.has(q.paid)) libVerify(q.paid);
  if (q.shop) { S.tab = "shop"; history.replaceState(null, "", "#/learn/library"); }
  const [id, sec, n] = parts;
  if (id) {
    const meta = S.books.find((b) => b.id === id);
    if (!meta) { location.hash = "#/learn/library"; return ""; }
    if (!libHas(id)) { S.tab = "shop"; location.hash = "#/learn/library"; return ""; }
    S.open = id;
    if (!libBook(id)) { libContent(id); return `${libHead(meta, true)}<p class="muted small">Opening the book…</p>`; }
    if (sec === "ch") return libChapterView(meta, +n || 0);
    if (sec === "culture") return libCultureView(meta);
    if (sec === "grammar") return libGrammarView(meta, +n || 0);
    if (sec === "ex") return libExerciseView(meta, +n || 0);
    if (sec === "words") return libWordsView(meta);
    return libBookView(meta);
  }
  return libHomeView();
}
const libTitle = () => `Library <span class='zhsub'>${trad() ? "圖書館" : "图书馆"}</span>`;
function libHomeView() {
  const S = libState(), shop = S.tab === "shop";
  const tabs = `<div class="seg ztseg" role="group" aria-label="Library"><button type="button" data-lib="tab" data-v="shelf" aria-pressed="${!shop}">My shelf</button><button type="button" data-lib="tab" data-v="shop" aria-pressed="${shop}">Bookshop</button></div>`;
  const beta = "";
  const owl = `<div class="lowlwrap"><button type="button" class="lowl" data-lib="owl" aria-label="Talk to the owl librarian"><span class="lowlpx" aria-hidden="true"></span></button><span class="lowltip">${trad() ? "館長" : "馆长"}</span></div>`;
  return `${ztHeader(ztStreak(), libTitle())}${beta}<div class="ltop"><div class="ltopl">${tabs}${libCounter()}</div>${owl}</div>${shop ? libShopView() : libShelfView()}`;
}
// A book's level can be one level ("3") or a range ("2-3"); it shows under every level it covers.
const libLvIn = (b, l) => { const [a, z = a] = String(b.level || "").split("-"); const n = (x) => (x === "7" || x === "7-9" ? 7 : +x); return n(l) >= n(a) && n(l) <= n(z); };
const libLv = (b) => `HSK ${esc(String(b.level || "").replace("-", "–"))}`;
function libCover(b, cls = "") {
  return `<span class="lcover ${cls}" style="--c:${esc(b.color || "#f37a48")}">${b.cover ? `<img src="${esc(b.cover)}" alt="" loading="lazy">` : `<b>${esc(b.title_zh || b.title)}</b>`}<span class="lhsk">${libLv(b)}</span></span>`;
}
function libShelfView() {
  const S = libState();
  const mine = S.books.filter((b) => libHas(b.id)), lv = S.lv;
  const shown = mine.filter((b) => !lv || libLvIn(b, lv));
  const chips = `<div class="lchips" role="group" aria-label="Filter by HSK level"><button type="button" data-lib="lv" data-v="" aria-pressed="${!lv}">All</button>${LIB_LEVELS.map((l) => {
    const n = mine.filter((b) => libLvIn(b, l)).length;
    return `<button type="button" data-lib="lv" data-v="${l}" aria-pressed="${lv === l}" ${n ? "" : "class=\"empty\""}>HSK ${l}</button>`; }).join("")}</div>`;
  const per = wide() ? 6 : 3, rows = [];
  for (let i = 0; i < Math.max(shown.length, 1); i += per) rows.push(shown.slice(i, i + per));
  if (rows.length < 2) rows.push([]);
  const book = (b) => { const c = S.content.get(b.id), total = c ? c.s.chapters.length : 0, read = libReadCount(b.id);
    return `<a class="lshelfbook" href="#/learn/library/${encodeURIComponent(b.id)}" aria-label="${esc(b.title)}">${libCover(b)}${read ? `<span class="lribbon">${read}${total ? `/${total}` : ""} read</span>` : ""}</a>`; };
  const shelf = `<div class="lshelf" style="--per:${per}">${rows.map((r) => `<div class="lrow">${r.map(book).join("")}</div>`).join("")}</div>`;
  const empty = !mine.length ? `<div class="card lempty"><b>Your shelf is empty</b><span class="small muted">Books you buy in the Bookshop appear here, ready to read in the app.</span><button type="button" class="btn" data-lib="tab" data-v="shop">Visit the Bookshop</button></div>`
    : !shown.length ? `<p class="small muted">No books for HSK ${esc(lv)} on your shelf yet. <button type="button" class="linkbtn" data-lib="tab" data-v="shop">See the Bookshop</button></p>` : "";
  return `${chips}${shelf}${empty}`;
}
function libCounter() {
  const S = libState(), total = S.books.length, have = S.books.filter((b) => S.owned.has(b.id)).length;
  return `<div class="lcount2"><span class="lcountn">${have}</span><span><b>${have === 1 ? "book" : "books"} collected</b><br><span class="small muted">${total > have ? `${total - have} more in the Bookshop` : `You have every book. ${trad() ? "太厲害了！" : "太厉害了！"}`}${isAdmin() && !have ? " · as an admin you can read them all" : ""}</span></span></div>`;
}
function libShopView() {
  const S = libState(), lv = S.lv, forSale = S.books.filter((b) => !S.owned.has(b.id)), books = forSale.filter((b) => !lv || libLvIn(b, lv)); // books you own are on your shelf, not in the shop
  const chips = `<div class="lchips" role="group" aria-label="Filter by HSK level"><button type="button" data-lib="lv" data-v="" aria-pressed="${!lv}">All</button>${LIB_LEVELS.map((l) => `<button type="button" data-lib="lv" data-v="${l}" aria-pressed="${lv === l}" ${forSale.some((b) => libLvIn(b, l)) ? "" : "class=\"empty\""}>HSK ${l}</button>`).join("")}</div>`;
  const canClaim = !S.claimed && forSale.some((b) => b.price_cents > 0);
  const card = (b) => {
    const bought = S.owned.has(b.id);
    const btn = bought ? `<a class="btn ghost" href="#/learn/library/${encodeURIComponent(b.id)}">${b.price_cents ? "Owned" : "Free"} · Read</a>`
      : `${canClaim ? `<button type="button" class="btn lclaim" data-lib="claim" data-id="${esc(b.id)}" ${S.claiming ? "disabled" : ""}>${S.claiming === b.id ? "Claiming…" : S.claimAsk === b.id ? "Tap again to confirm" : "🎁 Claim for free"}</button>` : ""}<button type="button" class="btn${canClaim ? " ghost" : ""}" data-lib="buy" data-id="${esc(b.id)}" ${S.buying ? "disabled" : ""}>${S.buying === b.id ? "Opening…" : `Buy · ${money(b.price_cents, b.currency)}`}</button>${isAdmin() ? `<a class="small" href="#/learn/library/${encodeURIComponent(b.id)}">Read (admin access)</a>` : ""}`;
    return `<div class="card lshop">${libCover(b, "sm")}<div class="grow" style="display:flex;flex-direction:column;gap:6px;min-width:0">
      <div><span class="ltag hsk">${libLv(b)}</span>${b.published ? "" : ` <span class="ltag">Beta</span>`}</div>
      <b class="lshopt">${esc(b.title_zh || "")} <span>${esc(b.title)}</span></b>
      <span class="small muted">${esc(b.subtitle || "")}</span>
      <span class="small">${esc(b.summary || "")}</span>
      <div class="row" style="gap:10px;align-items:center;flex-wrap:wrap;margin-top:4px">${btn}</div></div></div>`;
  };
  const gift = canClaim ? `<div class="card lgift"><span class="lgiftic" aria-hidden="true">🎁</span><span><b>One book free for Club members</b><br><span class="small">Pick any book you like and tap “Claim for free”. It's yours to keep, on all your devices. You can claim one book.</span></span></div>` : "";
  return `${chips}${gift}<p class="small muted" style="margin:0">Buy once, keep it forever. Each book opens in the app right after payment, on all your devices.</p>
    <div class="lshoplist">${books.map(card).join("") || (forSale.length ? `<p class="small muted">No more books for HSK ${esc(lv)} yet. More are coming.</p>` : `<p class="small muted">You have every book in the shop. More are coming.</p>`)}</div>`;
}
function libHead(meta, back, crumb) {
  return `<header class="zthead lhead"><a class="ztback" href="${back === true ? "#/learn/library" : back}">‹ ${back === true ? "Library" : esc(crumb || meta.title_zh || meta.title)}</a></header>`;
}
function libBookView(meta) {
  const id = meta.id, c = libBook(id), read = libGet(id, "read") || {}, nRead = libReadCount(id);
  const exDone = (i) => libExScore(id, i, c.exercises[i]);
  const row = (href, label, sub, done) => `<a class="lrowlink" href="${href}"><span class="ltick ${done ? "on" : ""}" aria-hidden="true">${done ? "✓" : ""}</span><span class="grow"><b>${label}</b>${sub ? `<br><span class="small muted">${sub}</span>` : ""}</span><span class="chev" aria-hidden="true">›</span></a>`;
  const base = `#/learn/library/${encodeURIComponent(id)}`;
  const how = ""; // "How this book works" starts closed
  let partN = 0; const part = () => ++partN; // sections are numbered by what the book has (graded readers have no exercises)
  return `${libHead(meta, true)}
    <div class="lbookhead">${libCover(meta, "big")}<div class="grow" style="min-width:0">
      <span class="ltag hsk">${libLv(meta)}</span>
      <h1 class="lbt">${esc(meta.title_zh)}</h1><div class="lbs">${esc(meta.title)}</div>
      <div class="small muted">${libParts(c)}</div>
      <div class="lprog"><i style="width:${(nRead / c.chapters.length) * 100}%"></i></div><span class="small">${nRead} of ${c.chapters.length} chapters read</span>
      ${nRead < c.chapters.length ? `<a class="btn" href="${base}/ch/${c.chapters.findIndex((_, i) => !read[i])}">${nRead ? "Continue reading" : "Start reading"}</a>` : (c.exercises?.length ? `<a class="btn ghost" href="${base}/ex/0">Practise with the exercises</a>` : `<a class="btn ghost" href="${base}/ch/0">Read it again</a>`)}
    </div></div>
    <details class="card lhow"${how} data-lib-how="${esc(id)}"><summary><b>How this book works</b></summary>${(c.how?.length ? c.how : LIB_HOW).map((p) => `<p class="small">${esc(zhuyin() ? p.replace(/\bpinyin\b/g, "zhuyin").replace(/\bPinyin\b/g, "Zhuyin") : p)}</p>`).join("")}</details>
    ${c.chars?.length ? "" : "<!--"}<section class="lsec"><h2>Meet the characters <span class="zhsub">人物</span></h2><div class="lchars">${(c.chars || []).map((ch) => `<div class="lchar"><img src="icons/books/${esc(id)}-${esc(ch.key)}.png" alt=""><b>${esc(ch.zh)}${ch.py ? ` <span class="small muted">${esc(py(ch.py))}</span>` : ""}</b><span class="small muted">${esc(ch.desc)}</span></div>`).join("")}</div></section>${c.chars?.length ? "" : "-->"}
    <section class="lsec"><h2>Part ${part()} · The story</h2><div class="card llist">${c.chapters.map((ch, i) => row(`${base}/ch/${i}`, `<span class="lzh">${esc(libChLabel(c, i))} ${esc(ch.zh)}</span>`, `${esc(ch.en)} · about ${ch.mins} min · ${ch.words.length} new words`, read[i])).join("")}</div></section>
    ${c.culture?.length ? `<section class="lsec"><h2>Part ${part()} · Cultural background</h2><div class="card llist">${row(`${base}/culture`, libCtitle(c, id), c.culture.map((s) => esc(s.h)).join(" · "), libGet(id, "cultureSeen"))}</div></section>` : ""}
    ${c.grammar?.length ? "" : "<!--"}<section class="lsec"><h2>Part ${c.grammar?.length ? part() : 0} · Grammar</h2><div class="card llist">${c.grammar.map((g, i) => row(`${base}/grammar/${i}`, `${i + 1}. ${esc(g.title)}`, esc(g.pattern), libGet(id, `gram.${i}`))).join("")}</div></section>${c.grammar?.length ? "" : "-->"}
    ${c.exercises?.length ? "" : "<!--"}<section class="lsec"><h2>Part ${c.exercises?.length ? part() : 0} · Exercises</h2><div class="card llist">${c.exercises.map((x, i) => { const s = exDone(i); return row(`${base}/ex/${i}`, `${i + 1}. ${esc(x.zh)} <span class="muted">${esc(x.en)}</span>`, s.text, s.done); }).join("")}</div>${c.exercises?.length ? "" : "-->"}</section>
    <section class="lsec"><h2>Word list</h2><div class="card llist">${row(`${base}/words`, `All ${c.chapters.reduce((n, ch) => n + ch.words.length, 0)} new words`, "By chapter, with pinyin and meaning. Add them to your flashcards.", false)}</div></section>`;
}
function libPager(base, sec, i, n, labels) {
  const prev = i > 0 ? `<a class="btn ghost" href="${base}/${sec}/${i - 1}">‹ ${labels(i - 1)}</a>` : `<span></span>`;
  const next = i < n - 1 ? `<a class="btn ghost" href="${base}/${sec}/${i + 1}">${labels(i + 1)} ›</a>` : `<a class="btn ghost" href="${base}">Contents</a>`;
  return `<div class="lpager">${prev}${next}</div>`;
}
function libPyToggle() {
  const v = libState().py;
  return `<div class="lpyseg" role="group" aria-label="${zhuyin() ? "Zhuyin" : "Pinyin"} above words"><span class="small muted">${zhuyin() ? "Zhuyin" : "Pinyin"}</span>${[["on", "On"], ["off", "Off"]].map(([k, l]) => `<button type="button" data-lib="py" data-v="${k}" aria-pressed="${v === k}">${l}</button>`).join("")}</div>`;
}
function libChapterView(meta, i) {
  const id = meta.id, c = libBook(id), ch = c.chapters[i]; if (!ch) { location.hash = `#/learn/library/${id}`; return ""; }
  const base = `#/learn/library/${encodeURIComponent(id)}`, py = libState().py;
  const text = ch.paras.map((p) => `<p>${libLine(p, c.dict, { py })}</p>`).join("");
  const words = ch.words.map((w) => libWordRow(c, w)).join("");
  const notIn = ch.words.filter((w) => !libInDeck(c, w)).length;
  const check = ch.check.map((q, k) => {
    const ans = libGet(id, `qc.${i}.${k}`), done = ans !== undefined, ok = done && ans === q.a;
    return `<div class="lqc ${done ? (ok ? "ok" : "bad") : ""}"><span class="lqn">${k + 1}</span><span class="grow lzh">${libLine(q.q, c.dict, {})}</span>
      <span class="lqbtns">${[[true, trad() ? "對" : "对"], [false, trad() ? "錯" : "错"]].map(([v, l]) => `<button type="button" data-lib="qc" data-ch="${i}" data-k="${k}" data-v="${v}" aria-pressed="${ans === v}" ${done ? "disabled" : ""}>${l}</button>`).join("")}</span>
      ${done ? `<span class="lqres">${ok ? "✓ Right" : `✗ It's ${q.a ? (trad() ? "對" : "对") : (trad() ? "錯" : "错")}`}</span>` : ""}</div>`;
  }).join("");
  const read = libGet(id, `read.${i}`);
  return `${libHead(meta, base, meta.title_zh)}
    <article class="lread">
      <div class="lchlabel">${esc(libChLabel(c, i))} · ${esc(libChLabelEn(c, i))}</div>
      <h1 class="lcht">${esc(ch.zh)}</h1><div class="lchs">${esc(ch.en)}</div>
      <div class="small muted">⏱ about ${ch.mins} min · ${ch.words.length} new words · tap any word for its meaning</div>
      ${libPyToggle()}
      <div class="ltext lzh">${text}</div>
    </article>
    ${ch.words.length ? `<section class="lsec"><div class="row between" style="align-items:center;gap:8px;flex-wrap:wrap"><h2 style="margin:0">New words <span class="zhsub">${trad() ? "生詞" : "生词"}</span></h2>${notIn ? `<button type="button" class="btn small" data-lib="addall" data-ch="${i}">+ Add all ${notIn} to flashcards</button>` : `<span class="small lindeck">✓ All in your flashcards</span>`}</div>
      <div class="card llist">${words}</div></section>` : ""}
    ${ch.check.length ? `<section class="lsec"><h2>Quick check <span class="zhsub">${trad() ? "對還是錯？" : "对还是错？"}</span></h2><div class="lqcs">${check}</div></section>` : ""}
    <div class="lreaddone">${read ? `<span class="lindeck">✓ Chapter read</span>` : `<button type="button" class="btn" data-lib="read" data-ch="${i}">✓ I've read this chapter</button>`}</div>
    ${libPager(base, "ch", i, c.chapters.length, (k) => libChLabelEn(c, k))}`;
}
function libWordRow(c, w) {
  const e = c.dict[w] || {}, inDeck = libInDeck(c, w);
  return `<div class="lwrow"><button type="button" class="lwmain" data-lw="${esc(w)}"><b class="lzh">${esc(w)}</b><span class="lwpy">${esc(py(e.p || ""))}</span><span class="lwm">${esc(e.m || "")}</span></button>
    ${e.l ? `<span class="ltag hsk">HSK ${esc(e.l)}</span>` : ""}
    ${inDeck ? `<span class="lwin" title="In your flashcards">✓</span>` : `<button type="button" class="lwadd" data-lib="addword" data-w="${esc(w)}" aria-label="Add ${esc(w)} to flashcards">+</button>`}</div>`;
}
function libCultureView(meta) {
  const id = meta.id, c = libBook(id), d = c.dict;
  if (!libGet(id, "cultureSeen")) libSet(id, "cultureSeen", true);
  const para = (segs) => segs.map((s) => typeof s === "string" ? esc(s) : s.t ? libTok(s.t, d) : `<button type="button" class="lchip" data-lw="${esc(s.w)}"><span class="lzh">${esc(s.w)}</span> <i>${esc(py(s.p))}</i></button>`).join("");
  return `${libHead(meta, `#/learn/library/${encodeURIComponent(id)}`, meta.title_zh)}
    <article class="lread"><div class="lchlabel">文化背景 · Culture</div><h1 class="lcht" style="font-size:26px">${esc(libCtitle(c, id))}</h1>
    <div class="small muted">${c.culture.some((s) => s.paras.some((p) => p.some((x) => x && x.t))) ? "Tap any word to see it and add it to your flashcards." : "In English, with the key Chinese words. Tap a word to see it and add it to your flashcards."}</div>
    ${c.culture.map((s) => `<h2 class="lculth">${esc(s.h)} <span class="zhsub lzh">${esc(s.zh)}</span></h2>${s.paras.map((p) => `<p class="lcult">${para(p)}</p>`).join("")}`).join("")}</article>
    ${c.keep?.length ? `<section class="lsec"><h2>Words to keep from this section</h2><div class="card llist">${c.keep.map((w) => libWordRow(c, w)).join("")}</div></section>` : ""}`;
}
function libGrammarView(meta, i) {
  const id = meta.id, c = libBook(id), g = c.grammar[i]; if (!g) { location.hash = `#/learn/library/${id}`; return ""; }
  if (!libGet(id, `gram.${i}`)) libSet(id, `gram.${i}`, true);
  const base = `#/learn/library/${encodeURIComponent(id)}`;
  return `${libHead(meta, base, meta.title_zh)}
    <article class="lread"><div class="lchlabel">${trad() ? "語法" : "语法"} ${i + 1} · Grammar</div><h1 class="lcht" style="font-size:26px">${esc(g.title)}</h1>
      <div class="lpattern lzh">${esc(g.pattern)}</div><p>${esc(g.explain)}</p>
      <div class="lexs">${g.ex.map((x) => `<div class="lex"><div class="lzh lexzh">${libLine(x.zh, c.dict, {})}</div><div class="lexpy">${esc(py(x.py))}</div><div class="small">${esc(x.en)}</div>${x.ch ? `<a class="ltag" href="${base}/ch/${x.ch - 1}">Ch. ${x.ch}</a>` : ""}</div>`).join("")}</div>
    </article>
    ${libPager(base, "grammar", i, c.grammar.length, (k) => `Grammar ${k + 1}`)}`;
}
const libNorm = (s) => String(s || "").replace(/[\s，。！？、,.!?：:；;“”"'‘’（）()…—\-]/g, "");
// Model answers in both scripts, so a sentence typed in simplified also counts when reading in traditional (and back).
function libAlt(id, i) {
  const c = libState().content.get(id), o = c && (trad() ? c.s : c.t), x = libBook(id).exercises[i];
  if ((x.kind === "write" || x.kind === "order") && o) x.items.forEach((it, k) => { const oa = o.exercises[i]?.items[k]?.a; it.alt = Array.isArray(oa) ? oa : oa ? [oa] : []; });
  return x;
}
function libExScore(id, i, x) {
  x = libAlt(id, i);
  const A = libGet(id, `ex.${i}`) || {};
  if (x.kind === "essay") { const t = A.text || ""; const n = (t.match(/[一-鿿]/g) || []).length; return { done: n >= 80, text: n ? `${n} characters written` : "Writing task" }; }
  const n = x.items.length, ans = A.a || {};
  if (x.kind === "open") { const k = Object.values(ans).filter((v) => String(v).trim()).length; return { done: k === n, text: `${k} of ${n} answered` }; }
  const right = x.items.filter((it, k) => libExRight(x, it, ans[k])).length, tried = Object.keys(ans).length;
  return { done: right === n, text: tried ? `${right} of ${n} right` : `${n} question${n === 1 ? "" : "s"}` };
}
const libCtitle = (c, id) => c.ctitle || (id === "mz-partner" ? "China's population, marriage pressure and dating culture" : "Culture notes");
function libShuffle(arr, seed) { // same order every time for one question, never the right order
  let h = 0; for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const out = [...arr]; for (let i = out.length - 1; i > 0; i--) { h = (h * 1103515245 + 12345) >>> 0; const j = h % (i + 1); [out[i], out[j]] = [out[j], out[i]]; }
  if (out.every((v, i) => v === i) && out.length > 1) out.push(out.shift());
  return out;
}
function libExRight(x, it, a) {
  if (a === undefined || a === null || a === "") return false;
  if (x.kind === "bank") return a === it.a || (it.alt || []).includes(a);
  if (x.kind === "order") return Array.isArray(a) && a.length === it.tiles.length && [it.a, ...(it.alt || [])].some((m) => libNorm(m) === libNorm(a.map((j) => it.tiles[j]).join("")));
  if (x.kind === "choice") return +a === it.a;
  if (x.kind === "write") return a === true || [...it.a, ...(it.alt || [])].some((m) => libNorm(m) === libNorm(a));
  return false;
}
function libBlanks(q, fill) { // "___" -> blank chips
  let k = 0;
  return esc(q).split("___").map((part, j, arr) => part + (j < arr.length - 1 ? fill(k++) : "")).join("");
}
function libExerciseView(meta, i) {
  const id = meta.id, c = libBook(id), x = c.exercises[i] && libAlt(id, i); if (!x) { location.hash = `#/learn/library/${id}`; return ""; }
  const base = `#/learn/library/${encodeURIComponent(id)}`, A = libGet(id, `ex.${i}`) || {}, ans = A.a || {}, shown = A.show || {};
  let body = "";
  if (x.kind === "open") body = x.items.map((it, k) => `<div class="card lexi"><div class="lexq"><span class="lqn">${k + 1}</span><span class="lzh">${libLine(it.q, c.dict, {})}</span></div>
      <textarea class="lin lzh" rows="2" data-libin="${i}.${k}" placeholder="Your answer in Chinese">${esc(ans[k] || "")}</textarea>
      ${shown[k] ? `<div class="lmodel"><span class="tiny muted">Sample answer</span><div class="lzh">${esc(it.a)}</div></div>` : `<button type="button" class="linkbtn" data-lib="show" data-ex="${i}" data-k="${k}">Show a sample answer</button>`}</div>`).join("");
  if (x.kind === "bank") {
    const used = new Set(x.reuse ? [] : Object.values(ans)), sel = libState().blank;
    body = `<div class="lbank" role="group" aria-label="Word box">${x.bank.map((w) => `<button type="button" class="lbankw lzh" data-lib="bankw" data-ex="${i}" data-w="${esc(w)}" ${used.has(w) ? "data-used" : ""}>${esc(w)}</button>`).join("")}</div>
      <p class="tiny muted" style="margin:0">${sel?.ex === i ? `Now tap a word for blank ${sel.k + 1}.` : "Tap a blank, then a word."}</p>`
      + x.items.map((it, k) => { const a = ans[k], ok = a && a === it.a, on = sel?.ex === i && sel.k === k;
        return `<div class="card lexi ${a ? (ok ? "ok" : "bad") : ""}"><div class="lexq"><span class="lqn">${k + 1}</span><span class="lzh">${libBlanks(it.q, () => `<button type="button" class="lblank ${on ? "on" : ""}" data-lib="blank" data-ex="${i}" data-k="${k}">${a ? esc(a) : "＿＿"}</button>`)}</span></div>${a && !ok ? `<span class="tiny lbadtxt">Not quite. Tap the blank to try another word.</span>` : ""}</div>`; }).join("");
  }
  if (x.kind === "choice") body = x.items.map((it, k) => { const a = ans[k], done = a !== undefined, ok = done && +a === it.a;
    const pair = x.options[it.a].split("……"), fill = (j) => `<span class="lblank ${ok ? "filled" : ""}">${ok ? esc(pair[j] || "") : "＿＿"}</span>`;
    return `<div class="card lexi ${done ? (ok ? "ok" : "bad") : ""}"><div class="lexq"><span class="lqn">${k + 1}</span><span class="lzh">${libBlanks(it.q, fill)}</span></div>
      <div class="lopts">${x.options.map((o, j) => `<button type="button" class="lzh" data-lib="choice" data-ex="${i}" data-k="${k}" data-v="${j}" aria-pressed="${done && +a === j}" ${ok ? "disabled" : ""}>${esc(o)}</button>`).join("")}</div>
      ${done && !ok ? `<span class="tiny lbadtxt">Not quite, try ${x.options.length > 2 ? "another" : "the other"} one.</span>` : ""}</div>`; }).join("");
  if (x.kind === "order") body = x.items.map((it, k) => { // tap the word tiles in order to build the sentence
    const a = Array.isArray(ans[k]) ? ans[k] : [], full = a.length === it.tiles.length, ok = full && libExRight(x, it, a);
    const left = libShuffle(it.tiles.map((t, j) => j), `${i}.${k}`).filter((j) => !a.includes(j));
    return `<div class="card lexi ${full ? (ok ? "ok" : "bad") : ""}"><div class="lexq"><span class="lqn">${k + 1}</span>
      <span class="lorderline lzh">${a.map((j, p) => `<button type="button" class="ltile on" data-lib="untile" data-ex="${i}" data-k="${k}" data-p="${p}" ${ok ? "disabled" : ""}>${esc(it.tiles[j])}</button>`).join("") || `<span class="tiny muted">Tap the words below in order</span>`}</span></div>
      ${ok ? `<div class="lmodel ok">✓ <span class="lzh">${esc(it.a)}</span></div>` : `<div class="ltiles">${left.map((j) => `<button type="button" class="ltile lzh" data-lib="tile" data-ex="${i}" data-k="${k}" data-j="${j}">${esc(it.tiles[j])}</button>`).join("")}</div>`}
      ${full && !ok ? `<span class="tiny lbadtxt">Not quite. Tap a word in your sentence to take it back.</span>` : ""}</div>`; }).join("");
  if (x.kind === "write") body = x.items.map((it, k) => { const a = ans[k], ok = libExRight(x, it, a), checked = shown[k];
    return `<div class="card lexi ${checked ? (ok ? "ok" : "") : ""}"><div class="lexq"><span class="lqn">${k + 1}</span><span class="${typeof it.q === "string" ? "" : "lzh"}">${typeof it.q === "string" ? esc(it.q) : libLine(it.q, c.dict, {})}</span>${it.hint ? `<span class="ltag">${esc(it.hint)}</span>` : ""}</div>
      <textarea class="lin lzh" rows="${x.zh === "比较句" || x.zh === "比較句" ? 2 : 1}" data-libin="${i}.${k}" placeholder="Write your sentence">${esc(a === true ? "" : a || "")}</textarea>
      ${checked ? (ok ? `<div class="lmodel ok">✓ Well done!${it.a.filter((m) => libNorm(m) !== libNorm(a)).length ? ` Also possible: <span class="lzh">${it.a.filter((m) => libNorm(m) !== libNorm(a)).map(esc).join(" / ")}</span>` : ""}</div>`
        : `<div class="lmodel"><span class="tiny muted">Model answer${it.a.length > 1 ? "s" : ""}</span>${it.a.map((m) => `<div class="lzh">${esc(m)}</div>`).join("")}<button type="button" class="linkbtn" data-lib="selfok" data-ex="${i}" data-k="${k}">Mine says the same thing ✓</button></div>`)
        : `<button type="button" class="btn small ghost" data-lib="check" data-ex="${i}" data-k="${k}">Check</button>`}</div>`; }).join("");
  if (x.kind === "essay") {
    const t = A.text || "", n = (t.match(/[一-鿿]/g) || []).length, task = A.task || "A";
    body = `<div class="ltasks">${x.tasks.map(([k, en, q]) => `<button type="button" class="card ltask" data-lib="task" data-ex="${i}" data-v="${k}" aria-pressed="${task === k}"><b>${k} · ${esc(en)}</b><span class="lzh small">${esc(q)}</span></button>`).join("")}</div>
      <textarea class="lin lzh lessay" rows="8" data-libin="${i}.text" placeholder="写 80–150 个字…">${esc(t)}</textarea>
      <div class="row between small" style="gap:8px;flex-wrap:wrap"><span class="lcount ${n > 150 ? "over" : ""}">${n} / 150 characters</span><span class="muted">Saved automatically</span></div>
      <div class="lchecklist">${libEssayChecks(t)}</div>`;
  }
  const s = libExScore(id, i, x);
  return `${libHead(meta, base, meta.title_zh)}
    <article class="lread"><div class="lchlabel">${trad() ? "練習" : "练习"} ${i + 1} · Exercise</div><h1 class="lcht" style="font-size:26px"><span class="lzh">${esc(x.zh)}</span> <span class="lchs" style="display:inline">${esc(x.en)}</span></h1>
      <p class="small muted" style="margin:0">${esc(x.how)}</p></article>
    <div class="lexlist">${body}</div>
    ${x.kind !== "essay" && x.kind !== "open" ? `<div class="lscore ${s.done ? "ok" : ""}">${s.text}${s.done ? " · 太棒了！" : ""}${Object.keys(ans).length ? ` <button type="button" class="linkbtn" data-lib="reset" data-ex="${i}">Start again</button>` : ""}</div>` : ""}
    ${libPager(base, "ex", i, c.exercises.length, (k) => `Exercise ${k + 1}`)}`;
}
function libEssayChecks(t) {
  const n = (t.match(/[一-鿿]/g) || []).length;
  const has = { bi: /比/.test(t), pair: /(虽然|雖然)[^。！？]*但是|(因为|因為)[^。！？]*所以/.test(t), ruguo: /如果[^。！？]*就/.test(t), de: /(?<![觉覺记記懂获獲值显顯使])得(很|不|非常|太|真|特别|特別|更|好|快|慢|挺|比较|比較|越)/.test(t), len: n >= 80 };
  const chk = [["bi", "比"], ["pair", trad() ? "雖然……但是 / 因為……所以" : "虽然……但是 / 因为……所以"], ["ruguo", "如果……就"], ["de", "得"], ["len", "80+ characters"]];
  return chk.map(([k, l]) => `<span class="${has[k] ? "on" : ""}">${has[k] ? "✓" : "○"} <span class="lzh">${esc(l)}</span></span>`).join("");
}
function libWordsView(meta) {
  const id = meta.id, c = libBook(id), all = c.chapters.flatMap((ch) => ch.words), notIn = all.filter((w) => !libInDeck(c, w)).length;
  return `${libHead(meta, `#/learn/library/${encodeURIComponent(id)}`, meta.title_zh)}
    <div class="row between" style="align-items:center;gap:8px;flex-wrap:wrap"><h1 style="margin:0;font-size:26px">Word list <span class="zhsub">${trad() ? "詞彙總表" : "词汇总表"}</span></h1>${notIn ? `<button type="button" class="btn small" data-lib="addall" data-ch="all">+ Add all ${notIn} to flashcards</button>` : `<span class="small lindeck">✓ All in your flashcards</span>`}</div>
    <p class="small muted" style="margin:0">All ${all.length} new words, in story order. New cards arrive in the Flashcard Center a few a day.</p>
    ${c.chapters.map((ch, i) => `<section class="lsec"><h2>${esc(libChLabelEn(c, i))} · <span class="lzh">${esc(ch.zh)}</span></h2><div class="card llist">${ch.words.map((w) => libWordRow(c, w)).join("")}</div></section>`).join("")}`;
}

// ---- the owl librarian: tap for a line from the Analects 論語, tap again to close it ----
const OWL_QUOTES = [
  ["学而时习之，不亦说乎？", "學而時習之，不亦說乎？", "Xué ér shí xí zhī, bú yì yuè hū?", "Is it not a joy to learn and to practise what you have learned?", "1.1"],
  ["温故而知新，可以为师矣。", "溫故而知新，可以為師矣。", "Wēn gù ér zhī xīn, kěyǐ wéi shī yǐ.", "Review the old to discover the new, and you can teach others.", "2.11"],
  ["学而不思则罔，思而不学则殆。", "學而不思則罔，思而不學則殆。", "Xué ér bù sī zé wǎng, sī ér bù xué zé dài.", "Learning without thinking is lost; thinking without learning is dangerous.", "2.15"],
  ["知之为知之，不知为不知，是知也。", "知之為知之，不知為不知，是知也。", "Zhī zhī wéi zhī zhī, bù zhī wéi bù zhī, shì zhī yě.", "To know what you know and admit what you don't: that is knowledge.", "2.17"],
  ["敏而好学，不耻下问。", "敏而好學，不恥下問。", "Mǐn ér hào xué, bù chǐ xià wèn.", "Quick and eager to learn, never ashamed to ask.", "5.15"],
  ["知之者不如好之者，好之者不如乐之者。", "知之者不如好之者，好之者不如樂之者。", "Zhī zhī zhě bùrú hào zhī zhě, hào zhī zhě bùrú lè zhī zhě.", "Knowing it is not as good as loving it; loving it is not as good as enjoying it.", "6.20"],
  ["三人行，必有我师焉。", "三人行，必有我師焉。", "Sān rén xíng, bì yǒu wǒ shī yān.", "When three walk together, one of them can be my teacher.", "7.22"],
  ["学如不及，犹恐失之。", "學如不及，猶恐失之。", "Xué rú bù jí, yóu kǒng shī zhī.", "Learn as if you could never catch up, and fear losing what you have.", "8.17"],
];
let owlT = null;
function owlTalk() {
  const S = libState(), wrap = document.querySelector(".lowlwrap"); if (!wrap) return;
  if (wrap.querySelector(".lbubble")) { clearTimeout(owlT); wrap.querySelector(".lbubble").remove(); wrap.querySelector(".lowl").classList.remove("talk"); return; } // tap again: close
  S.q = ((S.q ?? Math.floor(Math.random() * OWL_QUOTES.length)) + 1) % OWL_QUOTES.length;
  const [zs, zt, qpy, en, ref] = OWL_QUOTES[S.q];
  wrap.querySelector(".lbubble")?.remove();
  wrap.insertAdjacentHTML("beforeend", `<div class="lbubble" role="status"><div class="lbz">${trad() ? zt : zs}</div><div class="lbp">${esc(py(qpy))}</div><div class="lbe">${esc(en)}</div><div class="lbr">— ${trad() ? "孔子《論語》" : "孔子《论语》"} ${ref}</div></div>`);
  wrap.querySelector(".lowl").classList.add("talk");
  clearTimeout(owlT); owlT = setTimeout(() => { wrap.querySelector(".lbubble")?.remove(); wrap.querySelector(".lowl")?.classList.remove("talk"); }, 9000);
}

// ---- buying ----
async function libCall(body) {
  const { data: { session } } = await sb.auth.getSession();
  return fetch(`${SUPABASE_URL}/functions/v1/library-checkout`, {
    method: "POST", headers: { Authorization: `Bearer ${session.access_token}`, apikey: SUPABASE_KEY, "Content-Type": "application/json" }, body: JSON.stringify(body),
  }).then((r) => r.json()).catch(() => ({ error: "Couldn't reach the Bookshop. Check your connection." }));
}
let stripeJs = null;
const loadStripe = () => stripeJs || (stripeJs = new Promise((ok, bad) => { const s = document.createElement("script"); s.src = "https://js.stripe.com/v3/"; s.onload = () => ok(window.Stripe); s.onerror = bad; document.head.append(s); }));
async function libClaim(id) { // one free book per member: first tap asks, second tap claims
  const S = libState(); if (S.claiming || S.claimed) return;
  if (S.claimAsk !== id) { S.claimAsk = id; render(); return; }
  S.claimAsk = null; S.claiming = id; render();
  const { data, error } = await sb.rpc("library_claim_free", { p_book: id });
  S.claiming = null;
  if (error || data !== "ok") {
    if (data === "already_claimed") S.claimed = true;
    toast(data === "already_claimed" ? "You've already claimed your free book." : "Couldn't claim this book. Please try again."); render(); return;
  }
  S.claimed = true; S.owned.add(id);
  const b = S.books?.find((x) => x.id === id);
  toast(`🎁 ${b ? b.title_zh || b.title : "Your book"} is on your shelf!`);
  S.tab = "shelf"; location.hash = `#/learn/library/${encodeURIComponent(id)}`;
}
async function libBuy(id) {
  const S = libState(); S.buying = id; render();
  const r = await libCall({ action: "create", book_id: id });
  S.buying = null;
  if (r.owned) { await libVerify(); return; }
  if (r.error || !(r.client_secret || r.url)) { render(); toast(r.error || "Couldn't open the checkout. Please try again."); return; }
  if (r.url) { location.href = r.url; return; } // Stripe's own page; it comes back to #/learn/library?paid=…
  try {
    const Stripe = await loadStripe();
    S.checkout = { session: r.session_id };
    document.body.insertAdjacentHTML("beforeend", `<div class="ztover center lcheckover" data-lib="checkoutclose"><div class="ztsheet lcheck" data-stop><button type="button" class="ztx" data-lib="checkoutclose" aria-label="Close">×</button><b>Secure checkout · Stripe</b><div id="lcheckout"></div></div></div>`);
    render();
    const co = await Stripe(r.publishable_key).initEmbeddedCheckout({ fetchClientSecret: async () => r.client_secret, onComplete: () => { libCloseCheckout(); libVerify(r.session_id); } });
    S.checkout.co = co; co.mount("#lcheckout");
  } catch { libCloseCheckout(); toast("Couldn't load the checkout. Please try again."); }
}
function libCloseCheckout() {
  const S = libState(); try { S.checkout?.co?.destroy(); } catch { /* already gone */ }
  S.checkout = null; document.querySelector(".lcheckover")?.remove();
}
const libWithFree = (ids) => new Set([...ids, ...(libState().books || []).filter((x) => !x.price_cents).map((x) => x.id)]); // free books are on everyone's shelf
async function libVerify(sessionId) {
  const S = libState(); S.verifying = sessionId || true; S.verified = S.verified || new Set(); if (sessionId) S.verified.add(sessionId);
  const r = await libCall({ action: "verify", session_id: sessionId });
  S.verifying = null;
  if (r.owned) S.owned = libWithFree(r.owned);
  if (r.unlocked?.length) {
    const b = S.books?.find((x) => x.id === r.unlocked[0]);
    toast(`📖 ${b ? b.title_zh || b.title : "Your book"} is on your shelf!`);
    S.tab = "shelf"; location.hash = `#/learn/library/${encodeURIComponent(r.unlocked[0])}`;
  } else if (sessionId) { toast("Payment received? It can take a minute. Your book appears on your shelf as soon as Stripe confirms."); location.hash = "#/learn/library"; }
  render();
}

// ---- clicks and typing ----
document.addEventListener("click", async (e) => {
  const w = e.target.closest("[data-lw]");
  if (w && libState().open && route() === "learn") { e.preventDefault(); libShowPop(w.dataset.lw); return; }
  const el = e.target.closest("[data-lib]"); if (!el) return;
  if (el.dataset.lib === "popclose" && e.target.closest("[data-stop]") && !e.target.closest(".ztx")) return;
  if (el.dataset.lib === "checkoutclose" && e.target.closest("[data-stop]") && !e.target.closest(".ztx")) return;
  const S = libState(), a = el.dataset.lib, id = S.open, d = el.dataset;
  if (a === "tab") { S.tab = d.v; if (location.hash !== "#/learn/library") location.hash = "#/learn/library"; else render(); }
  else if (a === "lv") { S.lv = d.v; lsSet("mz-lib-lv", d.v); render(); }
  else if (a === "py") { S.py = d.v; lsSet("mz-lib-py", d.v); render(); }
  else if (a === "buy") libBuy(d.id);
  else if (a === "claim") libClaim(d.id);
  else if (a === "owl") owlTalk();
  else if (a === "checkoutclose") libCloseCheckout();
  else if (a === "popclose") document.querySelector(".lpopover")?.remove();
  else if (a === "addword" || a === "addall") {
    const book = libBook(id); if (!book) return;
    const list = a === "addword" ? [d.w] : d.ch === "all" ? book.chapters.flatMap((c) => c.words) : book.chapters[+d.ch].words;
    el.disabled = true;
    const entries = list.map((x) => libWordEntry(book, x)).filter(Boolean), todo = entries.filter((x) => !state.lu.cards.some((c) => c.hanzi === x.hanzi)).length;
    const n = await ztAddWords(entries, "book");
    if (n) toast(`${n === 1 ? "Added to" : `${n} words added to`} your flashcards.`);
    else if (!todo) toast("Already in your flashcards.");
    else { el.disabled = false; return; } // ztAddWords already said it couldn't save
    const pop = document.querySelector(".lpopover"); render();
    if (pop && a === "addword") libShowPop(d.w);
  }
  else if (a === "qc") { if (libGet(id, `qc.${d.ch}.${d.k}`) === undefined) qLog("lib_qc"); libSet(id, `qc.${d.ch}.${d.k}`, d.v === "true"); render(); }
  else if (a === "read") {
    if (!libGet(id, `read.${d.ch}`)) { qLog("lib_chapter"); const m = libState().books?.find((b) => b.id === id); tEvent("lib_chapter", `${m?.title_zh || m?.title || id} · chapter ${+d.ch + 1}`); }
    libSet(id, `read.${d.ch}`, true); toast("Chapter ticked off. 加油！"); render();
    { const c = libState().content.get(id), total = c?.s?.chapters?.length || 0, m = libState().books?.find((b) => b.id === id);
      if (total && [...Array(total).keys()].every((i) => libGet(id, `read.${i}`))) nbPost("book", id, m?.title_zh || m?.title || id); }
    ztCountDay().then((grew) => { if (grew) toast("Chapter ticked off. Your streak tree grew today 🌱"); });
  }
  else if (a === "show") { libSet(id, `ex.${d.ex}.show.${d.k}`, true); render(); }
  else if (a === "blank") { S.blank = { ex: +d.ex, k: +d.k }; render(); }
  else if (a === "bankw") {
    const sel = S.blank; if (!sel || sel.ex !== +d.ex) { toast("Tap a blank first."); return; }
    const ans = libGet(id, `ex.${d.ex}.a`) || {};
    if (!libBook(id).exercises[+d.ex].reuse) for (const [k, v] of Object.entries(ans)) if (v === d.w && +k !== sel.k) delete ans[k]; // a word goes in one blank only
    ans[sel.k] = d.w; libSet(id, `ex.${d.ex}.a`, ans);
    const items = libBook(id).exercises[+d.ex].items, nextK = items.findIndex((_, k) => !ans[k]);
    S.blank = nextK >= 0 ? { ex: +d.ex, k: nextK } : null; render();
  }
  else if (a === "choice") { libSet(id, `ex.${d.ex}.a.${d.k}`, +d.v); render(); }
  else if (a === "tile" || a === "untile") {
    const cur = libGet(id, `ex.${d.ex}.a.${d.k}`), list = Array.isArray(cur) ? [...cur] : [];
    if (a === "tile") list.push(+d.j); else list.splice(+d.p, 1);
    libSet(id, `ex.${d.ex}.a.${d.k}`, list); render();
  }
  else if (a === "check") { libSet(id, `ex.${d.ex}.show.${d.k}`, true); render(); }
  else if (a === "selfok") { libSet(id, `ex.${d.ex}.a.${d.k}`, true); render(); }
  else if (a === "task") { libSet(id, `ex.${d.ex}.task`, d.v); render(); }
  else if (a === "reset") { libSet(id, `ex.${d.ex}`, {}); S.blank = null; render(); }
});
document.addEventListener("keydown", (e) => { if ((e.key === "Enter" || e.key === " ") && e.target.matches?.(".lw[data-lw]")) { e.preventDefault(); e.target.click(); } });
document.addEventListener("input", (e) => {
  const t = e.target.closest("[data-libin]"); if (!t) return;
  const id = libState().open, [ex, k] = t.dataset.libin.split(".");
  if (k === "text") {
    libSet(id, `ex.${ex}.text`, t.value);
    const n = (t.value.match(/[一-鿿]/g) || []).length, c = document.querySelector(".lcount");
    if (c) { c.textContent = `${n} / 150 characters`; c.classList.toggle("over", n > 150); }
    const cl = document.querySelector(".lchecklist"); if (cl) cl.innerHTML = libEssayChecks(t.value);
  } else {
    const ans = libGet(id, `ex.${ex}.a`) || {}; ans[k] = t.value; libSet(id, `ex.${ex}.a`, ans);
    const sh = libGet(id, `ex.${ex}.show`); if (sh?.[k] && libBook(id).exercises[+ex].kind === "write") { delete sh[k]; }
  }
});

// ---------------------------------------------------------------------------
// Qilin 麒麟 challenges (Zest Town; beta for admins from 24 Nov 2026)
// A qilin wanders around town on its own, like your fruit. Tap it: today's challenge (+1 XP), this week's (+2 XP) and this
// month's (+5 XP), the same for everyone. Each list is played in a shuffled order and a challenge only comes back
// once the whole list has been used. Progress comes from town_log (qLog() below, per local day) and the streak
// tree days. Members tap Claim (qilin_claim); XP not claimed before the period ends is lost.
// NEW BUILDING? Add 2–3 challenges for it to these lists (and qLog() calls where its actions happen).
// ---------------------------------------------------------------------------
const qlOpen = () => isAdmin(); // beta: admins only
// k = a town_log kind summed over the period; f = "days" (streak-tree days), "distinct" (different kinds starting with k),
// "daysWith" (days with kind k), "trio" (days with flashcards + writing + reading)
const QL = {
  day: [
    { id: "fc15", t: "Review 15 flashcards", b: "Flashcard Center", go: "#/learn/cards", k: "fc_review", n: 15 },
    { id: "new3", t: "Learn 3 new words", b: "Flashcard Center", go: "#/learn/cards", k: "fc_new", n: 3 },
    { id: "clear", t: "Clear every flashcard due today", b: "Flashcard Center", go: "#/learn/cards", k: "fc_clear", n: 1 },
    { id: "hsk5", t: "Add 5 HSK Temple words to your flashcards", b: "HSK Temple", go: "#/learn/temple", k: "hsk_add", n: 5 },
    { id: "known3", t: "Tell the HSK Temple 3 words you already know", b: "HSK Temple", go: "#/learn/temple", k: "hsk_known", n: 3 },
    { id: "write3", t: "Write 3 characters", b: "Calligraphy School", go: "#/learn/callig", k: "cg_write", n: 3 },
    { id: "nooutline", t: "Write a character without the outline", b: "Calligraphy School", go: "#/learn/callig", k: "cg_nooutline", n: 1 },
    { id: "boxround", t: "Finish today's character box round", b: "Calligraphy School", go: "#/learn/callig/box", k: "cg_boxdone", n: 1 },
    { id: "boxadd2", t: "Add 2 new characters to your character box", b: "Calligraphy School", go: "#/learn/callig", k: "cg_boxadd", n: 2 },
    { id: "lookup3", t: "Look up the stroke order of 3 characters", b: "Calligraphy School", go: "#/learn/callig", k: "cg_lookup", n: 3 },
    { id: "bones3", t: "Solve 3 bones in the Oracle Bone course", b: "Calligraphy School", go: "#/learn/callig/course/oracle", k: "co_bone", n: 3 },
    { id: "chapter", t: "Read a Library chapter", b: "Library", go: "#/learn/library", k: "lib_chapter", n: 1 },
    { id: "qc3", t: "Answer 3 quick checks in a Library book", b: "Library", go: "#/learn/library", k: "lib_qc", n: 3 },
    { id: "forest", t: "Visit the Magical Forest", b: "Magical Forest", go: "#/learn/forest", k: "visit:forest", n: 1 },
    { id: "visit4", t: "Visit 4 different buildings today", b: "Zest Town", go: "#/learn", k: "visit:", f: "distinct", n: 4 },
    { id: "letter", t: "Send a letter, even a short one", b: "Post Office", go: "#/learn/post", k: "letter", n: 1 },
  ],
  week: [
    { id: "tree5", t: "Grow your streak tree 5 days this week", b: "Streak tree", go: "#/learn", f: "days", n: 5 },
    { id: "fc100", t: "Review 100 flashcards", b: "Flashcard Center", go: "#/learn/cards", k: "fc_review", n: 100 },
    { id: "new15", t: "Learn 15 new words", b: "Flashcard Center", go: "#/learn/cards", k: "fc_new", n: 15 },
    { id: "hsk10", t: "Add 10 HSK Temple words to your flashcards", b: "HSK Temple", go: "#/learn/temple", k: "hsk_add", n: 10 },
    { id: "write20", t: "Write 20 characters", b: "Calligraphy School", go: "#/learn/callig", k: "cg_write", n: 20 },
    { id: "memory5", t: "Get 5 characters to “from memory” in your box", b: "Calligraphy School", go: "#/learn/callig/box", k: "cg_memory", n: 5 },
    { id: "boxadd10", t: "Add 10 characters to your character box", b: "Calligraphy School", go: "#/learn/callig", k: "cg_boxadd", n: 10 },
    { id: "cochapter", t: "Finish a chapter of the Oracle Bone course", b: "Calligraphy School", go: "#/learn/callig/course/oracle", k: "co_chapter", n: 1 },
    { id: "chapters3", t: "Read 3 Library chapters", b: "Library", go: "#/learn/library", k: "lib_chapter", n: 3 },
    { id: "people2", t: "Send letters to 2 different people", b: "Post Office", go: "#/learn/post", k: "letterto:", f: "distinct", n: 2 },
    { id: "letter30", t: "Write a letter of 30+ characters", b: "Post Office", go: "#/learn/post", k: "letter30", n: 1 },
    { id: "trio", t: "Flashcards, writing and a Library chapter on the same day", b: "Zest Town", go: "#/learn", f: "trio", n: 1 },
    { id: "forest3", t: "Visit the Magical Forest on 3 days", b: "Magical Forest", go: "#/learn/forest", k: "visit:forest", f: "daysWith", n: 3 },
    { id: "clear4", t: "Clear your due flashcards on 4 days", b: "Flashcard Center", go: "#/learn/cards", k: "fc_clear", f: "daysWith", n: 4 },
  ],
  month: [
    { id: "tree20", t: "Grow your streak tree on 20 days", b: "Streak tree", go: "#/learn", f: "days", n: 20 },
    { id: "fc400", t: "Review 400 flashcards", b: "Flashcard Center", go: "#/learn/cards", k: "fc_review", n: 400 },
    { id: "new60", t: "Learn 60 new words", b: "Flashcard Center", go: "#/learn/cards", k: "fc_new", n: 60 },
    { id: "write100", t: "Write 100 characters", b: "Calligraphy School", go: "#/learn/callig", k: "cg_write", n: 100 },
    { id: "memory15", t: "Get 15 characters to “from memory”", b: "Calligraphy School", go: "#/learn/callig/box", k: "cg_memory", n: 15 },
    { id: "pack30", t: "Add 30 characters from a character package", b: "Calligraphy School", go: "#/learn/callig", k: "cg_pack", n: 30 },
    { id: "cochapters2", t: "Finish 2 chapters of the Oracle Bone course", b: "Calligraphy School", go: "#/learn/callig/course/oracle", k: "co_chapter", n: 2 },
    { id: "chapters8", t: "Read 8 Library chapters", b: "Library", go: "#/learn/library", k: "lib_chapter", n: 8 },
    { id: "letters5", t: "Send 5 letters", b: "Post Office", go: "#/learn/post", k: "letter", n: 5 },
    { id: "people3", t: "Write to 3 different people", b: "Post Office", go: "#/learn/post", k: "letterto:", f: "distinct", n: 3 },
  ],
};
const QL_XP = { day: 1, week: 2, month: 5 };
const qlState = () => (state.ql ??= { log: null, claims: new Set(), loading: false, at: 0, open: false, claimed: null, visits: new Set() });
// The current day / week / month in the member's local time, and which challenge each one has.
function qlPeriods() {
  const today = todayKey(), now = new Date(); now.setHours(12, 0, 0, 0);
  const mon = new Date(now); mon.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0, 12);
  const span = (a, b) => Math.round((Date.parse(a + "T12:00:00Z") - Date.parse(b + "T12:00:00Z")) / 864e5);
  const idx = { day: span(today, "2026-01-01"), week: Math.round(span(dkey(mon), "2025-12-29") / 7), month: now.getFullYear() * 12 + now.getMonth() };
  const from = { day: today, week: dkey(mon), month: today.slice(0, 8) + "01" }, to = { day: today, week: dkey(sun), month: dkey(last) };
  const key = { day: today, week: dkey(mon), month: today.slice(0, 7) };
  return ["day", "week", "month"].map((p) => ({ p, key: key[p], from: from[p], to: to[p], c: qlPick(QL[p], idx[p], p) }));
}
// Shuffled order per cycle (seeded, so everyone gets the same), so nothing repeats before the list is used up.
function qlPick(list, i, salt) {
  const n = list.length, cycle = Math.floor(i / n);
  let s = (cycle * 7919 + salt.length * 104729 + 17) >>> 0;
  const rnd = () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const order = [...Array(n).keys()];
  for (let j = n - 1; j > 0; j--) { const k = Math.floor(rnd() * (j + 1)); [order[j], order[k]] = [order[k], order[j]]; }
  return list[order[((i % n) + n) % n]];
}
function qlProgress(per) {
  const c = per.c, rows = (qlState().log || []).filter((r) => r.day >= per.from && r.day <= per.to && r.n > 0);
  if (c.f === "days") return [...ztActiveDays()].filter(([d, kind]) => kind !== "water" && d >= per.from && d <= per.to).length;
  if (c.f === "distinct") return new Set(rows.filter((r) => r.kind.startsWith(c.k)).map((r) => r.kind)).size;
  if (c.f === "daysWith") return new Set(rows.filter((r) => r.kind === c.k).map((r) => r.day)).size;
  if (c.f === "trio") { const by = (k) => new Set(rows.filter((r) => r.kind === k).map((r) => r.day)); const a = by("fc_review"), b = by("cg_write"), l = by("lib_chapter"); return [...a].filter((d) => b.has(d) && l.has(d)).length; }
  return rows.filter((r) => r.kind === c.k).reduce((t, r) => t + r.n, 0);
}
async function qlLoad(force) {
  const Q = qlState();
  if (Q.loading || (!force && Q.log && Date.now() - Q.at < 60e3)) return;
  Q.loading = true;
  const ps = qlPeriods(), from = ps.map((x) => x.from).sort()[0];
  const [l, c] = await Promise.all([
    sb.from("town_log").select("day, kind, n").gte("day", from),
    sb.from("qilin_claims").select("period, period_key").in("period_key", ps.map((x) => x.key)),
  ]);
  Q.loading = false; Q.at = Date.now();
  const before = JSON.stringify([Q.log, [...Q.claims]]);
  if (!l.error) Q.log = l.data;
  if (!c.error) Q.claims = new Set(c.data.map((r) => `${r.period}:${r.period_key}`));
  if (route() === "learn" && JSON.stringify([Q.log, [...Q.claims]]) !== before) render(); // no change, no re-render (it made the sheet flicker)
}
// Record something done in town (today, local time). Cheap and fire-and-forget.
function qLog(kind, n = 1) {
  if (!state.user || !(n > 0)) return;
  const Q = qlState(), day = todayKey();
  if (Q.log) { const r = Q.log.find((x) => x.day === day && x.kind === kind); r ? (r.n += n) : Q.log.push({ day, kind, n }); }
  sb.rpc("town_log_add", { p_day: day, p_kind: kind, p_n: n }).then(({ error }) => { if (error) console.error(error); });
}
// Something a member did in town, for the admin activity board (Learning). Fire-and-forget.
function tEvent(kind, label) { if (state.user) sb.rpc("town_event", { p_kind: kind, p_label: label || null }).then(({ error }) => { if (error) console.error(error); }); }
// Once a day per member at most (e.g. "used the HSK Temple", instead of one line per word).
function tEventDaily(kind, label) { const k = `mz-tev-${kind}`; if (lsGet(k) === todayKey()) return; lsSet(k, todayKey()); tEvent(kind, label); }
function qlVisit(b) {
  const Q = qlState(), k = `${todayKey()}:${b}`;
  if (Q.visits.has(k) || lsGet("mz-ql-v-" + k)) return;
  Q.visits.add(k); lsSet("mz-ql-v-" + k, "1"); qLog("visit:" + b);
}
const qlStatus = () => qlPeriods().map((per) => { const have = qlProgress(per); return { ...per, have, done: have >= per.c.n, claimed: qlState().claims.has(`${per.p}:${per.key}`) }; });
const qlBang = () => { if (!qlState().log) return false; const s = qlStatus(); return s.some((x) => x.done && !x.claimed) || lsGet("mz-ql-seen") !== todayKey(); };

function qlSheet() {
  const Q = qlState(), host = state.role === "host";
  if (Q.claimed) {
    const r = Q.claimed;
    return `<div class="ztover center still" data-ql="close"><div class="ztsheet qlsheet qldone" data-stop>
      <div class="qlartbox"><img class="qlart" src="icons/zt/qilin-art.png" alt="" decoding="sync" draggable="false"><span class="qlplus">+${r.xp} XP</span></div>
      <h2 style="margin:0">${trad() ? "太好了！" : "太好了！"} Well done</h2>
      <p class="muted" style="margin:0">You finished ${r.p === "day" ? "today's" : r.p === "week" ? "this week's" : "this month's"} challenge. The qilin gives you <b>+${r.xp} XP</b>.<br>${r.p === "day" ? "Come back tomorrow for a new one." : r.p === "week" ? "A new one comes on Monday." : "A new one comes next month."}</p>
      <button type="button" class="btn qlok" data-ql="back">好的！ Back</button></div></div>`;
  }
  const left = (per) => {
    if (per.p === "day") { const m = new Date(); m.setHours(24, 0, 0, 0); const h = Math.max(1, Math.round((m - Date.now()) / 36e5)); return `new one in ${h} h`; }
    const d = new Date(per.to + "T12:00:00"); return per.p === "week" ? "ends Sunday" : `ends ${d.toLocaleDateString([], { day: "numeric", month: "short" })}`;
  };
  const card = (s) => {
    const xp = QL_XP[s.p], pct = Math.min(100, Math.round((s.have / s.c.n) * 100)), col = { day: "#c2410c", week: "#2e7d48", month: "#9b2c2c" }[s.p];
    const btn = s.claimed ? `<span class="qlclaimed">✓ +${xp} XP claimed</span>`
      : s.done ? (host ? `<span class="small muted">Done! (hosts don't earn XP)</span>` : `<button type="button" class="btn qlclaim" data-ql="claim" data-p="${s.p}">Claim +${xp} XP</button>`)
      : `${s.c.go !== "#/learn" ? `<a class="small qlgo" href="${s.c.go}" data-ql="go">Go to the ${esc(s.c.b)} ›</a>` : ""}<b class="small">+${xp} XP</b>`;
    return `<div class="card qlcard ${s.done && !s.claimed ? "ready" : ""}">
      <div class="row between small"><span class="qlper" style="color:${col}">${{ day: "TODAY", week: "THIS WEEK", month: "THIS MONTH" }[s.p]}</span><span class="muted">${{ day: trad() ? "每日" : "每日", week: trad() ? "每週" : "每周", month: trad() ? "每月" : "每月" }[s.p]} · ${left(s)}</span></div>
      <b class="qltask">${esc(s.c.t)}</b>
      <div class="row" style="gap:10px;align-items:center"><span class="qlbar"><i style="width:${pct}%;background:${s.done ? "#1b6f1b" : col}"></i></span><b class="small">${Math.min(s.have, s.c.n)} / ${s.c.n}</b></div>
      <div class="row between" style="align-items:center;justify-content:flex-end;gap:12px">${btn}</div></div>`;
  };
  return `<div class="ztover center ${Date.now() - (Q.openedAt || 0) > 300 ? "still" : ""}" data-ql="close"><div class="ztsheet qlsheet" data-stop>
    <div class="qlhead"><button type="button" class="ztx qlx" data-ql="close" aria-label="Close">×</button>
      <div class="qlsay"><span class="cgzh" style="font-weight:700;font-size:17px">你好！我是麒麟。</span><br><span class="small">${Q.log ? "Ready for a challenge? Finish one and I'll give you extra XP." : "One moment…"}</span></div>
      <img class="qlart" src="icons/zt/qilin-art.png" alt="" decoding="sync" draggable="false"></div>
    ${Q.log ? qlStatus().map(card).join("") : `<p class="muted small">Loading your challenges…</p>`}
    <p class="tiny muted" style="margin:0">Everyone gets the same challenges. Claim the XP before the day, week or month ends, or it's lost. ${host ? "" : "It comes on top of your daily streak XP."}</p>
  </div></div>`;
}
document.addEventListener("click", async (e) => {
  const el = e.target.closest("[data-ql]"); if (!el) return;
  if (el.dataset.ql === "close" && e.target.closest("[data-stop]") && !e.target.closest(".qlx")) return; // clicks inside the sheet
  const Q = qlState(), a = el.dataset.ql;
  if (a === "open") { Q.open = true; Q.openedAt = Date.now(); Q.claimed = null; lsSet("mz-ql-seen", todayKey()); render(); qlLoad(); }
  else if (a === "close" || a === "back") { Q.open = false; Q.claimed = null; render(); }
  else if (a === "go") { Q.open = false; }
  else if (a === "claim") {
    const s = qlStatus().find((x) => x.p === el.dataset.p); if (!s || !s.done || s.claimed) return;
    el.disabled = true;
    const { error } = await sb.rpc("qilin_claim", { p_period: s.p, p_key: s.key, p_challenge: s.c.id });
    if (error && !/already_claimed/.test(error.message)) { el.disabled = false; return toast(/period_over/.test(error.message) ? "This challenge has ended." : "Couldn't claim it. Check your connection and try again."); }
    Q.claims.add(`${s.p}:${s.key}`); Q.claimed = { p: s.p, xp: QL_XP[s.p] };
    tEvent("qilin", `+${QL_XP[s.p]} XP · ${s.c.t}`);
    await refreshBoard(); // one render, after the XP is in (two renders made the sheet flicker)
  }
});
function qlWalk() { ztWalk("qilin", ".ztqilin"); }

// ---------------------------------------------------------------------------
// Post Office 郵局 (Zest Town; live for everyone since 24 Nov 2026, after a short admin beta)
// Short letters (1–140 characters, any text; Chinese encouraged) to a member or a host.
// Table letters, private between the two people. send_letter() allows 10 a day. A new letter calls the
// letter-notify edge function: a push (or an email when the app can't notify them), and a count on the town sign.
// Read a letter: tap a word for its pinyin/zhuyin and meaning, add its words to flashcards, reply, or report it.
// ---------------------------------------------------------------------------
const postOpen = () => true; // live for everyone with Zest Town since 24 Nov 2026 (beta for admins earlier that day)
const POST_MAX = 140, POST_PER_DAY = 10;
const POST_HAN = /[㐀-䶿一-鿿]/u; // for tap-a-word: only Chinese characters are tappable
const POST_ENV = `<svg viewBox="0 0 14 10" aria-hidden="true" shape-rendering="crispEdges"><rect width="14" height="10" fill="#2a2420"/><rect x="1" y="1" width="12" height="8" fill="#fff"/><path d="M1 1h1v1h1v1h1v1h1v1h1v1h2v-1h1v-1h1v-1h1v-1h1v-1h1v-1" fill="none" stroke="#a39b8b" stroke-width="1"/><rect x="6" y="5" width="2" height="2" fill="#a62f22"/></svg>`;
const postState = () => (state.post ??= { loaded: false, loading: false, at: 0, letters: [], people: null, tab: "in", draft: "", q: "", words: new Map(), sel: null, reported: null, err: false });
async function postLoad(force) {
  const P = postState();
  if (P.loading || (!force && Date.now() - P.at < 60e3)) return;
  P.loading = true;
  const [l, p] = await Promise.all([
    sb.from("letters").select("id, sender, recipient, body, reply_to, created_at, read_at, reported_at").order("created_at", { ascending: false }).limit(300),
    sb.rpc("letter_people"),
  ]);
  P.loading = false; P.at = Date.now();
  if (l.error) P.err = true; else { P.letters = l.data; P.loaded = true; P.err = false; }
  if (!p.error) P.people = new Map(p.data.map((x) => [x.id, x]));
  await postStickerCheck();
  if (route() === "learn") render();
}
// 来信 sticker: the database awards it once you've sent a letter and got one; show the pop-up straight away.
async function postStickerCheck() {
  const P = postState(), me = state.user.id;
  if (isHost() || myStickers().includes("letter") || !P.letters.some((l) => l.sender === me) || !P.letters.some((l) => l.recipient === me)) return;
  const { data, error } = await sb.from("sticker_awards").select("*").order("awarded_at", { ascending: false });
  if (error) return;
  state.stickerAwards = data; rewardCheck();
}
const postUnread = () => { const P = postState(); return P.loaded ? P.letters.filter((l) => l.recipient === state.user.id && !l.read_at).length : 0; };
const postPerson = (id) => id === state.user.id ? { id, name: state.me?.display_name || "Me", fruit: state.me?.fruit, role: state.role } : (postState().people?.get(id) || { id, name: "A club member" });
const postName = (p) => `${esc(p.name)}${p.role === "host" ? ` <span class="muted small">(host)</span>` : ""}`;
const postAv = (p, s = 40) => `<span class="postav" style="width:${s}px;height:${s}px">${ztImg("fruit-" + (ZT_FRUITS.has(p.fruit) ? p.fruit : "orange"))}</span>`;
const postWhen = (d) => { const t = new Date(d), h = (Date.now() - t) / 36e5; return h < 20 ? ago(d) : t.toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }); };
const postHead = (back, href) => `<header class="zthead"><a class="ztback" href="${href}">‹ ${back}</a></header>`;
// While in beta only admins can open the Post Office, so they're the only ones you can write to.
const postPeople = () => [...(postState().people?.values() || [])];

function postView(parts, qs) {
  if (!postOpen()) { location.hash = "#/learn"; return townView(); }
  const P = postState();
  if (!P.loaded) { postLoad(); return `${ztHeader(null, postTitle())}<p class="muted small">${P.err ? "Couldn't open the Post Office. Check your connection and try again." : "Opening the Post Office…"}</p>`; }
  postLoad(); // refresh in the background (at most once a minute)
  if (parts[0] === "write") return postWriteView(qs);
  if (parts[0] === "reported" && isAdmin()) return postReportedView();
  if (parts[0]) return postReadView(parts[0]);
  return postInboxView();
}
const postTitle = () => `Post Office <span class='zhsub'>${trad() ? "郵局" : "邮局"}</span>`;

function postInboxView() {
  const P = postState(), me = state.user.id;
  const inbox = P.letters.filter((l) => l.recipient === me), sent = P.letters.filter((l) => l.sender === me);
  const unread = inbox.filter((l) => !l.read_at).length, list = P.tab === "sent" ? sent : inbox;
  const row = (l) => {
    const mine = l.sender === me, who = postPerson(mine ? l.recipient : l.sender), isNew = !mine && !l.read_at;
    return `<a class="card postrow ${isNew ? "new" : ""}" href="#/learn/post/${l.id}">${postAv(who)}
      <span class="grow" style="min-width:0"><span class="row between" style="gap:8px"><b>${mine ? "To " : ""}${postName(who)}</b><span class="small muted">${ago(l.created_at)}</span></span>
      <span class="postline cgzh">${esc(l.body.replace(/\n+/g, " "))}</span></span>${isNew ? `<i class="postdot" aria-label="New"></i>` : ""}</a>`;
  };
  const sentToday = sent.filter((l) => Date.now() - new Date(l.created_at) < 864e5).length;
  return `${ztHeader(ztStreak(), postTitle())}
    <div class="ztthead"><span class="ztplaceart">${ztImg("post")}</span><span class="small muted">Write short letters to other members and to our hosts, in Chinese if you can. Up to ${POST_MAX} characters, like a postcard.</span></div>
    ${sentToday >= POST_PER_DAY ? `<p class="small muted" style="margin:0">You've sent ${POST_PER_DAY} letters today. You can write again tomorrow.</p>` : `<a class="btn postwrite" href="#/learn/post/write">✉️ Write a letter</a>`}
    <div class="seg postseg" role="group" aria-label="Mailbox"><button type="button" data-post="tab" data-v="in" aria-pressed="${P.tab !== "sent"}">Inbox${unread ? ` · ${unread} new` : ""}</button><button type="button" data-post="tab" data-v="sent" aria-pressed="${P.tab === "sent"}">Sent</button></div>
    <div class="postlist">${list.length ? list.map(row).join("") : `<div class="card postempty">${POST_ENV}<p class="muted small" style="margin:0">${P.tab === "sent" ? "You haven't sent a letter yet." : "No letters yet. Write one, and you might get one back!"}</p></div>`}</div>
    ${isAdmin() ? `<a class="small" href="#/learn/post/reported" style="font-weight:800">🚩 Reported letters (admins)</a>` : ""}`;
}

function postWriteView(qs) {
  const P = postState(), to = qs.to && postState().people?.get(qs.to);
  const reply = qs.reply && P.letters.find((l) => l.id === qs.reply);
  const head = postHead(reply ? "Back to the letter" : "Post Office", reply ? `#/learn/post/${reply.id}` : "#/learn/post");
  if (!to) {
    const q = P.q.trim().toLowerCase(), people = postPeople().filter((p) => !q || p.name.toLowerCase().includes(q));
    return `${head}<h1 style="margin:0">Write a letter</h1><p class="muted small" style="margin:0">Who is it for?</p>
      <input class="postfind" type="search" placeholder="Search a name" value="${esc(P.q)}" data-post-find aria-label="Search a name">
      <div class="postlist">${people.map((p) => `<a class="card postrow" href="#/learn/post/write?to=${p.id}">${postAv(p, 36)}<span class="grow"><b>${postName(p)}</b></span><span class="small muted">Choose ›</span></a>`).join("") || `<p class="muted small">Nobody found.</p>`}</div>`;
  }
  const n = [...P.draft].length;
  return `${head}<h1 style="margin:0">${reply ? "Write back" : "Write a letter"}</h1>
    <div class="card postto">${postAv(to, 32)}<span class="grow"><span class="small muted">To</span> <b>${postName(to)}</b></span>${reply ? "" : `<a class="small" href="#/learn/post/write" style="font-weight:800">Change</a>`}</div>
    ${reply ? `<p class="small muted postquote cgzh" style="margin:0">↩ ${esc(reply.body.replace(/\n+/g, " "))}</p>` : ""}
    <div class="postpaper write"><span class="poststamp">${ztImg("post")}</span>
      <textarea class="cgzh" data-post-draft maxlength="${POST_MAX * 2 + 20}" rows="6" placeholder="${trad() ? "你好！" : "你好！"}" aria-label="Your letter">${esc(P.draft)}</textarea>
      <div class="postsign">${esc(state.me?.display_name || "")}</div></div>
    <div class="row between small"><span class="muted" data-post-hint>${postHint(P.draft)}</span><b data-post-count class="${n > POST_MAX ? "over" : ""}">${n} / ${POST_MAX}</b></div>
    <button type="button" class="btn postsend" data-post="send" data-to="${to.id}" ${reply ? `data-reply="${reply.id}"` : ""} ${postValid(P.draft) ? "" : "disabled"}>Send the letter</button>`;
}
const postValid = (t) => { const n = [...t.trim()].length; return n >= 1 && n <= POST_MAX; };
function postHint(t) {
  const s = t.trim(); if (!s) return "Chinese is best, but anything goes";
  if ([...s].length > POST_MAX) return `Too long: ${POST_MAX} characters at most`;
  return "Looks good!";
}

// Split a letter into words: the longest HSK word (up to 4 characters) at each spot, else a single character.
function postSegments(body, words) {
  const hsk = new Map(), ch = new Map();
  for (const w of words || []) {
    if (w.src === "hsk") { for (const k of [w.hanzi, w.hanzi_trad]) if (k && !hsk.has(k)) hsk.set(k, w); }
    else if (w.hanzi && !ch.has(w.hanzi)) ch.set(w.hanzi, w);
  }
  const cs = [...body], out = [];
  for (let i = 0; i < cs.length;) {
    if (!POST_HAN.test(cs[i])) { out.push({ t: cs[i] }); i++; continue; }
    let hit = null;
    for (let n = Math.min(4, cs.length - i); n >= 1 && !hit; n--) { const t = cs.slice(i, i + n).join(""); if (hsk.has(t)) hit = { t, w: hsk.get(t) }; }
    if (!hit) hit = { t: cs[i], w: ch.get(cs[i]) || null };
    out.push(hit); i += [...hit.t].length;
  }
  return out;
}
async function postWordsLoad(l) {
  const P = postState(); if (P.words.has(l.id)) return;
  P.words.set(l.id, null);
  const { data, error } = await sb.rpc("letter_words", { p_text: l.body });
  P.words.set(l.id, error ? [] : data);
  if (route() === "learn") render();
}

function postReadView(id) {
  const P = postState(), me = state.user.id, l = P.letters.find((x) => x.id === id);
  const head = postHead("Post Office", "#/learn/post");
  if (!l) return `${head}<div class="card"><b>Letter not found</b><p class="small muted" style="margin:4px 0 0">It may have been sent to someone else.</p></div>`;
  const mine = l.sender === me, other = postPerson(mine ? l.recipient : l.sender);
  if (!mine && !l.read_at) { l.read_at = new Date().toISOString(); sb.rpc("letter_read", { p_id: l.id }).then(() => {}); }
  const words = P.words.get(l.id);
  if (words === undefined) postWordsLoad(l);
  const segs = postSegments(l.body, words), sel = P.sel?.id === l.id ? P.sel.i : -1;
  const text = segs.map((s, i) => s.w ? `<button type="button" class="postw ${i === sel ? "on" : ""}" data-post="word" data-i="${i}" data-id="${l.id}">${esc(s.t)}</button>` : s.t === "\n" ? "<br>" : esc(s.t)).join("");
  const sw = sel >= 0 ? segs[sel]?.w : null;
  const have = new Set(state.lu.cards.flatMap((c) => [c.hanzi, c.hanzi_trad]));
  const card = sw ? `<div class="card postword"><div class="row between" style="align-items:flex-start;gap:10px"><span><span class="cgzh" style="font-size:28px;font-weight:700">${esc(segs[sel].t)}</span> <span class="pron">${esc(py(sw.pinyin))}</span>
      ${sw.level ? `<span class="small muted"> · HSK ${esc(sw.level)}</span>` : ""}<br><span class="small">${esc(sw.meaning || "")}</span></span>
      <button type="button" class="iconbtn" data-post="word" data-i="-1" data-id="${l.id}" aria-label="Close">✕</button></div>
      ${sw.src === "hsk" ? (have.has(sw.hanzi) ? `<span class="small muted">In your flashcards</span>` : `<button type="button" class="btn small green" data-post="addone" data-id="${l.id}" data-i="${sel}">+ Add to my flashcards</button>`) : `<a class="small" style="font-weight:800" href="${cgHref(segs[sel].t)}">See it in the Calligraphy School ›</a>`}</div>` : "";
  const hskWords = segs.filter((s) => s.w?.src === "hsk" && !have.has(s.w.hanzi));
  return `${head}
    <div class="row" style="gap:10px;align-items:center">${postAv(other, 44)}<div><b style="font-size:17px">${mine ? "To" : "From"} ${postName(other)}</b><br><span class="small muted">${postWhen(l.created_at)}${mine ? ` · ${l.read_at ? "Read ✓" : "Not read yet"}` : ""}</span></div></div>
    <div class="postpaper read"><span class="postseal cgzh" aria-hidden="true">信</span>
      <div class="postbody cgzh">${text}</div>
      <div class="postsign">${esc(postPerson(l.sender).name)}</div></div>
    ${words === null || words === undefined ? `<p class="small muted" style="margin:0">Looking up the words…</p>` : `<span class="posttip">Tap a word for its ${pyName()} and meaning</span>`}
    ${card}
    ${mine ? `<a class="btn ghost" href="#/learn/post/write?to=${l.recipient}">Write another letter to ${esc(other.name)}</a>`
      : `<a class="btn postsend" href="#/learn/post/write?to=${l.sender}&reply=${l.id}">Reply</a>`}
    <div class="row between" style="gap:10px;flex-wrap:wrap">${hskWords.length ? `<button type="button" class="linkbtn" data-post="addall" data-id="${l.id}">+ Add ${hskWords.length === 1 ? "its HSK word" : `its ${new Set(hskWords.map((s) => s.w.hanzi)).size} HSK words`} to flashcards</button>` : `<span class="small muted">${segs.some((s) => s.w?.src === "hsk") ? "Its HSK words are in your flashcards" : ""}</span>`}
      ${mine ? "" : l.reported_at ? `<span class="small muted">Reported to the admins</span>` : `<button type="button" class="linkbtn report" data-post="report" data-id="${l.id}">Report</button>`}</div>`;
}

function postReportedView() {
  const P = postState();
  if (P.reported === null) {
    P.reported = undefined;
    sb.rpc("admin_reported_letters").then(({ data, error }) => { P.reported = error ? [] : data; if (route() === "learn") render(); });
  }
  const list = P.reported || [];
  return `${postHead("Post Office", "#/learn/post")}<h1 style="margin:0">Reported letters</h1>
    <p class="small muted" style="margin:0">Only admins see this. A letter shows up here when the person who got it taps Report.</p>
    ${P.reported === undefined ? `<p class="muted small">Loading…</p>` : list.length ? list.map((r) => `<div class="card"><div class="small muted">${esc(r.sender_name)} → ${esc(r.recipient_name)} · sent ${postWhen(r.created_at)} · reported ${ago(r.reported_at)}</div>
      <p class="cgzh" style="font-size:18px;margin:6px 0 0;white-space:pre-wrap">${esc(r.body)}</p></div>`).join("") : `<div class="card"><p class="muted small" style="margin:0">Nothing reported. 🎉</p></div>`}`;
}

document.addEventListener("input", (e) => {
  const P = state.post; if (!P) return;
  if (e.target.matches("[data-post-find]")) { P.q = e.target.value; keepForm(() => render()); const f = document.querySelector("[data-post-find]"); if (f) { f.focus(); f.setSelectionRange(f.value.length, f.value.length); } return; }
  if (!e.target.matches("[data-post-draft]")) return;
  P.draft = e.target.value;
  const n = [...P.draft.trim()].length, c = document.querySelector("[data-post-count]"), h = document.querySelector("[data-post-hint]"), b = document.querySelector('[data-post="send"]');
  if (c) { c.textContent = `${n} / ${POST_MAX}`; c.classList.toggle("over", n > POST_MAX); }
  if (h) h.innerHTML = postHint(P.draft);
  if (b) b.disabled = !postValid(P.draft);
});
document.addEventListener("click", async (e) => {
  const el = e.target.closest("[data-post]"); if (!el) return;
  const P = postState(), a = el.dataset.post;
  if (a === "tab") { P.tab = el.dataset.v; render(); }
  else if (a === "word") { const i = +el.dataset.i; P.sel = i < 0 || (P.sel?.id === el.dataset.id && P.sel.i === i) ? null : { id: el.dataset.id, i }; keepForm(() => render()); }
  else if (a === "send") {
    const body = P.draft.trim(); if (!postValid(body)) return;
    el.disabled = true; el.textContent = "Sending…";
    const { error } = await sb.rpc("send_letter", { p_to: el.dataset.to, p_body: body, p_reply: el.dataset.reply || null });
    if (error) {
      el.disabled = false; el.textContent = "Send the letter";
      return toast(/daily_limit/.test(error.message) ? `You've sent ${POST_PER_DAY} letters today. You can write again tomorrow.` : "Couldn't send your letter. Check your connection and try again.");
    }
    qLog("letter"); qLog("letterto:" + el.dataset.to); tEvent("letter", postPerson(el.dataset.to).name); if ([...body].length >= 30) qLog("letter30");
    P.draft = ""; P.tab = "sent";
    toast(await ztCountDay() ? "✉️ Letter sent! Your streak tree grew today 🌱" : "✉️ Letter sent!");
    await postLoad(true); location.hash = "#/learn/post";
  } else if (a === "addone" || a === "addall") {
    const l = P.letters.find((x) => x.id === el.dataset.id); if (!l) return;
    const segs = postSegments(l.body, P.words.get(l.id));
    const ws = (a === "addone" ? [segs[+el.dataset.i]] : segs).filter((s) => s?.w?.src === "hsk").map((s) => ({ hanzi: s.w.hanzi, hanzi_trad: s.w.hanzi_trad, pinyin: s.w.pinyin, meaning: s.w.meaning, level: s.w.level }));
    el.disabled = true;
    const n = await ztAddWords(ws, "letter");
    toast(n ? `Added ${n} word${n === 1 ? "" : "s"} to your flashcards.` : "Those words are already in your flashcards.");
    keepForm(() => render());
  } else if (a === "report") {
    if (!confirm("Report this letter?\n\nThe admins will read it and take care of it. The person who wrote it isn't told.")) return;
    el.disabled = true;
    const { error } = await sb.rpc("letter_report", { p_id: el.dataset.id });
    if (error) { el.disabled = false; return toast("Couldn't report it. Check your connection and try again."); }
    const l = P.letters.find((x) => x.id === el.dataset.id); if (l) l.reported_at = new Date().toISOString();
    toast("Thanks. The admins will take a look."); render();
  }
});

// ---------------------------------------------------------------------------
// Calligraphy School 书法学校 (Zest Town; beta for admins from 22 Nov 2026, live for everyone since 23 Nov)
// Look up any character: stroke order player + write it yourself (Hanzi Writer quiz).
// Character box 漢字: the School's own writing deck (table char_box), kept apart from the Flashcard Center,
// the HSK Temple and XP (but writing a character counts for the streak tree since 24 Nov). Stages: 0 outline shown → 1 only the radical → 2 from memory.
// Stroke data: hanzi-writer-data (Make Me a Hanzi, Arphic PL) fetched from jsDelivr per character.
// Character info: table char_info + hsk_words via char_lookup(). No audio on purpose.
// ---------------------------------------------------------------------------
const calligOpen = () => true; // live for everyone with Zest Town since 23 Nov 2026 (was admins only)
const CG_INK = "#2a2420", CG_CUR = "#c2410c", CG_FAINT = "#e8dcc8", CG_RAD = "#1b6f1b";
const CG_SPEEDS = [0.5, 1, 2];
const CG_STAGE = ["Outline shown", "Radical shown", "From memory"];
const CG_MASTER_DAYS = 21; // from memory with the next review 3+ weeks away
const CG_NEW_PER_DAY = 10;  // new characters started per day (packages can add 100 at once)
const CG_KNOWN_DAYS = 90;   // "I already know it": straight to from memory, back in 90 days (like the HSK Temple)
const cgState = () => (state.cg ??= { text: null, info: new Map(), word: null, data: new Map(), err: null, idx: 0, k: 0, playing: false, run: 0, speed: 1,
  rad: lsGet("mz-cg-rad") !== "0", outline: true, finished: null, done: 0, mistakes: 0, writer: null,
  box: null, boxErr: false, rv: null });
const cgCJK = (s) => [...String(s || "")].filter((c) => /\p{Script=Han}/u.test(c)).join("").slice(0, 8);
// "You looked up": saved in char_recent so phone and computer show the same list (last 8).
const cgRecent = () => cgState().recent || [];
async function cgRecentLoad() {
  const S = cgState(); if (S.recentLoading) return; S.recentLoading = true;
  const { data, error } = await sb.from("char_recent").select("text, looked_at").eq("user_id", state.user.id).order("looked_at", { ascending: false }).limit(8);
  S.recentLoading = false; S.recent = error ? [] : data.map((r) => r.text);
  if (route() === "learn") render();
}
async function cgRemember(t) {
  qLog("cg_lookup", [...t].length);
  const S = cgState(); S.recent = [t, ...cgRecent().filter((x) => x !== t)].slice(0, 8);
  await sb.from("char_recent").upsert({ text: t, looked_at: new Date().toISOString() }, { onConflict: "user_id,text" });
  // keep the table short: drop anything older than the 8 newest
  const { data } = await sb.from("char_recent").select("text").eq("user_id", state.user.id).order("looked_at", { ascending: false }).range(8, 50);
  if (data?.length) await sb.from("char_recent").delete().eq("user_id", state.user.id).in("text", data.map((r) => r.text));
}
let cgHW = null;
const cgLib = async () => (cgHW ??= (await import("./vendor/hanzi-writer.js?v=147")).default);
const cgStrokes = async (c) => {
  const S = cgState(); if (S.data.has(c)) return S.data.get(c);
  const HW = await cgLib(); const d = await HW.loadCharacterData(c).catch(() => null);
  if (d) S.data.set(c, d); return d;
};

async function cgLoad(text) {
  const S = cgState();
  S.text = text; S.loading = true; S.info = new Map(); S.word = null; S.err = null; S.idx = 0; S.k = 0; S.playing = false; S.run++; S.finished = null;
  const chars = [...new Set(text)];
  try {
    const [{ data, error }, ...strokes] = await Promise.all([sb.rpc("char_lookup", { p_text: text }), ...chars.map(cgStrokes)]);
    if (S.text !== text) return;
    if (error) throw error;
    for (const i of data?.chars || []) S.info.set(i.ch, i);
    S.word = data?.word || null;
    const missing = chars.filter((c, j) => !strokes[j]);
    if (missing.length === chars.length) S.err = "nodata";
    else { if (missing.length) toast(`No stroke data for ${missing.join(" ")}.`); cgRemember(text); }
  } catch (e) { console.error(e); if (S.text === text) S.err = "load"; }
  if (S.text === text) { S.loading = false; render(); }
}

// ---- Character box: data and spaced repetition ----
async function cgBoxLoad() {
  const S = cgState(); if (S.boxLoading) return; S.boxLoading = true;
  const { data, error } = await sb.from("char_box").select("*").eq("user_id", state.user.id).order("created_at");
  S.boxLoading = false;
  if (error) { console.error(error); S.boxErr = true; S.box = []; } else S.box = data;
  if (route() === "learn") render();
}
const cgBoxHas = (c) => cgState().box?.some((r) => r.ch === c);
const cgIsNew = (r) => !r.reps && !r.first_review && !r.last_review;
// Today's round: every started character that's due, plus up to 10 new ones a day (oldest added first).
function cgDue() {
  const box = cgState().box || [], t = todayKey();
  const started = box.filter((r) => !cgIsNew(r) && r.due <= t);
  const room = Math.max(0, CG_NEW_PER_DAY - box.filter((r) => r.first_review === t).length);
  const fresh = box.filter((r) => cgIsNew(r) && r.due <= t).sort((a, b) => a.created_at.localeCompare(b.created_at)).slice(0, room);
  return [...started, ...fresh];
}
const cgNewWaiting = () => (cgState().box || []).filter(cgIsNew).length;
const cgMastered = (r) => r.stage === 2 && r.interval_days >= CG_MASTER_DAYS;
async function cgBoxAdd(c) {
  const i = cgState().info.get(c) || {};
  const n = await cgBoxAddMany([{ ch: c, pinyin: i.pinyin, meaning: i.meaning }]);
  if (n) toast(`${c} is in your character box.`); render();
}
// Add several characters (in order); known = already learned (from memory, back in 90 days).
async function cgBoxAddMany(list, known = false) {
  const S = cgState(), have = new Set((S.box || []).map((r) => r.ch)), t0 = Date.now();
  const rows = list.filter((x) => !have.has(x.ch)).map((x, j) => ({ ch: x.ch, pinyin: x.pinyin || "", meaning: x.meaning || "", due: todayKey(),
    created_at: new Date(t0 + j).toISOString(), ...(known ? cgKnownFields() : {}) }));
  if (!rows.length) return 0;
  const { data, error } = await sb.from("char_box").upsert(rows, { onConflict: "user_id,ch", ignoreDuplicates: true }).select("*");
  if (error) { console.error(error); toast("Couldn't add them. Check your connection."); return 0; }
  S.box = [...(S.box || []), ...(data || [])];
  if (!known && data?.length) qLog("cg_boxadd", data.length);
  return data?.length || 0;
}
const cgKnownFields = () => ({ stage: 2, interval_days: CG_KNOWN_DAYS, due: addDays(CG_KNOWN_DAYS), last_review: new Date().toISOString() });
async function cgBoxKnown(chars) {
  const S = cgState(), u = cgKnownFields();
  const { error } = await sb.from("char_box").update(u).eq("user_id", state.user.id).in("ch", chars);
  if (error) { toast("Couldn't save that. Check your connection."); return false; }
  for (const r of S.box || []) if (chars.includes(r.ch)) Object.assign(r, u);
  return true;
}
async function cgBoxRemoveMany(chars) {
  const S = cgState();
  const { error } = await sb.from("char_box").delete().eq("user_id", state.user.id).in("ch", chars);
  if (error) { toast("Couldn't remove them. Check your connection."); return false; }
  S.box = (S.box || []).filter((r) => !chars.includes(r.ch)); return true;
}
// ---- Character packages (table char_packages) ----
async function cgPacksLoad() {
  const S = cgState(); if (S.packsLoading) return; S.packsLoading = true;
  const { data, error } = await sb.from("char_packages").select("*").order("sort");
  S.packsLoading = false; S.packs = error ? [] : data;
  if (route() === "learn") render();
}
// A package's characters in the member's script (traditional members get 們 for 们), with pinyin and meaning.
async function cgPackChars(p) {
  const S = cgState(); S.packInfo ??= new Map();
  if (S.packInfo.has(p.id)) return S.packInfo.get(p.id);
  const { data, error } = await sb.rpc("char_lookup", { p_text: p.chars });
  if (error) { console.error(error); return null; }
  const info = new Map((data?.chars || []).map((i) => [i.ch, i]));
  const list = [...p.chars].map((c) => { const i = info.get(c) || {}; return { ch: trad() && i.trad ? i.trad : c, pinyin: i.pinyin || "", meaning: i.meaning || "" }; });
  S.packInfo.set(p.id, list);
  return list;
}
async function cgBoxRemove(c) {
  const S = cgState();
  const { error } = await sb.from("char_box").delete().eq("user_id", state.user.id).eq("ch", c);
  if (error) { toast("Couldn't remove it. Check your connection."); return; }
  S.box = (S.box || []).filter((r) => r.ch !== c); toast(`${c} left your character box.`); render();
}
// Grade from the writing: 0 = again (3+ mistakes or "I forgot"), 1 = hard (1–2 mistakes), 2 = good (no mistake).
function cgSchedule(r, grade) {
  const u = { reps: r.reps + 1, last_review: new Date().toISOString(), stage: r.stage, interval_days: r.interval_days, ease: r.ease, lapses: r.lapses };
  if (r.stage === 0) { if (grade >= 1) { u.stage = 1; u.interval_days = 1; } else u.interval_days = 0; }
  else if (r.stage === 1) {
    if (grade === 2) { u.stage = 2; u.interval_days = 2; }
    else if (grade === 1) u.interval_days = 1;
    else { u.stage = 0; u.interval_days = 0; }
  } else {
    if (grade === 2) u.interval_days = Math.max(r.interval_days + 1, Math.round(Math.max(1, r.interval_days) * r.ease));
    else if (grade === 1) { u.interval_days = Math.max(1, Math.round(r.interval_days * 1.2)); u.ease = Math.max(1.3, r.ease - 0.15); }
    else { u.stage = 1; u.interval_days = 0; u.ease = Math.max(1.3, r.ease - 0.2); u.lapses = r.lapses + 1; }
  }
  u.due = addDays(u.interval_days);
  return u;
}
const cgWhen = (n) => n <= 0 ? "again today" : n === 1 ? "tomorrow" : n < 14 ? `in ${n} days` : n < 60 ? `in ${Math.round(n / 7)} weeks` : `in ${Math.round(n / 30)} months`;

// ---- drawing (Hanzi Writer data: 1024 box, y up, baseline at 900) ----
const cgLen = (m) => m.reduce((s, p, i) => i ? s + Math.hypot(p[0] - m[i - 1][0], p[1] - m[i - 1][1]) : 0, 0);
const cgGridLines = `<rect x="6" y="6" width="1012" height="1012" fill="none" stroke="#c98a7e" stroke-width="12"/>
  <path d="M6 6 L1018 1018 M1018 6 L6 1018 M512 6 V1018 M6 512 H1018" stroke="#dcaea4" stroke-width="5" stroke-dasharray="26 20" fill="none"/>`;
function cgColor(d, i, k, rad) { return i < k ? (rad && d.radStrokes?.includes(i) ? CG_RAD : CG_INK) : null; }
// Which strokes a guide shows: "all" (outline), "radical" (its radical; the first strokes if it has none), "none".
function cgGuideSet(d, mode) {
  if (mode === "all") return d.strokes.map((_, i) => i);
  if (mode !== "radical") return [];
  const r = d.radStrokes || [];
  return r.length && r.length < d.strokes.length ? r : d.strokes.map((_, i) => i).slice(0, Math.max(1, Math.floor(d.strokes.length / 3)));
}
const cgGuideLabel = (d) => { const r = d.radStrokes || []; return r.length && r.length < d.strokes.length ? "Only the radical is shown" : "Only the first strokes are shown"; };
// Small static grid: strokes before upto in ink, stroke cur in vermilion (the "every stroke" strip, the done card).
function cgMini(d, upto, cur, rad) {
  const paths = d.strokes.map((p, i) => { const c = i === cur ? CG_CUR : cgColor(d, i, upto, rad); return c ? `<path d="${p}" fill="${c}"/>` : ""; }).join("");
  return `<svg class="cggrid" viewBox="0 0 1024 1024" aria-hidden="true">${cgGridLines}<g transform="translate(0,900) scale(1,-1)">${paths}</g></svg>`;
}
// The big player: every stroke is a thick median line clipped to the stroke's shape, drawn by animating its dash offset.
function cgPlayer(d, ch) {
  const S = cgState();
  const parts = d.strokes.map((p, i) => {
    const m = d.medians[i], L = Math.ceil(cgLen(m)) + 10, col = cgColor(d, i, S.k, S.rad) || CG_INK;
    return `<path d="${p}" fill="${CG_FAINT}"/><clipPath id="cgclip${i}"><path d="${p}"/></clipPath>
      <path class="cgfg" data-i="${i}" data-l="${L}" d="M${m.map((q) => q.join(" ")).join(" L")}" fill="none" stroke="${col}" stroke-width="200" stroke-linecap="round" stroke-linejoin="round" clip-path="url(#cgclip${i})" stroke-dasharray="${L} ${L}" stroke-dashoffset="${i < S.k ? 0 : L}"/>`;
  }).join("");
  return `<svg class="cggrid big" viewBox="0 0 1024 1024" role="img" aria-label="Stroke order of ${esc(ch)}">${cgGridLines}<g transform="translate(0,900) scale(1,-1)">${parts}</g></svg>`;
}
function cgPaint() { // static state after a jump, a step back or a restart
  const S = cgState(), d = S.data.get(S.text?.[S.idx]); if (!d) return;
  document.querySelectorAll(".cgfg").forEach((el) => {
    const i = +el.dataset.i; el.style.transition = "none";
    el.style.strokeDashoffset = i < S.k ? 0 : el.dataset.l; el.style.stroke = cgColor(d, i, S.k, S.rad) || CG_INK;
  });
  cgSync();
}
function cgSync() { // labels and buttons, without a full render (keeps the animation running)
  const S = cgState(), d = S.data.get(S.text?.[S.idx]); if (!d) return;
  const n = d.strokes.length, lab = document.getElementById("cglabel");
  if (lab) lab.innerHTML = S.k ? `<b>Stroke ${S.k} of ${n}</b>` : `<b>${n} strokes</b> · press play`;
  const pb = document.getElementById("cgplay");
  if (pb) { pb.innerHTML = S.playing ? ICON_CG.pause : ICON_CG.play; pb.setAttribute("aria-label", S.playing ? "Pause" : "Play"); }
  document.querySelectorAll(".cgstep").forEach((b) => b.classList.toggle("on", +b.dataset.i === S.k));
}
const cgSleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function cgStroke(i, run) {
  const S = cgState(), el = document.querySelector(`.cgfg[data-i="${i}"]`); if (!el) return;
  const L = +el.dataset.l, dur = Math.max(320, L * 0.9) / S.speed;
  const lab = document.getElementById("cglabel"); if (lab) lab.innerHTML = `<b>Stroke ${i + 1} of ${document.querySelectorAll(".cgfg").length}</b>`;
  el.style.transition = "none"; el.style.stroke = CG_CUR; el.style.strokeDashoffset = L;
  el.getBoundingClientRect();
  el.style.transition = `stroke-dashoffset ${dur}ms linear`; el.style.strokeDashoffset = 0;
  await cgSleep(dur);
  if (run !== S.run) return;
  const d = S.data.get(S.text[S.idx]), fin = document.querySelector(`.cgfg[data-i="${i}"]`);
  if (fin) { fin.style.transition = "none"; fin.style.strokeDashoffset = 0; fin.style.stroke = cgColor(d, i, i + 1, S.rad); }
}
async function cgPlay() {
  const S = cgState(), d = S.data.get(S.text[S.idx]); if (!d) return;
  const run = ++S.run; S.playing = true;
  if (S.k >= d.strokes.length) { S.k = 0; cgPaint(); await cgSleep(250); }
  cgSync();
  while (S.playing && run === S.run && S.k < d.strokes.length) {
    await cgStroke(S.k, run);
    if (run !== S.run) return;
    S.k++; cgSync();
    await cgSleep(260 / S.speed);
  }
  if (run === S.run) { S.playing = false; cgSync(); }
}
const cgStop = () => { const S = cgState(); S.run++; S.playing = false; };

// ---- views ----
const ICON_CG = {
  play: `<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M8 5v14l11-7z" fill="currentColor"/></svg>`,
  pause: `<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z" fill="currentColor"/></svg>`,
  prev: `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M15 6l-6 6 6 6" stroke="currentColor" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  next: `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M9 6l6 6-6 6" stroke="currentColor" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  restart: `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v4.5h4.5" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  brush: `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M14 4l6 6-7.5 7.5-6-6z" stroke="currentColor" stroke-width="2" fill="none" stroke-linejoin="round"/><path d="M6.5 11.5c-3 1-3.5 4-3.5 8.5 4.5 0 7.5-.5 8.5-3.5" stroke="currentColor" stroke-width="2" fill="none" stroke-linejoin="round"/></svg>`,
  search: `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><circle cx="11" cy="11" r="6.5" stroke="currentColor" stroke-width="2.2" fill="none"/><path d="M16 16l4.5 4.5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>`,
};
// The Character box: a pixel-art wooden chest with a red 漢字 plate; the lid lifts and sparkles twinkle.
const CG_CHEST = `<svg class="cgchest" viewBox="0 0 48 40" aria-hidden="true" shape-rendering="crispEdges">
  <g class="cgspark"><rect x="7" y="4" width="2" height="2" fill="#ffd95a"/><rect x="38" y="2" width="2" height="2" fill="#ffd95a"/><rect x="43" y="10" width="1" height="1" fill="#fff4b8"/><rect x="3" y="12" width="1" height="1" fill="#fff4b8"/></g>
  <g class="cglid"><rect x="6" y="9" width="36" height="9" fill="#3b2412"/><rect x="7" y="10" width="34" height="7" fill="#a5642f"/><rect x="7" y="10" width="34" height="2" fill="#c98446"/>
    <rect x="7" y="15" width="34" height="2" fill="#7a4520"/><rect x="11" y="10" width="2" height="7" fill="#e0b24a"/><rect x="35" y="10" width="2" height="7" fill="#e0b24a"/></g>
  <rect x="7" y="18" width="34" height="2" fill="#f6d77a" class="cgglow"/>
  <rect x="5" y="19" width="38" height="18" fill="#3b2412"/><rect x="6" y="20" width="36" height="16" fill="#8a4f25"/><rect x="6" y="20" width="36" height="2" fill="#a5642f"/>
  <rect x="6" y="34" width="36" height="2" fill="#6b3a18"/><rect x="10" y="20" width="2" height="16" fill="#e0b24a"/><rect x="36" y="20" width="2" height="16" fill="#e0b24a"/>
  <rect x="14" y="22" width="20" height="11" fill="#3b2412"/><rect x="15" y="23" width="18" height="9" fill="#c23b3b"/><rect x="15" y="23" width="18" height="1" fill="#e0605a"/>
  <rect x="4" y="37" width="40" height="2" fill="#000" opacity=".12"/>
  <text x="24" y="30.3" text-anchor="middle" font-size="7" font-weight="700" fill="#fdf3ee" font-family="'Noto Sans TC','Noto Sans SC',sans-serif" shape-rendering="auto">漢字</text>
</svg>`;
const cgTitle = () => `Calligraphy School <span class='zhsub'>${trad() ? "書法學校" : "书法学校"}</span>`;
const cgHead = (href, label, title = cgTitle()) => `<header class="zthead"><a class="ztback" href="${href}">‹ ${label}</a><h1>${title}</h1></header>`;
const cgSearch = (val = "") => `<form class="cgsearch" data-cgform><label class="cgsbox"><span aria-hidden="true">${ICON_CG.search}</span>
  <input name="q" class="cgin" value="${esc(val)}" placeholder="Type character" aria-label="Type character" autocomplete="off" lang="zh"></label><button class="btn" type="submit">Show character information</button></form>`;
const cgHref = (t, write) => `#/learn/callig/${encodeURIComponent(t)}${write ? "/write" : ""}`;

function calligView(parts) {
  if (!calligOpen()) { location.hash = "#/learn"; return townView(); }
  const S = cgState();
  if (!S.box) { cgBoxLoad(); }
  const [t, mode] = parts.map((x) => { try { return decodeURIComponent(x); } catch { return x; } });
  if (t === "box") return mode === "review" ? cgReviewView() : cgBoxView();
  if (t === "pack") return cgPackView(mode);
  if (t === "course") return coView(mode, parts[2]);
  const text = cgCJK(t);
  if (!text) return cgHomeView();
  if (S.text !== text) cgLoad(text);
  if (S.loading) return `${cgHead("#/learn/callig", "Calligraphy School")}<p class="muted small">Opening ${esc(text)}…</p>`;
  if (S.err) return `${cgHead("#/learn/callig", "Calligraphy School")}${cgSearch(text)}<div class="card"><b>${S.err === "nodata" ? "No stroke order for that yet" : "Couldn't load that character"}</b><p class="small muted" style="margin:4px 0 0">${S.err === "nodata" ? "We have about 9,500 common characters, simplified and traditional. Try another one." : "Check your connection and try again."}</p></div>`;
  if (S.idx >= text.length) S.idx = 0;
  if (!S.data.get(text[S.idx])) S.idx = [...text].findIndex((c) => S.data.get(c));
  return mode === "write" ? cgWriteView() : cgWatchView();
}

function cgBoxCard() {
  const S = cgState(), n = S.box?.length || 0, due = S.box ? cgDue().length : 0;
  const line = !S.box ? "Opening your box…" : !n ? "Empty for now. Look up a character and add it to your box." : due ? `${due} character${due === 1 ? "" : "s"} to write today` : "All written for today. Come back tomorrow.";
  return `<a class="card cgbox" href="#/learn/callig/box"><span class="cgchestwrap">${CG_CHEST}${due ? `<em class="cgdue">${due}</em>` : ""}</span>
    <span class="grow"><b class="cgboxt">Character box <span class="cgzh">漢字</span></b><br><span class="small">${line}</span>${n ? `<br><span class="small muted">${n} character${n === 1 ? "" : "s"} in your box</span>` : ""}</span>
    <span class="btn small">${due ? "Write" : "Open"}</span></a>`;
}

function cgPacksSection() {
  const S = cgState();
  if (!S.packs) { cgPacksLoad(); return ""; }
  if (!S.packs.length) return "";
  const have = new Set((S.box || []).map((r) => r.ch));
  return `<section><h2 class="cgh">Character packages</h2><div class="stack" style="gap:8px">${S.packs.map((p) => {
    const chars = [...p.chars], list = S.packInfo?.get(p.id);
    if (!list) cgPackChars(p).then((l) => { if (l) render(); });
    const n = list ? list.filter((x) => have.has(x.ch)).length : 0;
    return `<a class="card cgpack" href="#/learn/callig/pack/${esc(p.id)}"><span class="cgpackic cgzh" aria-hidden="true">${(list || chars.map((ch) => ({ ch }))).slice(0, 4).map((x) => `<span>${esc(x.ch)}</span>`).join("")}</span>
      <span class="grow"><b>${esc(p.title)}</b> <span class="cgzh muted small">${esc(p.title_zh)}</span><br><span class="small muted">${esc(p.subtitle)}</span>
      <br><span class="tiny ${n ? "cgok" : "muted"}">${n ? `${n} of ${chars.length} in your box` : `${chars.length} characters`}</span></span><span class="btn small ghost">Open</span></a>`;
  }).join("")}</div></section>`;
}

function cgPackView(id) {
  const S = cgState(), head = cgHead("#/learn/callig", "Calligraphy School", `Character package`);
  if (!S.packs) { cgPacksLoad(); return `${head}<p class="muted small">Opening…</p>`; }
  const p = S.packs.find((x) => x.id === id);
  if (!p) return `${head}<p class="muted">This package isn't available.</p>`;
  const list = S.packInfo?.get(p.id);
  if (!list) { cgPackChars(p).then(() => render()); return `${head}<p class="muted small">Opening ${esc(p.title)}…</p>`; }
  if (!S.box) return `${head}<p class="muted small">Opening your box…</p>`;
  const byCh = new Map(S.box.map((r) => [r.ch, r])), sel = S.packSel?.id === p.id ? S.packSel.set : null;
  const missing = list.filter((x) => !byCh.has(x.ch));
  const tiles = list.map((x) => { const r = byCh.get(x.ch), cls = !r ? "out" : cgMastered(r) ? "m" : `s${r.stage}`;
    return sel ? `<button type="button" class="cgbtile ${cls} ${sel.has(x.ch) ? "sel" : ""}" data-cg="psel" data-c="${esc(x.ch)}" aria-pressed="${sel.has(x.ch)}">${esc(x.ch)}</button>`
      : `<a class="cgbtile ${cls}" href="${cgHref(x.ch)}" title="${esc(py(x.pinyin))} · ${esc(x.meaning)}">${esc(x.ch)}</a>`; }).join("");
  const bar = sel ? `<div class="cgselbar"><span class="small"><b>${sel.size}</b> selected</span>
      <button type="button" class="linkbtn" data-cg="pselall">${sel.size === list.length ? "Select none" : "Select all"}</button>
      <button type="button" class="btn small" data-cg="padd" ${sel.size ? "" : "disabled"}>Add to my box</button>
      <button type="button" class="btn small ghost" data-cg="pknown" ${sel.size ? "" : "disabled"}>I already know these</button>
      <button type="button" class="linkbtn" data-cg="pselx">Cancel</button></div>`
    : `<div class="row" style="gap:8px;flex-wrap:wrap">${missing.length ? `<button type="button" class="btn" data-cg="paddall">Add the ${missing.length === list.length ? "" : "other "}${missing.length} to my box</button>` : `<span class="lindeck">✓ All in your box</span>`}
      <button type="button" class="btn ghost" data-cg="psel">Choose characters</button></div>`;
  return `${head}
    <section class="card cgpackhead"><div class="cgpackbig cgzh" aria-hidden="true">${list.slice(0, 4).map((x) => `<span>${esc(x.ch)}</span>`).join("")}</div><div><h2 style="margin:0">${esc(p.title)}</h2><p class="cgzh muted" style="margin:2px 0 0">${esc(p.title_zh)}</p>
      <p class="small" style="margin:6px 0 0">${esc(p.subtitle)}. ${list.length} characters, most frequent first.</p></div></section>
    <p class="small muted" style="margin:0">Characters you add start in your box ${CG_NEW_PER_DAY} a day, in this order. Already know some? Choose them and tap “I already know these”: they won't show up in your daily writing.</p>
    ${bar}
    <div class="cglegend"><span><i class="out"></i>Not in your box ${missing.length}</span><span><i class="s0"></i>Outline</span><span><i class="s1"></i>Radical</span><span><i class="s2"></i>From memory</span><span><i class="m"></i>Learned</span></div>
    <div class="cgbtiles">${tiles}</div>`;
}

function cgHomeView() {
  const S = cgState();
  if (!S.recentAt || Date.now() - S.recentAt > 30e3) { S.recentAt = Date.now(); cgRecentLoad(); } // picks up the other device's look-ups
  const recent = cgRecent();
  return `${cgHead("#/learn", "Zest Town")}
    <div class="ztthead"><span class="ztplaceart">${ztImg("callig")}</span><span class="small muted">Learn to write characters the right way, one stroke at a time, and keep the ones you want to master in your character box.</span></div>
    ${cgSearch()}
    ${recent.length ? `<section><h2 class="cgh">You looked up</h2><div class="cgrecent">${recent.map((w) => `<a href="${cgHref(w)}">${esc(w)}</a>`).join("")}</div></section>` : ""}
    ${cgBoxCard()}
    ${cgPacksSection()}
    <section><h2 class="cgh">Classes</h2>
      ${coOpen() ? coCard() : ""}
      <div class="card cgclass soon"><span class="cgclassic">部</span><span class="grow"><b>More classes</b><br><span class="small muted">Coming later to the School</span></span><span class="ztsoon">Soon</span></div>
    </section>`;
}

function cgInfoCard(ch, d) {
  const S = cgState(), i = S.info.get(ch) || {}, other = i.trad || i.simp;
  const tags = [i.hsk ? `<span class="ltag hsk">HSK ${esc(i.hsk)}</span>` : "", `<span class="ltag">${d.strokes.length} strokes</span>`,
    i.radical && i.radical !== ch ? `<span class="ltag">Radical <span class="cgzh">${esc(i.radical)}</span>${i.radical_meaning ? ` ${esc(i.radical_meaning)}` : ""}</span>` : i.radical === ch ? `<span class="ltag">It's a radical itself</span>` : "",
    other ? `<a class="ltag cgalt" href="${cgHref([...S.text].map((c) => { const x = S.info.get(c); return x?.trad || x?.simp || c; }).join(""))}">${i.trad ? "Traditional" : "Simplified"} <span class="cgzh">${esc(other)}</span> ›</a>` : ""].join("");
  const inBox = cgBoxHas(ch);
  return `<div class="card cginfo">
    <div class="cginfotop"><span class="cgzh cgbig">${esc(ch)}</span><b class="cgpy">${esc(py(i.pinyin || ""))}</b><span class="muted">${esc(i.meaning || "")}</span></div>
    <div class="row" style="gap:6px;flex-wrap:wrap">${tags}</div>
    ${S.rad && i.radical && i.radical !== ch && d.radStrokes?.length ? `<p class="tiny muted" style="margin:0">The radical's strokes turn green.</p>` : ""}
    <div class="row" style="gap:8px;flex-wrap:wrap"><a class="btn" href="${cgHref(S.text, true)}">${ICON_CG.brush} Write it myself</a>
    ${!S.box ? "" : inBox ? `<span class="lindeck">✓ In your character box</span>${cgMastered(S.box.find((r) => r.ch === ch)) ? "" : `<button type="button" class="linkbtn" data-cg="cknown" data-c="${esc(ch)}">Mark as learned</button>`}<button type="button" class="linkbtn" data-cg="boxdel" data-c="${esc(ch)}">Remove</button>`
      : `<button type="button" class="btn ghost" data-cg="boxadd" data-c="${esc(ch)}">+ Add <span class="cgzh">${esc(ch)}</span> to my character box</button>`}</div>
  </div>`;
}

function cgWatchView() {
  cgState().finished = null;
  const S = cgState(), ch = S.text[S.idx], d = S.data.get(ch), n = d.strokes.length;
  const tabs = S.text.length > 1 ? `<div class="cgtabs" role="group" aria-label="Characters">${[...S.text].map((c, j) => `<button type="button" class="cgtab" data-cg="tab" data-i="${j}" aria-pressed="${j === S.idx}" ${S.data.get(c) ? "" : "disabled"}>${esc(c)}</button>`).join("")}
    ${S.word ? `<span class="small muted">${esc(py(S.word.pinyin))} · ${esc(S.word.meaning)}</span>` : ""}</div>` : "";
  const strip = [...Array(n)].map((_, i) => `<button type="button" class="cgstep ${i === S.k - 1 ? "on" : ""}" data-cg="jump" data-i="${i + 1}" aria-label="Up to stroke ${i + 1}">${cgMini(d, i, i, S.rad)}<span>${i + 1}</span></button>`).join("");
  const player = `<section class="card cgplayer">
    <div class="cggridwrap">${cgPlayer(d, ch)}</div>
    <div id="cglabel" class="cglabel" aria-live="polite"></div>
    <div class="cgctrls">
      <button type="button" class="cgrb" data-cg="restart" aria-label="Start again">${ICON_CG.restart}</button>
      <button type="button" class="cgrb" data-cg="prev" aria-label="Previous stroke">${ICON_CG.prev}</button>
      <button type="button" class="cgrb main" id="cgplay" data-cg="play" aria-label="Play">${ICON_CG.play}</button>
      <button type="button" class="cgrb" data-cg="next" aria-label="Next stroke">${ICON_CG.next}</button>
      <button type="button" class="cgrb speed" data-cg="speed" aria-label="Speed">${S.speed}×</button>
    </div>
    <label class="cgcheck"><input type="checkbox" data-cg="rad" ${S.rad ? "checked" : ""}> Show the radical in green</label>
  </section>`;
  const side = `${cgInfoCard(ch, d)}
    <section class="card"><div class="row between" style="align-items:baseline;margin-bottom:10px"><b>Every stroke</b><span class="tiny muted">tap one to jump there</span></div><div class="cgstrip">${strip}</div></section>
    ${S.idx < S.text.length - 1 ? `<button type="button" class="linkbtn cgnext" data-cg="tab" data-i="${S.idx + 1}">Next: <span class="cgzh">${esc(S.text[S.idx + 1])}</span> ›</button>` : ""}`;
  return `${cgHead("#/learn/callig", "Calligraphy School")}${cgSearch(S.text)}${tabs}
    ${wide() ? `<div class="cgcols"><div>${player}</div><div class="stack" style="gap:14px;min-width:0">${side}</div></div>` : `${player}${side}`}`;
}

// The writing area: rice-paper grid + our own guide strokes underneath, Hanzi Writer's quiz on top (mounted after render).
function cgQuizArea(ch, d, guide, hide, mode = "practice") {
  const set = new Set(cgGuideSet(d, guide));
  const g = d.strokes.map((p, i) => set.has(i) ? `<path d="${p}"/>` : "").join("");
  return `<div class="cgquizwrap"><svg class="cggrid" viewBox="0 0 1024 1024" aria-hidden="true">${cgGridLines}<g class="cgguide ${hide ? "off" : ""}" fill="#e6dccb" transform="translate(0,900) scale(1,-1)">${g}</g></svg>
    <div id="cgquiz" class="cgquiz" data-ch="${esc(ch)}" data-mode="${mode}" data-guide="${hide ? "none" : guide}" data-hints="${mode === "review" && guide !== "all" ? 0 : 2}" aria-label="Writing area"></div></div>`;
}
const cgBar = (n, done) => `<div class="cgbar" id="cgbar">${[...Array(n)].map((_, i) => `<span class="${i < done ? "ok" : i === done ? "cur" : ""}"></span>`).join("")}</div>`;

function cgWriteView() {
  const S = cgState(), ch = S.text[S.idx], d = S.data.get(ch), n = d.strokes.length;
  const back = `<a class="ztback" href="${cgHref(S.text)}">‹ ${esc(ch)} · character information</a>`;
  if (S.finished) {
    const good = S.finished.mistakes <= 1, nextJ = [...S.text].findIndex((c, j) => j > S.idx && S.data.get(c));
    return `${back}<section class="card cgdone">
      <div class="cgdonegrid">${cgMini(d, n, -1, S.rad)}<span class="cgseal ${good ? "" : "two"}" aria-hidden="true">${good ? "好" : "加油"}</span></div>
      <h2>${good ? "Beautifully written!" : "Done! Keep practising"}</h2>
      <p class="muted" style="margin:0">${n} strokes · ${S.finished.mistakes} mistake${S.finished.mistakes === 1 ? "" : "s"}</p>
      <div class="row" style="gap:8px;width:100%"><button type="button" class="btn ghost grow" data-cg="again">Again</button>
      ${nextJ > 0 ? `<button type="button" class="btn grow" data-cg="wnext" data-i="${nextJ}">Next: <span class="cgzh">${esc(S.text[nextJ])}</span></button>` : `<a class="btn grow" href="#/learn/callig">Another character</a>`}</div>
      ${S.outline ? `<button type="button" class="btn ghost block" data-cg="again-bare">Again, without the outline</button>` : ""}
      ${S.box && !cgBoxHas(ch) ? `<button type="button" class="btn ghost block" data-cg="boxadd" data-c="${esc(ch)}">+ Add <span class="cgzh">${esc(ch)}</span> to my character box</button>` : ""}
    </section>`;
  }
  return `${back}
    <div><h1 class="cgwh">Your turn: write <span class="cgzh">${esc(ch)}</span></h1><p class="small muted" style="margin:4px 0 0">Draw each stroke in order with your finger or mouse. A wrong stroke fades away; after 2 misses the hint shows the way.</p></div>
    ${cgBar(n, 0)}
    ${cgQuizArea(ch, d, "all", !S.outline)}
    <div class="row between small"><span id="cgcount"><b>0 of ${n}</b> strokes</span><span class="muted" id="cgmiss">0 mistakes</span></div>
    <div class="row" style="gap:8px">
      <button type="button" class="btn ghost grow" data-cg="hint">Hint</button>
      <button type="button" class="btn ghost grow ${S.outline ? "cgon" : ""}" data-cg="outline" aria-pressed="${S.outline}">Outline ${S.outline ? "on" : "off"}</button>
      <button type="button" class="cgrb" data-cg="again" aria-label="Start again">${ICON_CG.restart}</button>
    </div>`;
}

function cgBoxView() {
  const S = cgState(), head = cgHead("#/learn/callig", "Calligraphy School", `Character box <span class='zhsub'>漢字</span>`);
  if (!S.box) return `${head}<p class="muted small">Opening your box…</p>`;
  const due = cgDue(), box = S.box;
  const cnt = [0, 1, 2].map((st) => box.filter((r) => r.stage === st && !cgMastered(r)).length), mast = box.filter(cgMastered).length;
  const sel = S.boxSel, dueSet = new Set(due.map((r) => r.ch)), waiting = cgNewWaiting();
  const tiles = box.map((r) => { const cls = cgMastered(r) ? "m" : `s${r.stage}`, dot = dueSet.has(r.ch) ? `<i aria-label="due today"></i>` : "";
    return sel ? `<button type="button" class="cgbtile ${cls} ${sel.has(r.ch) ? "sel" : ""}" data-cg="bsel" data-c="${esc(r.ch)}" aria-pressed="${sel.has(r.ch)}">${esc(r.ch)}</button>`
      : `<a class="cgbtile ${cls}" href="${cgHref(r.ch)}" title="${esc(cgIsNew(r) ? "New" : CG_STAGE[r.stage])} · ${dueSet.has(r.ch) ? "today" : cgIsNew(r) ? "waiting" : "next " + esc(r.due)}">${esc(r.ch)}${dot}</a>`; }).join("");
  const bar = sel ? `<div class="cgselbar"><span class="small"><b>${sel.size}</b> selected</span>
      <button type="button" class="linkbtn" data-cg="bselall">${sel.size === box.length ? "Select none" : "Select all"}</button>
      <button type="button" class="btn small" data-cg="bknown" ${sel.size ? "" : "disabled"}>Mark as learned</button>
      <button type="button" class="btn small ghost" data-cg="bdel" ${sel.size ? "" : "disabled"}>Remove</button>
      <button type="button" class="linkbtn" data-cg="bselx">Cancel</button></div>`
    : `<div class="row between" style="align-items:center"><span class="tiny muted">Tap a character for its stroke order. A dot means it's in today's round.</span><button type="button" class="btn small ghost" data-cg="bsel">Select</button></div>`;
  return `${head}
    <div class="cgboxhead">${CG_CHEST}<p class="small muted" style="margin:0">Your own writing deck, separate from the Flashcard Center. Each character starts with its outline, then only its radical, then you write it from memory. Good writing sends it further into the future.</p></div>
    <section class="card cgboxdue">${due.length ? `<div><b style="font-size:18px">${due.length} to write today</b><br><span class="small muted">You see the ${pyName()} and the meaning, and write the character.${waiting > due.filter(cgIsNew).length ? ` ${waiting - due.filter(cgIsNew).length} new ones are waiting: they come ${CG_NEW_PER_DAY} a day.` : ""}</span></div><a class="btn" href="#/learn/callig/box/review">Start writing</a>`
      : `<div><b>All written for today</b><br><span class="small muted">${box.length ? "Come back tomorrow, or look up a new character to add." : "Look up a character in the School and tap “Add to my character box”."}</span></div><a class="btn ghost" href="#/learn/callig">Look up a character</a>`}</section>
    ${box.length ? `<section><div class="cglegend"><span><i class="s0"></i>Outline ${cnt[0]}</span><span><i class="s1"></i>Radical ${cnt[1]}</span><span><i class="s2"></i>From memory ${cnt[2]}</span><span><i class="m"></i>Mastered ${mast}</span></div>
      ${bar}<div class="cgbtiles" style="margin-top:10px">${tiles}</div>
      <p class="tiny muted" style="margin:8px 0 0">Already know some? Tap Select, choose them and “Mark as learned”: they leave your daily round and come back in ${CG_KNOWN_DAYS} days for a check.</p></section>` : ""}
    ${cgPacksSection()}`;
}

function cgReviewView() {
  const S = cgState(), head = `<a class="ztback" href="#/learn/callig/box">‹ Character box</a>`;
  if (!S.box) return `${head}<p class="muted small">Opening your box…</p>`;
  if (!S.rv) S.rv = { queue: cgDue().map((r) => r.ch), done: 0, result: null, forgot: false };
  const R = S.rv;
  if (!R.queue.length) { if (R.done && lsGet("mz-ql-box") !== todayKey()) { lsSet("mz-ql-box", todayKey()); qLog("cg_boxdone"); tEvent("cg_box", `${R.done} character${R.done === 1 ? "" : "s"}`); } S.rv = null; return `${head}<section class="card cgdone">${CG_CHEST}<h2>Box done for today!</h2><p class="muted" style="margin:0">${R.done ? `You wrote ${R.done} character${R.done === 1 ? "" : "s"}.` : "Nothing left to write today."} Come back tomorrow.</p><a class="btn" href="#/learn/callig">Back to the School</a></section>`; }
  const ch = R.queue[0], r = S.box.find((x) => x.ch === ch), d = S.data.get(ch);
  if (!r) { R.queue.shift(); return cgReviewView(); }
  if (!d) { cgStrokes(ch).then((x) => { if (!x) { R.queue.shift(); toast(`No stroke data for ${ch}.`); } render(); }); return `${head}<p class="muted small">Opening ${esc(ch)}…</p>`; }
  const n = d.strokes.length, left = R.queue.length;
  const prompt = `<div class="cgprompt"><b class="cgpy">${esc(py(r.pinyin) || "?")}</b><span>${esc(r.meaning || "")}</span><span class="tiny muted">${n} strokes</span></div>`;
  if (R.result) {
    const g = R.result.grade, msg = ["Write it again soon", "Not bad", "Perfect"][g];
    return `${head}<section class="card cgdone">
      <div class="cgdonegrid">${cgMini(d, n, -1, false)}<span class="cgseal ${g === 2 ? "" : "two"}" aria-hidden="true">${g === 2 ? "好" : g === 1 ? "不错" : "加油"}</span></div>
      <h2>${msg}</h2>
      <p class="muted" style="margin:0"><span class="cgzh">${esc(ch)}</span> · ${esc(py(r.pinyin))} · ${R.result.forgot ? "you peeked" : `${R.result.mistakes} mistake${R.result.mistakes === 1 ? "" : "s"}`}</p>
      <p class="small" style="margin:0">${R.result.stageUp ? `Next time: <b>${esc(CG_STAGE[R.result.u.stage].toLowerCase())}</b>. ` : R.result.stageDown ? `Back to <b>${esc(CG_STAGE[R.result.u.stage].toLowerCase())}</b>. ` : ""}Comes back <b>${cgWhen(R.result.u.interval_days)}</b>.</p>
      <button type="button" class="btn block" data-cg="rvnext">${left > 1 || R.result.u.interval_days <= 0 ? "Next character" : "Finish"}</button>
    </section>`;
  }
  const guide = R.forgot ? "all" : ["all", "radical", "none"][r.stage];
  const note = R.forgot ? "Outline shown: trace it, it'll come back soon." : r.stage === 0 ? "Trace it over the outline." : r.stage === 1 ? `${cgGuideLabel(d)}. Write the whole character.` : "From memory: no help this time.";
  return `${head}
    <div class="row between" style="align-items:center"><span class="ltag">${esc(CG_STAGE[r.stage])}</span><span class="small muted">${left} left</span></div>
    ${prompt}
    ${cgBar(n, 0)}
    ${cgQuizArea(ch, d, guide, false, "review")}
    <p class="small muted" style="margin:0;text-align:center">${note}</p>
    <div class="row between small"><span id="cgcount"><b>0 of ${n}</b> strokes</span><span class="muted" id="cgmiss">0 mistakes</span></div>
    ${r.stage > 0 && !R.forgot ? `<button type="button" class="btn ghost block" data-cg="forgot">I don't remember, show me</button>` : ""}
    <button type="button" class="linkbtn cgknown" data-cg="rvknown">I already know this character</button>`;
}

// Mount the Hanzi Writer quiz after each render of a writing page (a re-render starts the character again).
function cgAfterRender() { if (route() !== "learn") return; if (document.getElementById("cglabel")) cgSync(); cgMount(); }
async function cgMount() {
  const el = document.getElementById("cgquiz");
  if (!el || el.dataset.on) return;
  el.dataset.on = "1";
  const S = cgState(), ch = el.dataset.ch, d = S.data.get(ch), n = d.strokes.length, review = el.dataset.mode === "review";
  const HW = await cgLib(); if (!el.isConnected) return;
  S.done = 0; S.mistakes = 0;
  const size = Math.round(el.getBoundingClientRect().width) || 300;
  S.writer = HW.create(el, ch, {
    width: size, height: size, padding: 0, showCharacter: false, showOutline: false, showHintAfterMisses: +el.dataset.hints || false,
    strokeColor: CG_INK, radicalColor: !review && S.rad ? CG_RAD : null, drawingColor: "#3b5ba5", drawingWidth: Math.max(16, size / 18),
    highlightColor: CG_CUR, charDataLoader: (c, ok) => ok(S.data.get(c)),
  });
  const upd = () => {
    const bar = document.getElementById("cgbar"); if (bar) [...bar.children].forEach((s, i) => { s.className = i < S.done ? "ok" : i === S.done ? "cur" : ""; });
    const c = document.getElementById("cgcount"); if (c) c.innerHTML = `<b>${S.done} of ${n}</b> strokes`;
    const m = document.getElementById("cgmiss"); if (m) m.textContent = `${S.mistakes} mistake${S.mistakes === 1 ? "" : "s"}`;
  };
  S.writer.quiz({
    onMistake: (x) => { S.mistakes = x.totalMistakes; upd(); },
    onCorrectStroke: (x) => { S.mistakes = x.totalMistakes; S.done = x.strokeNum + 1; upd(); },
    onComplete: (x) => {
      qLog("cg_write"); if (el.dataset.guide !== "all") qLog("cg_nooutline");
      ztCountDay().then((grew) => { if (grew) toast("Character written. Your streak tree grew today 🌱"); });
      if (review) cgReviewDone(ch, x.totalMistakes);
      else { S.finished = { mistakes: x.totalMistakes }; setTimeout(() => { if (route() === "learn") render(); }, 700); }
    },
  });
}
async function cgReviewDone(ch, mistakes) {
  const S = cgState(), R = S.rv, r = S.box.find((x) => x.ch === ch); if (!R || !r) return;
  const grade = R.forgot || mistakes >= 3 ? 0 : mistakes ? 1 : 2;
  const u = cgSchedule(r, grade);
  if (!r.first_review) u.first_review = todayKey();
  R.result = { grade, mistakes, forgot: R.forgot, u, stageUp: u.stage > r.stage, stageDown: u.stage < r.stage };
  if (u.stage === 2 && r.stage < 2) qLog("cg_memory");
  Object.assign(r, u);
  const { error } = await sb.from("char_box").update(u).eq("user_id", state.user.id).eq("ch", ch);
  if (error) toast("Couldn't save that one. Check your connection.");
  setTimeout(() => { if (route() === "learn") render(); }, 700);
}

document.addEventListener("submit", (e) => {
  const f = e.target.closest("[data-cgform]"); if (!f) return;
  e.preventDefault();
  const t = cgCJK(f.q.value);
  if (!t) { toast("Type a Chinese character, for example 学."); return; }
  cgStop(); location.hash = cgHref(t);
});
document.addEventListener("change", (e) => {
  const t = e.target.closest('[data-cg="rad"]'); if (!t) return;
  const S = cgState(); S.rad = t.checked; lsSet("mz-cg-rad", S.rad ? null : "0"); cgStop(); render();
});
document.addEventListener("click", async (e) => {
  const el = e.target.closest("button[data-cg]"); if (!el) return;
  const S = cgState(), a = el.dataset.cg, d = S.text && S.data.get(S.text[S.idx]);
  if (a === "play") { if (S.playing) { cgStop(); S.k = Math.min(S.k + 1, d.strokes.length); cgPaint(); } else cgPlay(); }
  else if (a === "restart") { cgStop(); S.k = 0; cgPaint(); cgPlay(); }
  else if (a === "prev") { cgStop(); S.k = Math.max(0, S.k - 1); cgPaint(); }
  else if (a === "next") { cgStop(); if (S.k < d.strokes.length) { const run = S.run; cgSync(); await cgStroke(S.k, run); if (run === S.run) { S.k++; cgSync(); } } }
  else if (a === "jump") { cgStop(); S.k = +el.dataset.i; cgPaint(); }
  else if (a === "speed") { S.speed = CG_SPEEDS[(CG_SPEEDS.indexOf(S.speed) + 1) % CG_SPEEDS.length]; el.textContent = `${S.speed}×`; }
  else if (a === "tab") { cgStop(); S.idx = +el.dataset.i; S.k = 0; render(); scrollTo(0, 0); }
  else if (a === "boxadd") { el.disabled = true; await cgBoxAdd(el.dataset.c); }
  else if (a === "cknown") { if (await cgBoxKnown([el.dataset.c])) { toast(`${el.dataset.c} is marked as learned. It comes back in ${CG_KNOWN_DAYS} days.`); render(); } }
  else if (a === "bsel" || a === "psel") {
    const box = a === "bsel", key = box ? "boxSel" : "packSel", c = el.dataset.c, pid = location.hash.split("/pack/")[1];
    if (!c) { S[key] = box ? new Set() : { id: pid, set: new Set() }; }
    else { const set = box ? S.boxSel : S.packSel.set; set.has(c) ? set.delete(c) : set.add(c); }
    render();
  }
  else if (a === "bselall") { S.boxSel = S.boxSel.size === S.box.length ? new Set() : new Set(S.box.map((r) => r.ch)); render(); }
  else if (a === "pselall") { const list = S.packInfo.get(S.packSel.id); S.packSel.set = S.packSel.set.size === list.length ? new Set() : new Set(list.map((x) => x.ch)); render(); }
  else if (a === "bselx") { S.boxSel = null; render(); }
  else if (a === "pselx") { S.packSel = null; render(); }
  else if (a === "bknown" || a === "bdel") {
    const chars = [...S.boxSel]; if (!chars.length) return;
    if (a === "bdel" && !el.dataset.sure) { el.dataset.sure = "1"; el.textContent = `Tap again to remove ${chars.length}`; return; }
    const ok = a === "bknown" ? await cgBoxKnown(chars) : await cgBoxRemoveMany(chars);
    if (ok) { toast(a === "bknown" ? `${chars.length} marked as learned.` : `${chars.length} removed from your box.`); S.boxSel = null; S.rv = null; render(); }
  }
  else if (a === "paddall" || a === "padd" || a === "pknown") {
    const pid = location.hash.split("/pack/")[1], list = S.packInfo?.get(pid) || [];
    const chosen = a === "paddall" ? list : list.filter((x) => S.packSel?.set.has(x.ch));
    el.disabled = true;
    let n = 0;
    if (a === "pknown") {
      const inBox = chosen.filter((x) => cgBoxHas(x.ch)).map((x) => x.ch);
      if (inBox.length) await cgBoxKnown(inBox);
      n = inBox.length + await cgBoxAddMany(chosen.filter((x) => !inBox.includes(x.ch)), true);
      toast(`${n} marked as learned.`);
    } else { n = await cgBoxAddMany(chosen); if (n) { qLog("cg_pack", n); tEvent("cg_pack", `${n} characters`); } toast(n ? `${n} added to your box. They start ${CG_NEW_PER_DAY} a day.` : "They're already in your box."); }
    S.packSel = null; S.rv = null; render();
  }
  else if (a === "rvknown") {
    const R = S.rv; if (!R) return; const ch = R.queue[0];
    if (await cgBoxKnown([ch])) { R.queue.shift(); R.result = null; R.forgot = false; S.writer = null; toast(`${ch} is marked as learned.`); render(); scrollTo(0, 0); }
  }
  else if (a === "boxdel") { await cgBoxRemove(el.dataset.c); }
  else if (a === "hint") { if (S.writer && S.done < d.strokes.length) S.writer.highlightStroke(S.done); }
  else if (a === "outline") { S.outline = !S.outline; document.querySelector(".cgguide")?.classList.toggle("off", !S.outline); el.classList.toggle("cgon", S.outline); el.setAttribute("aria-pressed", S.outline); el.textContent = `Outline ${S.outline ? "on" : "off"}`; }
  else if (a === "again" || a === "again-bare") { if (a === "again-bare") S.outline = false; S.finished = null; S.writer = null; render(); }
  else if (a === "wnext") { S.idx = +el.dataset.i; S.k = 0; S.finished = null; S.writer = null; render(); }
  else if (a === "forgot") { if (S.rv) { S.rv.forgot = true; S.writer = null; render(); } }
  else if (a === "rvnext") {
    const R = S.rv; if (!R) return;
    const ch = R.queue.shift(), r = S.box.find((x) => x.ch === ch);
    if (R.result?.u.interval_days <= 0 && r) R.queue.push(ch); // not there yet: once more at the end of today's round
    R.done++; R.result = null; R.forgot = false; S.writer = null; render(); scrollTo(0, 0);
  }
});

// ---------------------------------------------------------------------------
// Calligraphy School course: Oracle Bone Mystery 甲骨之谜 (live for all members since 23 Nov 2026)
// Chapter 0 = slides, chapters 1–7 = 6 bones + a final challenge each, chapter 8 = conclusion and the
// characters learned (offered for the Character box). Progress per member in course_progress.done.
// For each bone: 1) what does it show? (type an English word) 2) which modern character? (4 choices) 3) fun fact.
// ---------------------------------------------------------------------------
const coOpen = () => true; // live for all members since 23 Nov 2026 (beta for admins earlier that day)
const CO = ORACLE, CO_LAST = CO.chapters.length + 1; // 0 intro, 1..7 chapters, 8 conclusion
const coState = () => (state.co ??= { done: null, q: null });
const coGlyph = (c) => `icons/oracle/${encodeURIComponent(c)}.svg`;
const coCh = (b) => (trad() && b.tr ? b.tr : b.ch);                 // modern form in the member's script
const coImgCh = (b) => b.tr || b.ch;                                  // glyph files are named by the traditional form
// Traditional-script members get the course text in traditional (whole runs of characters, so 中国 → 中國).
const coT = (html) => !trad() ? String(html ?? "") : String(html ?? "").replace(/(<span class="cgzh nt">[\s\S]*?<\/span>)|([\u3400-\u9fff]+)/g, (m, keep, run) => keep || ORACLE_T[run] || run);
const coProse = (html) => coT(html).replace(/<i class="py">([^<]*)<\/i>/g, (_, x) => `<i class="py">${esc(py(x))}</i>`);
const coTitle = () => `${CO.title} <span class='zhsub'>${trad() ? CO.title_zh_t : CO.title_zh}</span>`;
const coHref = (n) => `#/learn/callig/course/${CO.id}${n == null ? "" : `/${n}`}`;
const coChapterName = (n) => n === 0 ? CO.intro.title : n === CO_LAST ? CO.conclusion.title : CO.chapters[n - 1].title;
// Every character the course teaches, in order: the bones, then each chapter's answer (and 今 from the first one).
function coLearned() {
  const out = [], seen = new Set();
  const add = (ch, tr, p, en) => { const c = trad() && tr ? tr : ch; if (!seen.has(c)) { seen.add(c); out.push({ ch: c, pinyin: p, meaning: en.replace(/[“”]/g, "") }); } };
  CO.chapters.forEach((c) => {
    c.bones.forEach((b) => add(b.ch, b.tr, b.py, b.en));
    if (c.finale.type === "read") add("今", null, "jīn", "now, today");
    else add(c.finale.answer, c.finale.tr, c.finale.py, c.finale.en);
  });
  return out;
}
async function coLoad() {
  const S = coState(); if (S.loading) return; S.loading = true;
  const { data, error } = await sb.from("course_progress").select("done").eq("user_id", state.user.id).eq("course", CO.id).maybeSingle();
  S.loading = false; S.done = error ? [] : (data?.done || []);
  if (route() === "learn") render();
}
async function coMarkDone(n) {
  const S = coState(); if (!S.done || S.done.includes(n)) return;
  S.done = [...S.done, n].sort((a, b) => a - b);
  const { error } = await sb.from("course_progress").upsert({ course: CO.id, done: S.done, updated_at: new Date().toISOString() }, { onConflict: "user_id,course" });
  if (error) console.error(error);
  if (CO.chapters.every((_, i) => S.done.includes(i + 1)) && S.done.includes(CO_LAST)) nbPost("course", CO.id, "Oracle Bone Mystery");
}
function coCard() {
  const S = coState(); if (!S.done) coLoad();
  const n = S.done?.filter((x) => x >= 1 && x < CO_LAST).length || 0, total = CO.chapters.length;
  return `<a class="card cgclass cgcourse" href="${coHref()}"><span class="cgcourseic" aria-hidden="true"><img src="${coGlyph("卜")}" alt=""></span>
    <span class="grow"><b>${esc(CO.title)}</b> <span class="cgzh muted small">${trad() ? CO.title_zh_t : CO.title_zh}</span><br>
    <span class="small muted">Course · ${total} chapters · ${coLearned().length} characters</span>${S.done?.length ? `<br><span class="tiny cgok">${S.done.includes(CO_LAST) ? "Finished ✓" : `${n} of ${total} chapters done`}</span>` : ""}</span>
    <span class="btn small ghost">${S.done?.length ? "Continue" : "Start"}</span></a>`;
}

function coView(id, n) {
  if (!coOpen() || id !== CO.id) { location.hash = "#/learn/callig"; return ""; }
  const S = coState(); if (!S.done) { coLoad(); return `${cgHead("#/learn/callig", "Calligraphy School", coTitle())}<p class="muted small">Opening…</p>`; }
  if (n == null) return coOverview();
  n = +n; if (!(n >= 0 && n <= CO_LAST)) { location.hash = coHref(); return ""; }
  if (!S.q || S.q.n !== n) S.q = { n, phase: n >= 1 && n < CO_LAST ? "story" : "slides", i: 0 };
  return n === 0 ? coSlidesView(CO.intro, 0) : n === CO_LAST ? (S.q.phase === "chars" ? coCharsView() : coSlidesView(CO.conclusion, CO_LAST)) : coChapterView(n);
}

function coOverview() {
  coState().q = null; // opening a chapter from here starts it fresh
  const S = coState(), done = new Set(S.done), next = [...Array(CO_LAST + 1).keys()].find((k) => !done.has(k)) ?? 0;
  const row = (k) => {
    const c = k >= 1 && k < CO_LAST ? CO.chapters[k - 1] : null;
    const pic = c ? `<img src="${coGlyph(coImgCh(c.bones[0]))}" alt="">` : `<span class="cgzh">${k === 0 ? "甲" : "筆"}</span>`;
    return `<a class="card cgchap ${done.has(k) ? "done" : ""} ${k === next ? "next" : ""}" href="${coHref(k)}"><span class="cgchapic" aria-hidden="true">${pic}</span>
      <span class="grow"><span class="tiny muted">${k === 0 ? "Introduction" : k === CO_LAST ? "Conclusion" : `Chapter ${k} · ${esc(c.theme)}`}</span><br><b>${esc(coChapterName(k))}</b>${c ? `<br><span class="tiny muted">${esc(c.place)}</span>` : ""}</span>
      <span class="cgchapst">${done.has(k) ? "✓" : k === next ? "Start ›" : "›"}</span></a>`;
  };
  return `${cgHead("#/learn/callig", "Calligraphy School", coTitle())}
    <section class="card cgcohero"><div class="cgbone small"><img class="cgglyph" src="${coGlyph("龜")}" alt=""></div>
      <div><p style="margin:0">${esc(CO.blurb)}</p><p class="tiny muted" style="margin:6px 0 0">${CO.chapters.length} chapters of 6 bones and a final challenge, an introduction and a conclusion. At the end, add the ${coLearned().length} characters you met to your character box.</p></div></section>
    <div class="stack" style="gap:8px">${[...Array(CO_LAST + 1).keys()].map(row).join("")}</div>
    <p class="tiny muted">${esc(CO.credit)} Adapted from Mandarin Zest’s classroom game.</p>`;
}

function coSlidesView(part, n) {
  const S = coState(), q = S.q, sl = part.slides[q.i], last = q.i === part.slides.length - 1;
  const label = n === 0 ? "Introduction" : "Conclusion";
  return `${cgHead(coHref(), CO.title, `${esc(part.title)} <span class='zhsub'>${esc(coT(part.title_zh))}</span>`)}
    <div class="cgdots" aria-label="Slide ${q.i + 1} of ${part.slides.length}">${part.slides.map((_, k) => `<span class="${k < q.i ? "ok" : k === q.i ? "cur" : ""}"></span>`).join("")}</div>
    <section class="card cgslide">
      <div class="tiny muted">${label} · ${q.i + 1} / ${part.slides.length}</div>
      <h2>${coProse(sl.title)}</h2>
      ${sl.img ? `<figure class="cgphoto"><img src="icons/oracle/${sl.img}" alt="${esc(sl.alt || "")}"><figcaption class="tiny muted">${esc(sl.credit || "")}</figcaption></figure>` : ""}
      <div class="cgslidebody">${coProse(sl.body)}</div>
    </section>
    <div class="row" style="gap:8px">${q.i ? `<button type="button" class="btn ghost" data-co="prev">‹ Back</button>` : ""}
      <button type="button" class="btn grow" data-co="${last ? "slidesdone" : "next"}">${last ? (n === 0 ? "Start Chapter 1 ›" : "See the characters you learned ›") : "Next ›"}</button></div>`;
}

const coCurator = (text) => `<div class="cgcurator"><span class="cgcurav" aria-hidden="true"><img src="${coGlyph("卜")}" alt=""></span><div class="cgbubble"><b>The Curator</b><br>${text}</div></div>`;
function coPick(pool, answer, k, seed) { // stable "random" choices for one question
  const opts = [...new Set(pool.filter((x) => x !== answer))];
  let h = [...seed].reduce((a, c) => (a * 31 + c.codePointAt(0)) >>> 0, 7);
  const rnd = () => (h = (h * 1103515245 + 12345) >>> 0) / 2 ** 32;
  for (let j = opts.length - 1; j > 0; j--) { const r = Math.floor(rnd() * (j + 1)); [opts[j], opts[r]] = [opts[r], opts[j]]; }
  const out = [answer, ...opts.slice(0, k - 1)];
  for (let j = out.length - 1; j > 0; j--) { const r = Math.floor(rnd() * (j + 1)); [out[j], out[r]] = [out[r], out[j]]; }
  return out;
}

function coChapterView(n) {
  const S = coState(), q = S.q, c = CO.chapters[n - 1], head = cgHead(coHref(), CO.title, `${esc(c.title)}`);
  const kick = `<div class="tiny muted">Chapter ${n} · ${esc(c.place)} · ${esc(c.theme)}</div>`;
  const dots = `<div class="cgdots">${c.bones.map((_, k) => `<span class="${k < q.i || (k === q.i && q.stage === "reveal") || (q.phase !== "bone" && q.phase !== "story") ? "ok" : k === q.i && q.phase === "bone" ? "cur" : ""}"></span>`).join("")}<span class="${q.phase === "done" ? "ok" : q.phase === "finale" ? "cur" : ""} fin"></span></div>`;
  if (q.phase === "story") return `${head}${kick}
    <section class="card cgslide">${c.story.map((p) => `<p>${coProse(p)}</p>`).join("")}</section>
    ${coCurator(coProse(c.curator))}
    <button type="button" class="btn block" data-co="begin">Open the first bone ›</button>`;
  if (q.phase === "bone") {
    const b = c.bones[q.i], ans = coCh(b);
    q.stage ??= "meaning";
    q.opts ??= coPick(c.bones.map(coCh).concat(CO.chapters.flatMap((x) => x.bones.map(coCh))), ans, 4, `${n}-${q.i}`);
    const rot = b.rotate && (q.clue || q.stage !== "meaning");
    let body;
    if (q.stage === "meaning") body = `<form class="cgguess" data-coform><label class="small" for="cgguessin"><b>What does it show?</b> One English word is enough.</label>
        <div class="row" style="gap:8px"><input id="cgguessin" name="g" class="cgguessin" autocomplete="off" autocapitalize="off" placeholder="e.g. sun, person, boat…"><button class="btn" type="submit">Check</button></div></form>
      ${q.miss ? `<p class="small cgmiss" role="status">Not quite${q.lastTry ? `: not “${esc(q.lastTry)}”` : ""}. ${q.miss >= 2 && !q.clue ? "Want a clue?" : "Look again!"}</p>` : ""}
      ${q.clue ? `<p class="small cgclue"><b>Clue:</b> ${coProse(b.clue)}</p>` : ""}
      <div class="row" style="gap:8px;flex-wrap:wrap">${q.clue ? "" : `<button type="button" class="btn ghost small" data-co="clue">Clue</button>`}<button type="button" class="linkbtn" data-co="giveup">Show me the answer</button></div>`;
    else if (q.stage === "char") body = `<p class="small" style="margin:0">${q.gaveUp ? "It shows" : "Yes! It shows"} <b>${esc(b.en)}</b>.</p>
      <p style="margin:6px 0 4px"><b>Which modern character did it become?</b></p>
      <div class="cgopts">${q.opts.map((o) => `<button type="button" class="cgopt cgzh ${q.wrong?.includes(o) ? "no" : ""}" data-co="pick" data-v="${esc(o)}" ${q.wrong?.includes(o) ? "disabled" : ""}>${esc(o)}</button>`).join("")}</div>
      ${q.wrong?.length ? `<p class="small cgmiss" role="status">Not that one. Compare the shapes again!</p>` : ""}`;
    else body = `<div class="cgreveal"><span class="cgzh cgbig">${esc(ans)}</span><b class="cgpy">${esc(py(b.py))}</b><span class="muted">${esc(b.en)}</span></div>
      <p class="small cgfact">${coProse(b.fact)}</p>
      <div class="row" style="gap:8px;flex-wrap:wrap"><a class="btn ghost small" href="${cgHref(ans)}">${ICON_CG.brush} See its strokes</a>
      <button type="button" class="btn grow" data-co="nextbone">${q.i === c.bones.length - 1 ? "Final challenge ›" : "Next bone ›"}</button></div>`;
    return `${head}${kick}${dots}
      <section class="card cgbonecard"><div class="tiny muted">Bone ${q.i + 1} of ${c.bones.length}</div>
        <div class="cgbone"><img class="cgglyph ${rot ? "rot" : ""}" src="${coGlyph(coImgCh(b))}" alt="An oracle bone glyph"></div>
        <p class="cgnarr">${coProse(b.narr)}</p>${body}</section>`;
  }
  if (q.phase === "finale") {
    const f = c.finale, ans = trad() && f.tr ? f.tr : f.answer;
    const glyphs = f.type === "read" ? `<div class="cgbone tall">${f.glyphs.map((g) => `<img class="cgglyph sm" src="${coGlyph(g)}" alt="">`).join("")}</div>`
      : `<div class="cgcombine">${f.glyphs.map((g) => `<div class="cgbone small"><img class="cgglyph" src="${coGlyph(g)}" alt=""></div>`).join('<span class="cgplus" aria-hidden="true">+</span>')}</div>`;
    if (!q.fdone) {
      q.fopts ??= f.type === "read" ? coPick(f.options, f.options[0], 3, `f${n}`) : coPick(["好", "家", "休", "明", trad() ? "從" : "从", "秋", "林", "男", "安", "字", "看", "早"], ans, 4, `f${n}`);
      return `${head}${kick}${dots}<section class="card cgbonecard"><div class="tiny muted">Final challenge · ${esc(f.kicker)}</div>${glyphs}
        <p class="cgnarr">${coProse(f.title)}</p>
        <div class="${f.type === "read" ? "cgoptsl" : "cgopts"}">${q.fopts.map((o) => `<button type="button" class="cgopt ${f.type === "read" ? "line" : "cgzh"} ${q.wrong?.includes(o) ? "no" : ""}" data-co="fpick" data-v="${esc(o)}" ${q.wrong?.includes(o) ? "disabled" : ""}>${esc(o)}</button>`).join("")}</div>
        ${q.wrong?.length ? `<p class="small cgmiss" role="status">Not quite. Look at the pictures again!</p>` : ""}</section>`;
    }
    return `${head}${kick}${dots}<section class="card cgbonecard">${glyphs}
      <div class="cgreveal"><span class="cgzh cgbig">${esc(f.type === "read" ? f.answer : ans)}</span><b class="cgpy">${esc(py(f.py))}</b><span class="muted">${esc(f.en)}</span></div>
      <p class="small cgfact">${coProse(f.text)}</p>
      <button type="button" class="btn block" data-co="finish">Finish the chapter ›</button></section>`;
  }
  // chapter done
  const chars = c.bones.map(coCh).concat(c.finale.type === "read" ? ["今"] : [trad() && c.finale.tr ? c.finale.tr : c.finale.answer]);
  return `${head}${kick}<section class="card cgdone"><div class="cgseal" style="position:static;transform:rotate(-6deg)">好</div>
    <h2>Chapter ${n} solved!</h2><p class="muted" style="margin:0">${esc(c.title)}: you read ${c.bones.length} bones and the final challenge.</p>
    <div class="cgchips">${chars.map((x) => `<a class="cgzh" href="${cgHref(x)}">${esc(x)}</a>`).join("")}</div>
    <a class="btn block" href="${coHref(n + 1)}">${n + 1 === CO_LAST ? "Go to the conclusion ›" : `Chapter ${n + 1}: ${esc(CO.chapters[n].title)} ›`}</a>
    <a class="linkbtn" href="${coHref()}">All chapters</a></section>`;
}

function coCharsView() {
  const S = coState(), q = S.q, list = coLearned(), cg = cgState();
  if (!cg.box) return `${cgHead(coHref(), CO.title, "Characters you learned")}<p class="muted small">Opening your box…</p>`;
  const have = new Set(cg.box.map((r) => r.ch));
  q.sel ??= new Set(list.filter((x) => !have.has(x.ch)).map((x) => x.ch));
  const tiles = list.map((x) => have.has(x.ch) ? `<span class="cgbtile s2" title="Already in your character box">${esc(x.ch)}</span>`
    : `<button type="button" class="cgbtile out ${q.sel.has(x.ch) ? "sel" : ""}" data-co="csel" data-c="${esc(x.ch)}" aria-pressed="${q.sel.has(x.ch)}" title="${esc(py(x.pinyin))} · ${esc(x.meaning)}">${esc(x.ch)}</button>`).join("");
  const missing = list.filter((x) => !have.has(x.ch)).length;
  return `${cgHead(coHref(), CO.title, "Characters you learned")}
    <section class="card cgdone"><div class="cgseal" style="position:static;transform:rotate(-6deg)">好</div><h2>Course complete!</h2>
      <p class="muted" style="margin:0">You met <b>${list.length} characters</b> on 3,000-year-old bones. Add them to your character box to learn to write them, ${CG_NEW_PER_DAY} new ones a day.</p></section>
    ${missing ? `<div class="cgselbar"><span class="small"><b>${q.sel.size}</b> of ${missing} selected</span><button type="button" class="linkbtn" data-co="callsel">${q.sel.size === missing ? "Select none" : "Select all"}</button>
      <button type="button" class="btn small" data-co="cadd" ${q.sel.size ? "" : "disabled"}>Add ${q.sel.size} to my character box</button></div>` : `<p class="lindeck">✓ All of them are in your character box</p>`}
    <div class="cgbtiles">${tiles}</div>
    <p class="tiny muted">Tap a character to leave it out. Green ones are already in your box.</p>
    <div class="row" style="gap:8px;flex-wrap:wrap"><a class="btn ghost" href="#/learn/callig/box">Open my character box</a><a class="btn ghost" href="${coHref()}">All chapters</a></div>`;
}

function coCheck(b, guess) {
  const words = String(guess).toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter(Boolean);
  const ok = new Set(b.ok.concat(b.en.toLowerCase().split(/\s+/)));
  return words.some((w) => ok.has(w) || ok.has(w.replace(/s$/, "")) || (w.length > 4 && [...ok].some((o) => o.length > 4 && (o.startsWith(w) || w.startsWith(o)))));
}
document.addEventListener("submit", (e) => {
  const f = e.target.closest("[data-coform]"); if (!f) return;
  e.preventDefault();
  const S = coState(), q = S.q, b = CO.chapters[q.n - 1].bones[q.i], g = f.g.value.trim();
  if (!g) return;
  if (coCheck(b, g)) { q.stage = "char"; q.miss = 0; }
  else { q.miss = (q.miss || 0) + 1; q.lastTry = g; }
  render();
  if (q.stage === "meaning") setTimeout(() => document.getElementById("cgguessin")?.focus(), 0);
});
document.addEventListener("click", async (e) => {
  const el = e.target.closest("button[data-co]"); if (!el) return;
  const S = coState(), q = S.q, a = el.dataset.co; if (!q) return;
  const c = q.n >= 1 && q.n < CO_LAST ? CO.chapters[q.n - 1] : null;
  if (a === "next") { q.i++; render(); scrollTo(0, 0); }
  else if (a === "prev") { q.i = Math.max(0, q.i - 1); render(); scrollTo(0, 0); }
  else if (a === "slidesdone") {
    await coMarkDone(q.n);
    if (q.n === 0) location.hash = coHref(1); else { q.phase = "chars"; render(); scrollTo(0, 0); }
  }
  else if (a === "begin") { q.phase = "bone"; q.i = 0; render(); scrollTo(0, 0); }
  else if (a === "clue") { q.clue = true; render(); }
  else if (a === "giveup") { q.stage = "char"; q.gaveUp = true; render(); }
  else if (a === "pick") {
    if (el.dataset.v === coCh(c.bones[q.i])) { q.stage = "reveal"; qLog("co_bone"); } else (q.wrong ??= []).push(el.dataset.v);
    render();
  }
  else if (a === "nextbone") {
    const nq = { n: q.n, phase: "bone", i: q.i + 1 };
    if (q.i + 1 >= c.bones.length) { nq.phase = "finale"; nq.i = q.i; }
    S.q = nq; render(); scrollTo(0, 0);
  }
  else if (a === "fpick") {
    const f = c.finale, right = f.type === "read" ? f.options[0] : (trad() && f.tr ? f.tr : f.answer);
    if (el.dataset.v === right) q.fdone = true; else (q.wrong ??= []).push(el.dataset.v);
    render();
  }
  else if (a === "finish") { qLog("co_chapter"); tEvent("co_chapter", c ? `${q.n}. ${c.title}` : `chapter ${q.n}`); await coMarkDone(q.n); q.phase = "done"; render(); scrollTo(0, 0); }
  else if (a === "csel") { const ch = el.dataset.c; q.sel.has(ch) ? q.sel.delete(ch) : q.sel.add(ch); render(); }
  else if (a === "callsel") { const have = new Set((cgState().box || []).map((r) => r.ch)), miss = coLearned().filter((x) => !have.has(x.ch)); q.sel = q.sel.size === miss.length ? new Set() : new Set(miss.map((x) => x.ch)); render(); }
  else if (a === "cadd") {
    el.disabled = true;
    const n = await cgBoxAddMany(coLearned().filter((x) => q.sel.has(x.ch)));
    if (n) toast(`${n} characters added to your box. They start ${CG_NEW_PER_DAY} a day.`);
    q.sel = new Set(); cgState().rv = null; render();
  }
});

// ---------------------------------------------------------------------------
// Welcome tour (23 Nov 2026): 5 slides, shown once to new members (profiles.tour_seen is null), on top of
// everything else; Skip or "Let's go!" sets tour_seen. Me → "Take the app tour" shows it again.
// Slide 5 uses the real settings (script, pronunciation, notifications), saved straight away.
// ---------------------------------------------------------------------------
const TOUR_N = 5;
const tourOn = () => !!state.tour || (state.loaded && state.me && !state.me.tour_seen && !state.tourClosed);
function tourArt(k) {
  const card = "tcard";
  if (k === 0) return `<div class="tart0"><img src="icons/mascot.svg" alt="The Mandarin Zest mascot, an orange reading a book and saying 你好"></div>`;
  if (k === 1) return `<div class="tart">
    <div class="${card}"><div class="row" style="gap:6px"><span class="tchip g">Conversation</span><span class="tchip">Intermediate</span></div>
      <b>Taiwanese Mandarin Conversation</b><span class="small muted">Sat · with your host</span>
      <div class="row" style="gap:8px"><span class="tbtn g">✓ I'm in</span><span class="tbtn">Can't make it</span></div></div>
    <div class="${card} row tilt1"><span class="tbell">${ICON.bell}</span><span class="small"><b>Starting in 1 hour</b><br><span class="muted">Tap to join on Google Meet</span></span></div>
    <div class="${card} row tilt2"><span class="cgzh" style="font-size:20px">${trad() ? "學校" : "学校"}</span><span class="small muted">Notes are up · PDF · + flashcards</span></div></div>`;
  if (k === 2) {
    const b = (img, lab) => `<span class="tbld"><span>${ztImg(img)}</span>${lab}</span>`;
    return `<div class="tart"><div class="ttown"><img src="icons/zt/town4-phone.png" alt="Zest Town, the pixel-art learning town"></div>
      <div class="row" style="gap:8px;justify-content:center">${b("house", "Flashcards")}${b("temple", "HSK Temple")}${b("library", "Library")}${b("callig", "Calligraphy")}</div>
      <div class="${card} row" style="padding:6px 12px 6px 6px;align-self:center"><img class="pix" src="icons/zt/tree-3.png" alt="" style="width:36px"><span class="small"><b>Streak tree</b> · grows when you practise each day</span></div></div>`;
  }
  if (k === 3) {
    const mine = ZT_FRUITS.has(state.me?.fruit) ? state.me.fruit : "orange";
    const fr = (f, lv, big) => `<span class="tfr ${big ? "big" : ""}"><span><img class="pix" src="icons/zt/fruit-${f}.png" alt=""></span><em>${lv}</em></span>`;
    return `<div class="tart"><div class="row" style="gap:12px;align-items:flex-end;justify-content:center">${fr(mine, "LV 1", true)}<span class="tarrow">›</span>${fr("strawberry", "LV 2")}<span class="tarrow">›</span>${fr("mango", "LV 4")}</div>
      <div class="txp"><span></span></div>
      <div class="row" style="gap:8px;flex-wrap:wrap;justify-content:center"><span class="tchip w">+20 XP · each session</span><span class="tchip w">+1 XP · a day in Zest Town</span><span class="tchip r"><span class="cgzh">${trad() ? "紅包" : "红包"}</span> one hongbao a month</span><span class="tchip y">Stickers to collect</span></div></div>`;
  }
  const seg = (act, cur, opts) => `<div class="seg tseg" role="group">${opts.map(([v, l]) => `<button type="button" data-tour="${act}" data-v="${v}" aria-pressed="${cur === v}">${l}</button>`).join("")}</div>`;
  const pushOk = state.push?.supported, on = state.push?.subscribed;
  return `<div class="tart"><div class="${card}" style="gap:12px;width:100%">
    <span class="tlab">CHARACTERS</span>${seg("script", state.me?.script === "traditional" ? "traditional" : "simplified", [["simplified", "<span class='cgzh'>简体</span> Simplified"], ["traditional", "<span class='cgzh'>繁體</span> Traditional"]])}
    <span class="tlab">PRONUNCIATION</span>${seg("phonetic", state.me?.phonetic === "zhuyin" ? "zhuyin" : "pinyin", [["pinyin", "Pinyin"], ["zhuyin", "<span class='cgzh'>注音</span> Zhuyin"]])}
    <div class="row between" style="gap:10px"><span class="small"><b>Notifications</b><br><span class="muted">Reminders, notes, new sessions</span></span>
      ${pushOk ? `<button type="button" class="tswitch ${on ? "on" : ""}" data-tour="push" role="switch" aria-checked="${!!on}" aria-label="Notifications"><span></span></button>` : `<span class="tiny muted" style="max-width:130px;text-align:right">Add the app to your Home Screen first, then turn them on in Me.</span>`}</div>
    <div class="ttip"><img class="pix" src="icons/zt/fruit-orange.png" alt=""><span><b>Tip:</b> add the app to your Home Screen to open it like any other app.</span></div></div></div>`;
}
function tourOverlay() {
  const T = (state.tour ??= { i: 0 }), k = T.i, name = String(state.me?.display_name || "").trim().split(/\s+/)[0];
  const S = [
    ["WELCOME 欢迎", name ? `Hi ${esc(name)}, welcome to the Club!` : "Welcome to the Club!", "This app is your home for Mandarin Zest Club: live sessions with our hosts, your class notes, and fun ways to practise in between."],
    ["SESSIONS · HOME", "Join live sessions", "Tap “I'm in” on any session and we remind you an hour before. After class, your host's notes show up in My sessions."],
    ["LEARNING · ZEST TOWN", "Practise in Zest Town", "Flashcards, every HSK word, books to read and a calligraphy school. Do a little each day and watch your streak tree grow."],
    ["XP · FRUITS · STICKERS", "Grow your fruit", "Earn XP to level up and unlock new fruit avatars. Collect stickers, send a hongbao to another member each month, and climb the monthly leaderboard."],
    ["YOUR SETTINGS", "Make it yours", `Pick simplified or traditional characters, pinyin or zhuyin, and turn on notifications. You can change all of this later in ${wide() ? "Settings and Me" : "Me"}.`],
  ][k];
  const dots = [...Array(TOUR_N)].map((_, i) => `<span class="${i === k ? "on" : ""}"></span>`).join("");
  return `<div class="tourover ${T.shown ? "still" : ""}" role="dialog" aria-modal="true" aria-labelledby="tourtitle">
    <div class="tourbox">
      <div class="tourart">${tourArt(k)}</div>
      <div class="tourtext">
        <div class="row between"><span class="tourstep">${k + 1} / ${TOUR_N}</span>${k < TOUR_N - 1 ? `<button type="button" class="linkbtn tourskip" data-tour="skip">Skip</button>` : ""}</div>
        <div class="tourcopy"><div class="toureye">${S[0]}</div><h2 id="tourtitle">${S[1]}</h2><p>${S[2]}</p></div>
        <div class="tournav"><div class="tourdots" aria-hidden="true">${dots}</div>
          <button type="button" class="btn block" data-tour="${k === TOUR_N - 1 ? "done" : "next"}">${k === 0 ? "Show me around" : k === TOUR_N - 1 ? "Let's go!" : "Next"}</button>
          ${k ? `<button type="button" class="linkbtn" data-tour="back">‹ Back</button>` : `<span style="height:22px"></span>`}</div>
      </div></div></div>`;
}
async function tourClose() {
  const replay = state.tour?.replay; state.tour = null; state.tourClosed = true;
  if (!state.me.tour_seen) {
    state.me.tour_seen = new Date().toISOString();
    await sb.from("profiles").update({ tour_seen: state.me.tour_seen }).eq("id", state.user.id);
  }
  if (!replay) location.hash = "#/home";
  render();
}
document.addEventListener("click", async (e) => {
  const el = e.target.closest("[data-tour]"); if (!el) return;
  const a = el.dataset.tour, T = (state.tour ??= { i: 0 });
  T.shown = true;
  if (a === "next") { T.i = Math.min(TOUR_N - 1, T.i + 1); render(); }
  else if (a === "back") { T.i = Math.max(0, T.i - 1); render(); }
  else if (a === "skip" || a === "done") {
    if (a === "done" || T.i === TOUR_N - 1) state.pushAsk = false; // they saw the notifications switch
    await tourClose();
  }
  else if (a === "script" || a === "phonetic") {
    const v = el.dataset.v; if (state.me[a] === v) return;
    state.me[a] = v; render();
    const { error } = await sb.from("profiles").update({ [a]: v }).eq("id", state.user.id);
    if (error) toast("Couldn't save that. Try again in Me.");
  }
  else if (a === "push") { if (state.push.subscribed) await disablePush(); else await enablePush(); render(); }
});
document.addEventListener("click", (e) => { if (e.target.closest("[data-tour-start]")) { state.tour = { i: 0, replay: true }; render(); } });
