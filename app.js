import { createClient } from "./vendor/supabase.js?v=62";
import { FRUITS, HOST_AVATARS, SPECIAL_AVATARS, BACKGROUNDS, fruitSvg, fruitInfo, levelFor, progress, XP_SESSION, XP_STREAK, XP_BOOTCAMP } from "./fruits.js?v=62";
import { COUNTRIES } from "./countries.js?v=62";
const XP_HONGBAO = 30;
const MEMBER_CODE = "MZCLUB_8634D";                    // 50% off materials in the shop (Antoine, 24 Oct 2026)
const SHOP_URL = "https://www.mandarinzest.com/shop";
import { STICKERS, STICKER_PAGES, MYSTERY_STICKERS, stickerInfo, stickerSvg, stickerForBootcamp } from "./stickers.js?v=62";

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
  if (!isHost()) rewardCheck();
}

// Reward pop-ups: level up (new fruit), new sticker, new character, XP given by the team.
// Each shows once per device; the first run on a device only sets the starting point.
function rewardCheck() {
  const q = state.rewardQueue = state.rewardQueue || [];
  const uid = state.user.id;
  try {
    const lv = myLevel(), seen = +(lsGet("mz-level") || 0);
    if (seen && lv > seen) q.push({ kind: "level", lv, fruits: FRUITS.filter((x) => x.level > seen && x.level <= lv) });
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
    body = `You got the <b>${esc(i?.en || r.key)}</b> sticker. Wear it on your avatar in Me → Avatar customization.`;
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
    ${item("home", "Home", ICON.home)}${item("sessions", "My sessions", ICON.cal)}${item("notes", "My notes", ICON.notebook).replace("<a ", '<a class="deskonly" ')}${isBeta() ? item("learn", "Learning", ICON.tree).replace("</span></a>", '</span><i class="navbeta">BETA</i></a>') : ""}${item("members", "Members", ICON.people)}${item("bootcamps", "Bootcamps", ICON.seedling).replace("<a ", '<a class="deskonly" ')}${item("me", "Me", ICON.me)}${item("settings", "Settings", ICON.gear).replace("<a ", '<a class="deskonly" ')}${isAdmin() ? item("admin", "Admin", ICON.shield).replace("<a ", '<a class="deskonly" ') : ""}
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
  app.innerHTML = `<div class="shell ${trad() ? "zh-trad" : ""}">${nav()}<main class="main" id="main">${view()}</main></div>${seasonalOverlay() || hongbaoOverlay()}`;
  if (state.pushAsk && !app.querySelector(".hbover")) app.insertAdjacentHTML("beforeend", pushOverlay());
  if (state.idea?.open) app.insertAdjacentHTML("beforeend", ideaOverlay());
  else if (state.rewardQueue?.length && !app.querySelector(".hbover")) app.insertAdjacentHTML("beforeend", rewardOverlay());
  wireMap();
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
        <div style="font-size:18px;font-weight:800;margin-top:2px">${p.max ? "Every fruit unlocked!" : `${p.toNext} XP to unlock ${esc(zh(p.next.zh))} <span style="font-weight:600">${esc(p.next.py[idx])}</span>`}</div>
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
  <a class="linkbtn mobonly" href="#/home" style="text-decoration:none;font-weight:700;align-self:flex-start">← Home</a>
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
  <header class="row">
    <div class="grow">
      <div class="eyebrow">Mandarin Zest Club</div>
      <h1>${greeting()}, ${esc(me?.display_name || "friend")}!</h1>
    </div>
    <a href="#/me" aria-label="My profile" style="border-radius:50%">${avatar(me, 48)}</a>
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
      return `<div class="vrow" role="row">${box}<span class="vz" role="cell">${esc(v.hanzi)}</span><span class="vp" role="cell">${esc(v.pinyin)}</span><span class="vm" role="cell">${esc(v.meaning)}${v.hsk?.level ? ` <span class="hskchip">HSK ${esc(v.hsk.level)}</span>` : ""}</span></div>`;
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
    <button type="button" class="btn small" data-zt="note-add" data-v="picked" data-id="${sid}" ${A.picked.size ? "" : "disabled"}>Add ${A.picked.size || ""} to flashcards</button></div>`;
  if (A?.mode === "menu") return `<div class="noteadd menu" role="group" aria-label="Add to flashcards">
    <button type="button" data-zt="note-add" data-v="all" data-id="${sid}"><b>Add all words</b><span>${left.length} word${left.length === 1 ? "" : "s"}</span></button>
    <button type="button" data-zt="note-add" data-v="hsk" data-id="${sid}" ${hskLeft.length ? "" : "disabled"}><b>Add HSK words only</b><span>${hskLeft.length ? `${hskLeft.length} on the HSK lists` : "None on the HSK lists"}</span></button>
    <button type="button" data-zt="note-add" data-v="pick" data-id="${sid}"><b>Choose words…</b><span>Tick the ones you want</span></button>
    <button type="button" class="link small" data-zt="note-add" data-v="cancel" data-id="${sid}">Cancel</button></div>`;
  return `<div class="row" style="gap:8px;align-items:center;flex-wrap:wrap"><button type="button" class="btn ghost" data-zt="note-add" data-v="menu" data-id="${sid}">＋ Add to flashcards</button>
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
  if (!s) return `<a class="linkbtn" href="#/sessions">← Back</a><div class="card"><h2>Session not found</h2><p class="muted small" style="margin:0">It may have been removed from the calendar.</p></div>`;
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
    <a class="linkbtn" href="#/sessions" style="text-decoration:none;font-weight:700">← Back</a>
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
  <p class="small muted" style="margin:0">+${XP_SESSION} XP per session · +${XP_STREAK} XP every 4 weeks in a row · XP for bootcamps · +${XP_HONGBAO} XP per hongbao received. Hosts don't take part.</p>`;
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
  <a class="linkbtn" href="#/me" data-act="back-custom" style="text-decoration:none;font-weight:700;align-self:flex-start">← Back to my profile</a>
  <header><div class="eyebrow">Avatar customization</div><h1>How to unlock avatars &amp; stickers</h1></header>
  <section class="card" style="gap:10px">
    <h2>Fruit avatars: level up</h2>
    <p class="small muted" style="margin:0;line-height:1.5">You start with three fruits. Each new level unlocks another one. You earn XP by joining sessions (+${XP_SESSION}), coming 4 weeks in a row (+${XP_STREAK}), bootcamps and hongbaos from other members (+${XP_HONGBAO}).</p>
    <div class="unlockgrid">${FRUITS.map((f) => `<div class="unlockitem">${avatar({ bg: "#fdf1ea" }, 40, { flag: false, fruit: f.key, locked: !isHost() && f.level > myLevel() })}<span class="small"><b>Lv ${f.level}</b><br>${esc(zh(f.zh))}</span></div>`).join("")}</div>
  </section>
  <section class="card" style="gap:10px">
    <h2>Special avatars and stickers</h2>
    <p class="small muted" style="margin:0;line-height:1.5">Special avatars and stickers are given during special sessions, bootcamps and Club initiatives. Stickers are a small extra: you wear one at the bottom-left of your avatar. Keep an eye out, new ones come with new events.</p>
    <p class="small" style="margin:4px 0 0;font-weight:700">A few you can work towards anytime:</p>
    <div class="stack" style="gap:2px">${STICKERS.filter((t) => ["phone", "heart", "medal"].includes(t.key)).map((t) => `<div class="unlockrow"><span class="stkbig" style="--z:44px">${stickerSvg(t.key)}</span>
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
    const [m, cc] = await Promise.all([import("./worldmap.js?v=62"), sb.rpc("country_counts")]);
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
  if (!p) return `<a class="linkbtn" href="#/members">← Back</a><div class="card"><h2>Member not found</h2></div>`;
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
  <a class="linkbtn" href="#/members" style="text-decoration:none;font-weight:700;align-self:flex-start">← Back</a>
  <header class="row" style="gap:16px">${avatar(p, 88)}
    <div class="grow"><div class="eyebrow">${host ? "Host" : "Member"}${me ? " · you" : ""}</div>
      <h1>${esc(p.display_name || "Member")}</h1>
      <div style="font-size:14.5px;font-weight:700;color:var(--orange-ink);margin-top:4px">${esc(zh(info.zh))} <span style="font-weight:600">${esc(info.py[idx])}</span></div>
    </div>
  </header>
  ${full?.bio ? `<p class="bio">${esc(full.bio)}</p>` : me ? `<p class="small muted" style="margin:0">Add a short bio in <a href="#/me">Me</a> so others know a bit about you.</p>` : ""}
  <div class="facts">${facts.map(([v, l]) => `<div class="fact"><b>${esc(v)}</b><span>${esc(l)}</span></div>`).join("")}</div>
  ${(() => { const got = myStickers(id); return got.length ? `<section class="card" style="gap:10px"><h2>Stickers collected · ${got.length}</h2>
    <div class="stkrow">${got.map((k) => `<div class="stkitem"><span class="stkbig"${stickerTip(k, id)}>${stickerSvg(k)}</span><span class="small">${esc(stickerInfo(k).en)}</span></div>`).join("")}</div></section>` : ""; })()}
  ${full?.discord ? `<a class="chatcard" style="display:flex" href="${DISCORD_CHAT}" target="_blank" rel="noopener">${ICON.chat}<span class="grow"><b>@${esc(full.discord)}</b><br><span class="small">Say hi on the Club Discord</span></span><span aria-hidden="true" style="font-size:20px">↗</span></a>` : ""}
  ${hongbaoGiveBlock(id)}
  ${isAdmin() ? activityBlock(id) : ""}
  ${isAdmin() ? adminXpBlock(id, r, awards) : ""}`;
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
    : `<span class="acticon k-${r.kind}" aria-hidden="true">${{ session: "课", streak: "4", bootcamp: "营", bonus: "+", hongbao: "红" }[r.kind] || "+"}</span>`;
  const label = (r) => r.kind === "session" ? esc(r.title)
    : r.kind === "sticker" ? `Sticker · ${esc(stickerInfo(r.title)?.en || r.title)}`
    : r.kind === "avatar" ? `Special avatar · ${esc(fruitInfo(r.title).en || r.title)}`
    : r.kind === "streak" ? "Streak bonus · 4 weeks in a row"
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

// ---------- Sticker collection book (Me page, under Avatar customization) ----------
const STICKER_ICON = `<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M12 5H31L43 17V36A7 7 0 0 1 36 43H12A7 7 0 0 1 5 36V12A7 7 0 0 1 12 5Z" fill="#f37a48" stroke="#fff" stroke-width="2.5" stroke-linejoin="round"/><path d="M31 5V13A4 4 0 0 0 35 17H43Z" fill="#ffd9c2" stroke="#fff" stroke-width="2" stroke-linejoin="round"/><polygon points="22,17 24.4,22.8 30.6,23.2 25.8,27.2 27.3,33.3 22,30 16.7,33.3 18.2,27.2 13.4,23.2 19.6,22.8" fill="#fff"/></svg>`;
function stickerBook() {
  const got = new Set(isHost() ? STICKERS.map((t) => t.key) : myStickers());
  const inBook = STICKER_PAGES.flatMap((p) => p.keys);
  const total = inBook.length, n = inBook.filter((k) => got.has(k)).length, pct = Math.round((n / total) * 100);
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
  return `<details class="custom sbdet"${state.bookOpen ? " open" : ""}>
    <summary><span class="custicon sbicon" aria-hidden="true">${STICKER_ICON}</span><span class="grow"><b>My sticker collection</b><span class="small muted">${n} of ${total} collected · ${zh(["贴纸册", "貼紙冊"])}</span></span><span class="chev" aria-hidden="true">›</span></summary>
    <div class="custbody"><section class="sbook" aria-label="My sticker collection">
    <div class="sbhead"><div class="sbtotal">${n} of ${total} collected</div>
      <div class="sbbar" role="progressbar" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${n}" aria-label="Stickers collected"><i style="width:${pct}%"></i></div>
      <span class="sbpct">${pct}%</span></div>
    <div class="sbleaves"><div class="sbleaf">${STICKER_PAGES.slice(0, half).map(page).join("")}</div><div class="sbleaf">${STICKER_PAGES.slice(half).map(page).join("")}</div></div>
    <p class="sbnote">${wide() ? "Hover over" : "Tap"} a grey sticker to see how to get it. Question marks are surprises, given at special events.${isHost() ? " Hosts have them all; members see their own collection." : ""}</p>
  </section></div></details>`;
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
  const changed = ["display_name", "fruit", "bg", "country", "chinese_level", "discord", "script", "bio", "sticker"]
    .some((k) => (d[k] ?? null) !== (state.me[k] ?? null))
    || (isHost() && d.meet_name !== undefined && d.meet_name.trim() !== (state.meetName || ""));
  const stickerKeys = isHost() ? STICKERS.map((t) => t.key) : myStickers();
  return `
  <header class="row" style="gap:16px">
    ${avatar(d, 96)}
    <div class="grow">
      <div class="eyebrow">${state.role === "admin" ? "Admin · all fruits" : state.role === "host" ? "Host · all fruits" : `Level ${level} · ${myXp().toLocaleString()} XP`}</div>
      <h1>${esc(d.display_name || "Me")}</h1>
      <div style="font-size:15px;font-weight:700;color:var(--orange-ink);margin-top:4px">${zh(info.zh)} <span style="font-weight:600">${esc(info.py[idx])}</span></div>
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
    <span class="small muted">50% off all Mandarin Zest materials. Enter the code at checkout.</span>
  </section>
  <div class="mobonly" style="display:contents">${notificationsCard()}<p class="small muted privnote">Privacy: the Club team can see when you last opened the app and your Club activity (sessions, XP, stickers), only to keep the Club running well. It’s never shared.</p></div>
  ${installHint(true)}
  <div class="row between">
    <span class="small muted">${esc(state.user.email)}</span>
    <button class="linkbtn" data-act="logout">Log out</button>
  </div>`;
}

async function saveProfile() {
  const d = draft();
  const patch = {};
  for (const k of ["display_name", "fruit", "bg", "country", "chinese_level", "discord", "script", "bio", "sticker"]) patch[k] = d[k] ?? null;
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
    const { jsPDF, html2canvas } = await import("./vendor/pdf.js?v=62");
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
        <div class="vocab">${vocab.map((v) => `<div class="vrow pdfblock"><span class="vz">${esc(v.hanzi)}</span><span class="vp">${esc(v.pinyin)}</span><span class="vm">${esc(v.meaning)}</span></div>`).join("")}</div>` : ""}
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
  <p class="small muted privnote">Privacy: the Club team can see when you last opened the app and your Club activity (sessions, XP, stickers), only to keep the Club running well. It’s never shared.</p>`;
}

// ---------------------------------------------------------------------------
// Admin tab (desktop sidebar, admins only): send a notification to members
// ---------------------------------------------------------------------------
const BC_PAGES = [["home", "Home"], ["sessions", "My sessions"], ["bootcamps", "Bootcamps"], ["members", "Members"], ["me", "Me"]];
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
  return `<section class="stack" style="gap:10px" aria-label="Notifications">
    <h2>Notifications</h2>
    ${device}
    ${tog("notify_reminders", "Session reminders and changes", "1 hour before sessions you said you'd join, and if one is cancelled or moved")}
    ${tog("notify_new", "New sessions", "When a new session is added to the calendar")}
    ${tog("notify_notes", "Notes are up", "When your host shares the notes of a session you joined")}
    ${tog("notify_rewards", "Rewards", "New level, character, sticker, XP or hongbao")}
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
  } else if (act === "fruit" || act === "bg" || act === "script") {
    const d = draft();
    if (act === "fruit") d.fruit = el.dataset.key;
    if (act === "bg") d.bg = el.dataset.hex;
    if (act === "script") d.script = el.dataset.v;
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
  try { await loadAll(); if (route() !== "me") render(); } catch { /* offline: keep what we have */ }
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

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js?v=62").catch(() => {});

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
    <b lang="zh">${esc(trad() ? w.hanzi_trad || w.hanzi : w.hanzi)}</b><span class="vsp">${esc(w.pinyin)}</span><span class="vsm">${esc(w.meaning)}</span><span class="vsl">HSK ${esc(w.level)}</span></button>`).join("")}</div>`
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
// Zest Town · Learning Universe (BETA: admins + people in beta_testers only)
// Streak tree, HSK Temple and Flashcard Center. Art: icons/zt/*.png (pixel art, see the design canvas).
// ---------------------------------------------------------------------------
const ZT_MAP = {
  phone: { w: 98, h: 178, tree: [28, 39], temple: [70, 26], house: [26, 30], library: [25, 146], callig: [73, 146], plaza: [49, 73],
    river: [89, 29], bridge: [44, 96, 11, 18], fsign: [74, 82, 24], bushes: [[4, 4], [85, 63], [1, 71], [43, 2], [85, 111], [1, 113], [42, 164]],
    hops: [[8, 58], [12, 76], [64, 80], [74, 60], [58, 86], [26, 86]] },
  wide: { w: 196, h: 180, tree: [77, 66], temple: [141, 36], house: [52, 41], library: [32, 108], callig: [164, 108], plaza: [98, 100],
    river: [129, 30], bridge: [93, 129, 11, 17], fsign: [160, 150, 32], bushes: [[8, 6], [175, 61], [1, 59], [91, 4], [176, 8], [21, 159], [59, 71], [127, 69]],
    hops: [[58, 94], [62, 116], [120, 116], [124, 94], [104, 124], [76, 124]] },
};
const ZT_STAGES = [ // [en, simplified, traditional, first day]
  ["Seed", "种子", "種子", 0], ["Sprout", "嫩芽", "嫩芽", 1], ["Seedling", "幼苗", "幼苗", 7], ["Sapling", "小树", "小樹", 30],
  ["Young tree", "青年树", "青年樹", 90], ["Leafy tree", "茂盛树", "茂盛樹", 180], ["Blossom tree", "开花树", "開花樹", 270],
  ["Fruiting tree", "结果树", "結果樹", 330], ["Orange tree", "橘子树", "橘子樹", 365],
];
const HSK_LEVELS = ["1", "2", "3", "4", "5", "6", "7-9"];
const ZT_LEARNED = 3; // a word counts as learned after 3 good answers in a row, on different days
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
const isBeta = () => isAdmin() || state.beta === true;
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
  const { data } = await sb.rpc("is_beta");
  state.beta = data === true;
  if (state.beta) render();
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
    const [c, d] = await Promise.all([
      sb.from("learn_cards").select("*").order("created_at"),
      sb.from("learn_days").select("day, kind, created_at"),
    ]);
    if (c.error) throw c.error;
    L.cards = c.data; L.days = d.error ? [] : d.data;
    // Older attended sessions (for titles in the Flashcard Center).
    if (!state.notesLoaded) await loadNoteSessions();
    await ztSyncSessionCards();
    L.loaded = true;
  } catch (e) {
    console.error(e); L.error = true;
  }
  L.loading = false;
  if (["learn", "notes", "sessions"].includes(route())) render();
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
function ztNewToday() { return +(lsGet("mz-zt-newdone-" + todayKey()) || 0); }
function ztDeck(filter) {
  const today = todayKey(), cards = state.lu.cards.filter(filter || (() => true));
  const due = cards.filter((c) => c.reps > 0 && c.due <= today);
  const fresh = cards.filter((c) => c.reps === 0);
  return { cards, due, fresh, learning: due.filter((c) => c.interval_days <= 1) };
}
function ztQueueAll() {
  const d = ztDeck(), room = Math.max(0, state.lu.perDay - ztNewToday());
  return [...d.due, ...d.fresh.slice(0, room)];
}
function ztPreview(c, g) {
  const iv = c.interval_days || 0, ease = c.ease || 2.5;
  if (g === 0) return 0;
  if (g === 1) return Math.max(1, Math.round(iv * 1.2));
  if (g === 2) return iv === 0 ? 1 : iv === 1 ? 3 : Math.round(iv * ease);
  return iv === 0 ? 3 : Math.round(iv * ease * 1.3);
}
const ivText = (n) => (n === 0 ? "now" : n === 1 ? "1 day" : n < 30 ? `${n} days` : `${Math.round(n / 30)} mo`);
async function ztGrade(g) {
  const R = state.lu.review; if (!R) return;
  const c = R.queue[R.i]; if (!c) return;
  const scheduled = c.reps === 0 || c.due <= todayKey();
  if (scheduled) {
    const iv = ztPreview(c, g), wasNew = c.reps === 0;
    const upd = {
      interval_days: iv, due: addDays(iv), reps: c.reps + 1, last_review: new Date().toISOString(),
      ease: Math.max(1.3, Math.min(3.2, (c.ease || 2.5) + [-0.2, -0.15, 0, 0.15][g])),
      good_streak: g >= 2 ? c.good_streak + 1 : g === 1 ? c.good_streak : 0,
      lapses: c.lapses + (g === 0 && c.reps > 0 ? 1 : 0),
    };
    // Several good answers on the same day only count once towards "learned".
    if (g >= 2 && c.last_review && dkey(new Date(c.last_review)) === todayKey()) upd.good_streak = c.good_streak;
    Object.assign(c, upd);
    if (wasNew) lsSet("mz-zt-newdone-" + todayKey(), String(ztNewToday() + 1));
    sb.from("learn_cards").update(upd).eq("id", c.id).then(({ error }) => { if (error) toast("Couldn't save that card. Check your connection."); });
  }
  R.done++;
  if (g === 0 && !R.again.has(c.id)) { R.again.add(c.id); R.queue.push(c); }
  R.i++; R.flipped = false;
  if (R.i >= R.queue.length) await ztFinish();
  render();
}
async function ztFinish() {
  const R = state.lu.review; R.finished = true;
  if (R.done > 0 && !state.lu.days.some((d) => d.day === todayKey() && d.kind === "game")) {
    const row = { day: todayKey(), kind: "game" };
    const { error } = await sb.from("learn_days").upsert(row, { onConflict: "user_id,day,kind", ignoreDuplicates: true });
    if (!error) { state.lu.days.push({ ...row, created_at: new Date().toISOString() }); R.counted = true; }
  }
}
function ztStart(title, queue, cram) {
  if (!queue.length) { toast("Nothing to review here right now."); return; }
  state.lu.review = { title, queue: [...queue], i: 0, flipped: false, done: 0, again: new Set(), cram };
  render(); scrollTo(0, 0);
}

// ---- word status for the HSK Temple ----------------------------------------
function ztWordStatus() {
  const m = new Map();
  for (const v of ztSessionVocab()) m.set(v.hanzi, "seen");
  for (const c of state.lu.cards) {
    const s = c.good_streak >= ZT_LEARNED ? "learned" : "seen";
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
  const sub = routeArg();
  if (sub === "cards") return L.review ? reviewView() : cardsView();
  if (sub === "temple") return templeView();
  if (sub === "forest") return forestView();
  return townView();
}
function ztHeader(st, back) {
  const pills = st ? `<span class="ztpill leaf ${st.wilted ? "off" : ""}" title="Streak (days in a row)">${ZT_LEAF}${st.wilted ? 0 : st.n}</span><span class="ztpill drop" title="Watering cans left this month">${ZT_DROP}${ztWaterLeft()}</span>` : "";
  return `<header class="zthead">${back ? `<a class="ztback" href="#/learn">‹ Zest Town</a>` : `<div class="eyebrow">Learning Universe · ${trad() ? "學習宇宙" : "学习宇宙"} <span class="betachip">BETA</span></div>`}
    <div class="row between" style="align-items:center;gap:10px"><h1>${back || "Zest Town"}</h1><span class="row" style="gap:6px">${pills}</span></div></header>`;
}
function todayCard(st) {
  return st.doneToday
    ? `<div class="zttoday done">${ZT_LEAF}<span><b>Today counts!</b><br><span class="small">Your tree grows again tomorrow. Come back for day ${st.n + 1}.</span></span></div>`
    : `<div class="zttoday">${ZT_LEAF}<span><b>Keep your tree growing</b><br><span class="small">Review flashcards or join a session today.</span></span></div>`;
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
  if (words) { const learned = words.filter((w) => statusOf(w, ws) === "learned").length; hskLine = `HSK ${lv} · ${Math.round((learned / words.length) * 100)}% learned`; }
  else ztLoadLevel(lv);
  const card = (href, img, t, z, line, sub, btn) => `<a class="card ztplace ${big ? "big" : ""}" href="${href}"><span class="ztplaceart">${ztImg(img)}</span>
    <span class="grow"><b>${t}</b> <span class="muted">${z}</span><br><span class="small">${line}</span><br><span class="small muted">${sub}</span></span><span class="btn small">${btn}</span></a>`;
  return card("#/learn/cards", "house", "Flashcard Center", trad() ? "字卡中心" : "字卡中心", dueN ? `${dueN} card${dueN === 1 ? "" : "s"} to review today` : "All done for today", `${d.cards.length} in your deck`, "Review")
    + card("#/learn/temple", "temple", "HSK Temple", trad() ? "漢語廟" : "汉语庙", hskLine, "Every HSK word, and how well you know it", "Explore");
}
function soonCards(big) {
  const card = (img, t, z, line) => `<div class="card ztplace soon ${big ? "big" : ""}"><span class="ztplaceart">${ztImg(img)}</span>
    <span class="grow"><b>${t}</b> <span class="muted">${z}</span><br><span class="small muted">${line}</span></span><span class="ztsoon">Open soon</span></div>`;
  return card("library", "Library", trad() ? "圖書館" : "图书馆", "Still closed. Coming soon to Zest Town.")
    + card("callig", "Calligraphy School", trad() ? "書法學校" : "书法学校", "Still closed. Coming soon to Zest Town.");
}
function townMap(st) {
  const k = wide() ? "wide" : "phone", M = ZT_MAP[k], pct = (x, w) => `${(x / w) * 100}%`;
  const at = (x, y) => `left:${pct(x, M.w)};top:${pct(y, M.h)}`;
  const dueN = ztQueueAll().length, fruit = myFruitKey(), h0 = M.hops[0];
  return `<div class="ztmap ${k}" style="aspect-ratio:${M.w}/${M.h}">
    ${ztImg(`town-${k}`, "ztbg")}
    ${[["house", 21, 18, 43, 33, "a", "#/learn/cards", "Flashcard Center"], ["temple", 23, 19, 46, 36, "a", "#/learn/temple", "HSK Temple"],
      ["library", 21, 18, 42, 34, "b", "library", "Library, opening soon"], ["callig", 21, 18, 42, 34, "b", "callig", "Calligraphy School, opening soon"]]
      .map(([key, ox, oy, bw, bh, tag, to, label]) => { const [x, y] = M[key], st = `${at(x - ox, y - oy)};width:${pct(bw, M.w)};height:${pct(bh, M.h)}`;
        return tag === "a" ? `<a class="zthit" href="${to}" style="${st}" aria-label="${label}"></a>` : `<button type="button" class="zthit" data-zt="soon" data-v="${to}" style="${st}" aria-label="${label}"></button>`; }).join("")}
    <div class="ztriver" style="top:${pct(M.river[0], M.h)};height:${pct(M.river[1], M.h)}" aria-hidden="true"><img class="px" src="icons/zt/river-${k}.png" alt="" draggable="false"></div>
    <img class="px ztbridge" src="icons/zt/bridge-${k}.png" alt="" draggable="false" style="${at(M.bridge[0], M.bridge[1])};width:${pct(M.bridge[2], M.w)}">
    ${(() => { const [x, y, sz] = M.fsign, k = sz / 24; return `<a class="ztsignwrap" href="#/learn/forest" style="${at(x, y)};width:${pct(sz, M.w)}" aria-label="To the Magical Forest">${ztImg("sign-forest")}<span class="ztsigntext" style="width:${(16 / 24) * 100}%;height:${(11 / 18) * 100}%;font-size:${(k * 1.75 / M.w) * 100}cqw">MAGICAL<br>FOREST</span></a>`; })()}
    ${M.bushes.map(([x, y], i) => `<img class="px ztbush" src="icons/zt/bush.png" alt="" draggable="false" style="${at(x, y)};width:${pct(15, M.w)};animation-delay:-${(i * 0.7) % 3}s">`).join("")}
    <button type="button" class="zttreebtn" data-zt="sheet" style="${at(...M.tree)};width:${pct(42, M.w)}" aria-label="Your streak tree">${treeImg(st)}</button>
    ${st.wilted ? "" : `<button type="button" class="ztfruit" data-zt="cheer" style="${at(...h0)};width:${pct(18, M.w)}" aria-label="Your fruit"><span class="ztbubble" hidden></span>${ztImg("fruit-" + fruit)}</button>`}
    <a class="ztlabel" href="#/learn/cards" style="${at(M.house[0], M.house[1] + 15)}" aria-label="Flashcard Center, ${dueN} due">FLASHCARDS${dueN ? `<em>${dueN}</em>` : ""}</a>
    <a class="ztlabel" href="#/learn/temple" style="${at(M.temple[0], M.temple[1] + 17)}" aria-label="HSK Temple">HSK TEMPLE</a>
    <button type="button" class="ztlabel soon" data-zt="soon" data-v="library" style="${at(M.library[0], M.library[1] + 15)}" aria-label="Library, opening soon">LIBRARY<em>SOON</em></button>
    <button type="button" class="ztlabel soon" data-zt="soon" data-v="callig" style="${at(M.callig[0], M.callig[1] + 15)}" aria-label="Calligraphy School, opening soon">CALLIGRAPHY<em>SOON</em></button>
    <button type="button" class="ztlabel day ${st.wilted ? "dead" : ""}" data-zt="sheet" style="${at(M.plaza[0], M.plaza[1] + 11)}">${st.wilted ? "WILTED" : `DAY ${st.n}`}</button>
  </div>`;
}
function townView() {
  const st = ztStreak(), L = state.lu, list = L.view === "list";
  const toggle = `<div class="seg ztseg" role="group" aria-label="Show Zest Town as"><button type="button" data-zt="view" data-v="town" aria-pressed="${!list}">Town</button><button type="button" data-zt="view" data-v="list" aria-pressed="${list}">List</button></div>`;
  let body;
  if (list) body = `${treeCard(st, wide())}${todayCard(st)}<h2 style="margin:4px 0 0">Places</h2><div class="ztplaces">${placeCards(wide())}</div><h2 style="margin:4px 0 0">Opening soon</h2><div class="ztplaces">${soonCards(wide())}</div>`;
  else if (wide()) body = `<div class="ztwide">${townMap(st)}<div class="ztside">${treeCard(st)}${todayCard(st)}${placeCards()}</div></div>`;
  else body = `${townMap(st)}${todayCard(st)}`;
  setTimeout(ztHop, 50);
  return `${ztHeader(st)}${toggle}${body}${L.sheet === "tree" ? treeSheet(st) : ""}${st.wilted && L.sheet !== "tree" ? wiltedModal(st) : ""}`;
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
    <div class="ztinfo"><div class="card"><b>What counts</b><span class="small">Joining a session, or playing a game in Zest Town (a flashcard review), once a day.</span></div>
      <div class="card water">${ZT_DROP}<b>${w} watering can</b><span class="small">${w ? "left this month. If you miss a day, it brings your tree back." : "used this month. You get a new one on the 1st."}</span></div></div>
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
  <p class="muted small" style="margin-top:-6px">${d.cards.length} card${d.cards.length === 1 ? "" : "s"} in your deck. Words from your sessions are added for you.</p>
  <div class="card ztreviewall"><span class="ztplaceart">${ztImg("house")}</span><div class="grow"><b style="font-size:18px">Review all</b>
    <div class="small"><span style="color:#1f6fa3;font-weight:700">${newN} new</span> · <span style="color:var(--green);font-weight:700">${dueN} to review</span></div>
    <button type="button" class="btn" data-zt="start-all" ${q.length ? "" : "disabled"}>${q.length ? `Start · about ${Math.max(1, Math.round(q.length * 0.25))} min` : "All done for today"}</button></div></div>
  <div class="card"><div class="row between"><b>From a session</b><span class="small muted">${ses.length} session${ses.length === 1 ? "" : "s"}</span></div>
    ${ses.length ? ses.map(({ sid, cs, s }) => { const n = dueOf(cs); return `<button type="button" class="ztrow" data-zt="start-ses" data-id="${esc(sid)}"><span class="grow"><b>${esc(s?.title || "Session")}</b><br><span class="small muted">${s ? esc(new Date(s.starts_at).toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" })) + " · " : ""}${cs.length} word${cs.length === 1 ? "" : "s"}</span></span><span class="small ${n ? "duec" : "muted"}">${n ? `${n} due` : "Practice"}</span><span class="chev">›</span></button>`; }).join("")
      : `<p class="small muted" style="margin:0">When a host publishes notes for a session you joined, its words appear here.</p>`}</div>
  <div class="card"><div class="row between"><b>By HSK level</b><a class="small" href="#/learn/temple">+ Add words in the HSK Temple</a></div>
    <div class="ztlvgrid">${[...HSK_LEVELS, "none"].map((lv) => { const cs = lvCards(lv), n = dueOf(cs); return `<button type="button" class="ztlv ${lv === "none" ? "other" : ""}" data-zt="start-lv" data-v="${lv}" ${cs.length ? "" : "disabled"}><b>${lv === "none" ? "Not in HSK" : `HSK ${lv}`}</b><small>${cs.length} card${cs.length === 1 ? "" : "s"}</small><small class="${n ? "duec" : ""}">${n ? `${n} due` : "—"}</small></button>`; }).join("")}</div><p class="small muted" style="margin:0">“Not in HSK”: words from your sessions that aren’t on the official HSK lists.</p></div>
  <div class="card row between" style="flex-direction:row;align-items:center"><span><b>New cards a day</b><br><span class="small muted">How many new words Review all adds each day.</span></span>
    <span class="row" style="gap:8px;align-items:center"><button type="button" class="ztstep" data-zt="per" data-v="-1" aria-label="Fewer">−</button><b style="min-width:24px;text-align:center">${state.lu.perDay}</b><button type="button" class="ztstep" data-zt="per" data-v="1" aria-label="More">+</button></span></div>`;
}
function reviewView() {
  const R = state.lu.review;
  if (R.finished) {
    const st = ztStreak();
    return `${ztHeader(st, "Flashcard Center <span class='zhsub'>字卡中心</span>")}
    <div class="card ztdone"><span class="zttreeart lg">${treeImg(st)}</span><h2>太棒了！ Well done</h2>
      <p>You reviewed <b>${R.done} card${R.done === 1 ? "" : "s"}</b>.${R.counted || st.doneToday ? " Today counts for your streak tree." : ""}</p>
      <div class="row" style="gap:8px;flex-wrap:wrap;justify-content:center"><button type="button" class="btn" data-zt="end">Back to the Flashcard Center</button><a class="btn ghost" href="#/learn" data-zt="end">Go to Zest Town</a></div></div>`;
  }
  const c = R.queue[R.i], s = c.session_id && ztSession(c.session_id);
  const src = c.source === "session" && s ? `From “${esc(s.title)}”` : c.hsk_level ? `HSK ${esc(c.hsk_level)}` : "";
  const g = [["Again", 0, "again"], ["Hard", 1, "hard"], ["Good", 2, "good"], ["Easy", 3, "easy"]];
  const scheduled = c.reps === 0 || c.due <= todayKey();
  return `${ztHeader(null, esc(R.title))}
  <div class="ztprog"><span>${Math.min(R.i + 1, R.queue.length)} / ${R.queue.length}</span><span class="ztbar"><i style="width:${(R.i / R.queue.length) * 100}%"></i></span><button type="button" class="link small" data-zt="end">Stop</button></div>
  <button type="button" class="ztcard ${R.flipped ? "flipped" : ""}" data-zt="flip" aria-label="${R.flipped ? "Answer shown" : "Show the answer"}">
    ${c.reps === 0 ? `<span class="ztnew">New</span>` : ""}
    <span class="ztzh">${esc(cardZh(c))}</span>
    ${R.flipped ? `<span class="ztpy">${esc(c.pinyin)}</span><span class="ztmean">${esc(c.meaning)}</span>${src ? `<span class="small muted">${src}</span>` : ""}` : `<span class="small muted">Say it out loud, then tap to check</span>`}
  </button>
  ${R.flipped ? `<div class="ztgrades">${g.map(([t, v, cls]) => `<button type="button" class="${cls}" data-zt="grade" data-v="${v}"><b>${t}</b><small>${scheduled ? ivText(ztPreview(c, v)) : "practice"}</small></button>`).join("")}</div>`
    : `<button type="button" class="btn block" data-zt="flip">Show answer</button>`}
  ${R.cram && !scheduled ? `<p class="small muted" style="text-align:center">Practice mode: cards that aren't due yet keep their schedule.</p>` : ""}`;
}
function templeView() {
  const L = state.lu, lv = L.lv, words = L.hsk.get(lv), ws = ztWordStatus();
  if (!words) ztLoadLevel(lv);
  const pills = HSK_LEVELS.map((l) => `<button type="button" class="ztlvpill" data-zt="lv" data-v="${l}" aria-pressed="${l === lv}">HSK ${l}</button>`).join("");
  let main = `<p class="muted small">Loading HSK ${lv}…</p>`, side = "";
  if (words) {
    const cnt = { learned: 0, seen: 0, none: 0 };
    for (const w of words) cnt[statusOf(w, ws)]++;
    const T = words.length, pc = (n) => (n / T) * 100;
    const inDeck = new Set(L.cards.flatMap((c) => [c.hanzi, c.hanzi_trad].filter(Boolean)));
    const tiles = words.slice(0, L.show).map((w) => {
      const s = statusOf(w, ws), z = wordZh(w), picked = L.pick?.has(w.id), owned = inDeck.has(w.hanzi);
      return `<button type="button" class="zttile ${s} ${z.length > 2 ? "long" : ""} ${L.word === w.id ? "sel" : ""}" data-zt="${L.pick ? "tick" : "word"}" data-id="${w.id}" ${L.pick && s === "learned" ? "disabled" : ""} aria-label="${esc(z)} ${esc(w.pinyin)}">${esc(z)}${L.pick ? `<i class="tk ${picked ? "on" : ""}"></i>` : ""}</button>`;
    }).join("");
    const wsel = L.word && words.find((w) => w.id === L.word);
    if (wsel) {
      const s = statusOf(wsel, ws), owned = inDeck.has(wsel.hanzi);
      side = `<div class="card ztword" ${wide() ? "" : 'role="dialog"'}><div class="row between" style="align-items:flex-start"><span><span class="ztwz">${esc(wordZh(wsel))}</span> <span class="ztwp">${esc(wsel.pinyin)}</span></span>
        <button type="button" class="ztx" data-zt="word" data-id="" aria-label="Close">×</button></div>
        <div>${esc(wsel.meaning)}</div><div class="small muted">HSK ${esc(wsel.level)}${wsel.types ? " · " + esc(wsel.types) : ""}${wsel.hanzi_trad && wsel.hanzi_trad !== wsel.hanzi ? ` · ${trad() ? "简" : "繁"} ${esc(trad() ? wsel.hanzi : wsel.hanzi_trad)}` : ""}</div>
        <span class="ztst ${s}">${s === "learned" ? "Learned" : s === "seen" ? "Seen" : "Not yet"}</span>
        ${owned ? `<span class="small muted">In your flashcards</span>` : `<button type="button" class="btn" data-zt="add-word" data-id="${wsel.id}">+ Add to my flashcards</button>`}
        ${s === "learned" ? `<button type="button" class="link small" data-zt="unknow" data-id="${wsel.id}" style="align-self:flex-start">Not learned after all? Undo</button>`
          : `<button type="button" class="btn ghost ztknow" data-zt="know" data-id="${wsel.id}">✓ I already know this word</button>`}</div>`;
    }
    main = `<div class="card" style="gap:8px"><div class="row between"><b>HSK ${lv} · ${T.toLocaleString()} words</b><b style="color:var(--green)">${Math.round(pc(cnt.learned))}% learned</b></div>
      <div class="ztlvbar"><i class="l" style="width:${pc(cnt.learned)}%"></i><i class="s" style="width:${pc(cnt.seen)}%"></i></div>
      <div class="ztlegend"><span><i class="l"></i>Learned ${cnt.learned}</span><span><i class="s"></i>Seen ${cnt.seen}</span><span><i class="n"></i>Not yet ${cnt.none}</span></div></div>
      <div class="row between" style="align-items:center"><span class="small muted">${L.pick ? "Tick words, then add them or mark them as known" : "Tap a word to see it"}</span>
        <button type="button" class="ztselbtn ${L.pick ? "on" : ""}" data-zt="pick">${L.pick ? "Cancel" : "Select words"}</button></div>
      <div class="zttiles">${tiles}</div>
      ${T > L.show ? `<button type="button" class="btn ghost block" data-zt="more">Show more (${(T - L.show).toLocaleString()} left)</button>` : ""}
      ${L.pick ? `<div class="ztselbar"><span>${L.pick.size} word${L.pick.size === 1 ? "" : "s"} selected</span><span class="row" style="gap:6px"><button type="button" class="btn ghost small" data-zt="know-picked" ${L.pick.size ? "" : "disabled"}>✓ I know them</button><button type="button" class="btn small" data-zt="add-picked" ${L.pick.size ? "" : "disabled"}>Add to flashcards</button></span></div>` : ""}`;
  }
  const head = `<div class="ztthead"><span class="ztplaceart">${ztImg("temple")}</span><span class="small muted">Every HSK word, and how well you know it.<br>Grey: not met yet · light green: seen · dark green: learned.</span></div>`;
  return `${ztHeader(ztStreak(), `HSK Temple <span class='zhsub'>${trad() ? "漢語廟" : "汉语庙"}</span>`)}${head}<div class="ztlvpills">${pills}</div>
    ${wide() && side ? `<div class="ztcols"><div class="grow" style="min-width:0;display:flex;flex-direction:column;gap:12px">${main}</div><div class="ztsidecol">${side}</div></div>` : `${main}${side ? `<div class="ztwordsheet">${side}</div>` : ""}`}`;
}

async function ztAddWords(ws) {
  const have = new Set(state.lu.cards.map((c) => c.hanzi));
  const rows = ws.filter((w) => !have.has(w.hanzi)).map((w) => ({ hanzi: w.hanzi, hanzi_trad: w.hanzi_trad, pinyin: w.pinyin, meaning: w.meaning, hsk_level: w.level, source: "hsk" }))
    .filter((r, i, a) => a.findIndex((x) => x.hanzi === r.hanzi) === i);
  if (!rows.length) return 0;
  const { data, error } = await sb.from("learn_cards").upsert(rows, { onConflict: "user_id,hanzi", ignoreDuplicates: true }).select("*");
  if (error) { toast("Couldn't add those words. Check your connection."); return 0; }
  state.lu.cards.push(...data);
  return data.length;
}

// "I already know this word": a learned card due in 30 days (so it still comes back once in a while).
async function ztMarkKnown(words, known) {
  const L = state.lu, byHanzi = new Map(L.cards.map((c) => [c.hanzi, c]));
  const upd = known
    ? { good_streak: ZT_LEARNED, interval_days: 30, due: addDays(30), reps: 1, last_review: new Date().toISOString() }
    : { good_streak: 0, interval_days: 0, due: todayKey() };
  const have = words.filter((w) => byHanzi.has(w.hanzi)), fresh = known ? words.filter((w) => !byHanzi.has(w.hanzi)) : [];
  let n = 0;
  if (have.length) {
    const ids = have.map((w) => byHanzi.get(w.hanzi).id);
    const { error } = await sb.from("learn_cards").update(upd).in("id", ids);
    if (error) { toast("Couldn't save that. Check your connection."); return 0; }
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
  return n;
}

// Fruit hopping around the plaza
let ztHopTimer = null, ztHopAt = 0;
function ztHop() {
  if (ztHopTimer || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  ztHopTimer = setInterval(() => {
    const f = document.querySelector(".ztfruit"), map = f?.closest(".ztmap");
    if (!f) { clearInterval(ztHopTimer); ztHopTimer = null; return; }
    if (f.classList.contains("talk")) return;
    const M = ZT_MAP[map.classList.contains("wide") ? "wide" : "phone"];
    const prev = M.hops[ztHopAt % M.hops.length];
    ztHopAt = (ztHopAt + 1 + Math.floor(Math.random() * 2)) % M.hops.length;
    const [x, y] = M.hops[ztHopAt];
    f.classList.toggle("flip", x < prev[0]);
    f.classList.add("hopping");
    f.style.left = `${(x / M.w) * 100}%`; f.style.top = `${(y / M.h) * 100}%`;
    setTimeout(() => f.classList.remove("hopping"), 1500);
  }, 2600);
}

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
  else if (a === "more") { L.show += 600; render(); }
  else if (a === "word") { L.word = el.dataset.id ? +el.dataset.id : null; render(); }
  else if (a === "pick") { L.pick = L.pick ? null : new Set(); L.word = null; render(); }
  else if (a === "tick") { const id = +el.dataset.id; L.pick.has(id) ? L.pick.delete(id) : L.pick.add(id); keepForm(() => render()); }
  else if (a === "add-word" || a === "add-picked") {
    const words = L.hsk.get(L.lv) || [];
    const list = a === "add-word" ? words.filter((w) => w.id === +el.dataset.id) : words.filter((w) => L.pick.has(w.id));
    el.disabled = true;
    const n = await ztAddWords(list);
    if (a === "add-picked") L.pick = null;
    toast(n ? `Added ${n} word${n === 1 ? "" : "s"} to your flashcards.` : "Those words are already in your flashcards.");
    render();
  } else if (a === "know" || a === "know-picked" || a === "unknow") {
    const words = L.hsk.get(L.lv) || [];
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
  const { data, error } = await sb.rpc("forest_members");
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
const forestMember = (id) => state.lu.forest.list?.find((m) => m.user_id === id);
function forestMap(list) {
  const k = wide() ? "wide" : "phone", M = ZT_FOREST[k], F = state.lu.forest, pct = (x, w) => `${(x / w) * 100}%`;
  const at = (x, y) => `left:${pct(x, M.w)};top:${pct(y, M.h)}`;
  const fish = M.fish.map(([x, y, dx, dy, t, d]) => `<img class="px ztfish" src="icons/zt/fish.png" alt="" draggable="false" style="${at(x, y)};width:${pct(8, M.w)};--dx:${(dx / 8) * 100}%;--dy:${(dy / 4) * 100}%;animation-duration:${t}s;animation-delay:${d}s">`).join("");
  const members = list.map((m) => {
    const [x, y] = forestSpot(k, m.user_id), me = m.user_id === state.user.id, f = ZT_FRUITS.has(m.fruit) ? m.fruit : "orange";
    return `<button type="button" class="ztmem ${F.sel === m.user_id ? "sel" : ""} ${me ? "me" : ""}" data-zt="mem" data-id="${m.user_id}" data-k="${k}" style="${at(x, y)};width:${pct(16, M.w)}" aria-label="${esc(m.name || "Member")}">${ztImg("fruit-" + f)}<span class="ztmname">${esc((m.name || "Member").split(" ")[0])}${me ? " (you)" : ""}</span></button>`;
  }).join("");
  const [sx, sy] = M.sign;
  return `<div class="ztmap forest ${k}" style="aspect-ratio:${M.w}/${M.h}">
    ${ztImg(`forest-${k}`, "ztbg")}${fish}
    <a class="ztforestsign" href="#/learn" style="${at(sx + 4, sy - 1)};width:${pct(23, M.w)};height:${pct(9, M.h)};font-size:${((k === "wide" ? 2.35 : 1.85) / M.w) * 100}cqw" aria-label="Back to Zest Town">ZEST TOWN</a>
    ${members}
    ${list.length ? "" : `<div class="ztempty">Nobody else has been here in the last 24 hours. Come back later!</div>`}
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
    ${me ? "" : hongbaoGiveBlock(m.user_id) || `<p class="small muted" style="margin:0">Only members can send each other hongbaos.</p>`}
    <a class="small" style="font-weight:800;text-align:center" href="#/member/${m.user_id}">See ${esc((m.name || "their").split(" ")[0])}'s profile ›</a>
  </div>`;
}
function forestRows(list) {
  return list.map((m) => `<button type="button" class="ztfrow" data-zt="mem" data-id="${m.user_id}">${avatar({ ...(state.profiles.get(m.user_id) || {}), id: m.user_id, fruit: m.fruit, bg: m.bg }, 40, { flag: false })}
    <span class="grow"><b>${esc(m.name || "Member")}</b>${m.user_id === state.user.id ? " (you)" : ""}<br><span class="small muted">here ${esc(ago(m.last_seen).toLowerCase())}</span></span>
    <span class="ztleafn">${ZT_LEAF}${m.streak}</span></button>`).join("");
}
function forestView() {
  const F = state.lu.forest, st = ztStreak();
  forestLoad();
  const list = F.list || [];
  const head = `${ztHeader(st, "Magical Forest <span class='zhsub'>魔法森林</span>")}
    <p class="muted small" style="margin:-6px 0 0">${F.list ? `${list.length} member${list.length === 1 ? "" : "s"} opened the app in the last 24 hours.` : "Looking around the forest…"} ${list.length ? (wide() ? "Click one to see their streak or send a hongbao." : "Tap one to say hi.") : ""}</p>`;
  const sel = F.sel && forestMember(F.sel);
  const toggle = `<div class="seg ztseg" role="group" aria-label="Show the forest as"><button type="button" data-zt="fview" data-v="forest" aria-pressed="${F.view !== "list"}">Forest</button><button type="button" data-zt="fview" data-v="list" aria-pressed="${F.view === "list"}">List</button></div>`;
  setTimeout(forestHop, 60);
  if (F.view === "list") return `${head}${toggle}<div class="card" style="gap:0;padding:4px 14px">${forestRows(list) || `<p class="small muted">Nobody yet today.</p>`}</div>${sel ? (wide() ? `<div style="max-width:420px">${forestCard(sel)}</div>` : `<div class="ztover" data-zt="mem" data-id=""><div class="ztsheet" data-stop>${forestCard(sel)}</div></div>`) : ""}`;
  if (wide()) return `${head}${toggle}<div class="ztwide">${forestMap(list)}<div class="ztside">${sel ? forestCard(sel) : `<div class="card"><p class="small muted" style="margin:0">Click a fruit to see their streak tree and send them a hongbao.</p></div>`}
    ${list.length ? `<div class="card" style="gap:0;padding:6px 14px"><b style="padding:6px 0">Here today · ${list.length}</b>${forestRows(list)}</div>` : ""}</div></div>`;
  return `${head}${toggle}${forestMap(list)}${sel ? `<div class="ztover" data-zt="mem" data-id=""><div class="ztsheet" data-stop>${forestCard(sel)}</div></div>` : ""}`;
}
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
document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-zt]");
  if (!el) return;
  const a = el.dataset.zt, F = state.lu.forest;
  if (a === "mem") {
    if (e.target.closest("[data-stop]") && !e.target.closest(".ztx") && el.classList.contains("ztover")) return;
    if (e.target.closest(".hbcard, a")) return;
    F.sel = el.dataset.id || null; render();
  } else if (a === "fview") { F.view = el.dataset.v; lsSet("mz-forest-view", F.view); render(); }
});
