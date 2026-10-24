import { createClient } from "./vendor/supabase.js?v=26";
import { FRUITS, HOST_AVATARS, BACKGROUNDS, fruitSvg, fruitInfo, levelFor, progress, XP_SESSION, XP_STREAK, XP_BOOTCAMP } from "./fruits.js?v=26";
import { COUNTRIES } from "./countries.js?v=26";
const XP_HONGBAO = 30;
const MEMBER_CODE = "MZCLUB_8634D";                    // 50% off materials in the shop (Antoine, 24 Oct 2026)
const SHOP_URL = "https://www.mandarinzest.com/shop";
import { STICKERS, stickerInfo, stickerSvg, stickerForBootcamp } from "./stickers.js?v=26";

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

const CATEGORIES = {
  advanced: { label: "Advanced", color: "#3f6d5e" },
  intermediate: { label: "Intermediate", color: "#4f7a94" },
  beginner: { label: "Beginner", color: "#a8741f" },
  native: { label: "Native teacher", color: "#a63d2f" },
  character: { label: "Character focus", color: "#7d5a8c" },
  general: { label: "Open topic", color: "#6b6559" },
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
  catFilter: (() => { try { return localStorage.getItem("mz-cat") || ""; } catch { return ""; } })(),
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
const cat = (s) => CATEGORIES[s.category] || CATEGORIES.general;
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
  const hostTip = flag && !locked && size >= 64 && f.startsWith("host-") ? fruitInfo(f) : null;
  return `<span class="av${locked ? " locked" : ""}" style="--s:${size}px;--bg-av:${esc(bg || p?.bg || "#fdf1ea")}">` +
    `<span class="disc"${hostTip ? tipAttrs(`${hostTip.en} ${zh(hostTip.zh)}`, "A special character only Club hosts can use.") : ""}>${fruitSvg(f)}</span>` +
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
    sb.from("hongbaos").select("*").eq("giver", state.user.id).order("created_at", { ascending: false }).limit(1),
  ]).then((r) => { const hg = r.pop(), hi = r.pop(); state.hbIn = hi.error ? [] : hi.data; state.hbGiven = hg.error ? null : hg.data[0] || null; const mn = r.pop(), sh = r.pop(); state.meetName = mn.error ? "" : mn.data?.meet_name || ""; state.sessionHost = new Map(sh.error ? [] : sh.data.map((x) => [x.session_id, x.host_id])); const mb = r.pop(); state.bootcampsJoined = new Map(mb.error ? [] : mb.data.map((x) => [x.user_id, x.bootcamps])); const rw = r.pop(); state.rewards = new Map(rw.error ? [] : rw.data.map((x) => [x.bootcamp, x])); worn = r.pop(); stk = r.pop(); stats = r.pop(); return r; });
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
  if (!isHost()) {
    try {
      const lv = myLevel(), seen = +(localStorage.getItem("mz-level") || 0);
      if (seen && lv > seen) {
        const f = FRUITS.filter((x) => x.level > seen && x.level <= lv);
        setTimeout(() => toast(`Level ${lv}! You unlocked ${f.map((x) => zh(x.zh)).join(", ") || "a new fruit"}.`), 600);
      }
      localStorage.setItem("mz-level", String(lv));
    } catch { /* storage off */ }
    try {
      const mine = myStickers(), raw = localStorage.getItem("mz-stickers");
      const seen = raw ? JSON.parse(raw) : null;
      const fresh = seen ? mine.filter((k) => !seen.includes(k)) : [];
      if (fresh.length) setTimeout(() => toast(`New sticker! ${fresh.map((k) => stickerInfo(k)?.en).join(", ")}. Put it on your avatar in Me.`), 1400);
      localStorage.setItem("mz-stickers", JSON.stringify(mine));
    } catch { /* storage off */ }
  }
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
  return `<nav class="nav" aria-label="Main">
    <div class="brand"><img src="icons/logo.png" alt=""><span>MANDARIN ZEST CLUB</span></div>
    ${item("home", "Home", ICON.home)}${item("sessions", "My sessions", ICON.cal)}${item("members", "Members", ICON.people)}${item("bootcamps", "Bootcamps", ICON.seedling).replace("<a ", '<a class="deskonly" ')}${item("me", "Me", ICON.me)}
    <a class="navchat" href="${DISCORD_CHAT}" target="_blank" rel="noopener">${ICON.chat}<span>Chat on Discord</span></a>
  </nav>`;
}

function render() {
  if (!state.user) { app.innerHTML = loginView(); return; }
  if (!state.role) { app.innerHTML = notMemberView(); return; }
  if (!state.loaded) return;
  const views = { home: homeView, sessions: mySessionsView, members: membersView, me: profileView, host: hostView, member: memberView, bootcamps: bootcampsView, unlocks: unlocksView };
  const blocked = route() === "host" && !isHost();
  const view = blocked ? homeView : (views[route()] || homeView);
  app.innerHTML = `<div class="shell ${trad() ? "zh-trad" : ""}">${nav()}<main class="main" id="main">${view()}</main></div>${hongbaoOverlay()}`;
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
  return `<button type="button" class="toggle" data-act="toggle-in" data-id="${esc(s.id)}" aria-pressed="${on}">${on ? "Going ✓" : "I'm in"}</button>`;
}

function details(s) {
  const lines = [];
  if (s.topic) lines.push(`<div><b>Topic:</b> ${esc(s.topic)}</div>`);
  if (s.about) lines.push(`<div>${esc(s.about)}</div>`);
  if (s.host_name) lines.push(`<div><b>Host:</b> ${esc(s.host_name)}</div>`);
  const a = new Date(s.starts_at), b = s.ends_at ? new Date(s.ends_at) : null;
  lines.push(`<div class="muted">${esc(dayName(a))} · ${fmtTime(a)}${b ? `–${fmtTime(b)}` : ""}${s.level ? ` · ${esc(s.level)}` : ""}</div>`);
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
          <div class="smeta">${fmtTime(a)}${s.level ? ` · ${esc(s.level)}` : ""} · ${goingLine(s)}</div>
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
      <span class="chip" style="background:${c.color}">${esc(c.label)}</span>
      ${live ? `<span class="live">Live now</span>` : `<span class="when">${esc(dayName(a))} · ${fmtTime(a)}${rel ? ` · ${rel}` : ""}</span>`}
    </div>
    <div class="session-title">${esc(s.title)}</div>
    ${s.topic ? `<div class="muted" style="font-size:14.5px">${esc(s.topic)}</div>` : ""}
    ${hostRow(s)}
    <div class="row">${goingAvatars(s)}<div class="small muted">${goingLine(s)}${s.level ? ` · ${esc(s.level)}` : ""}</div></div>
    <div class="row" style="flex-wrap:wrap;gap:8px">
      ${s.meet_url ? `<a class="btn grow" href="${esc(s.meet_url)}" target="_blank" rel="noopener">${ICON.video}Join on Google Meet</a>` : ""}
      ${iAmIn(s) ? "" : inButton(s)}
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

function bootCard(b, st) {
  const today = ymd(new Date());
  const early = b.early && b.earlyEnds && today <= b.earlyEnds
    ? `Early bird ${esc(b.early)} until ${esc(new Date(b.earlyEnds + "T12:00:00").toLocaleDateString([], { day: "numeric", month: "short" }))}` : "";
  const facts = [["Dates", b.datesTbd ? `${b.month || "Dates"} (to be announced)` : b.dates], ["Time", b.time], ["Format", b.format],
    ["Level", b.level], ["Group", b.group],
    ["Sign up by", b.signupBy ? new Date(b.signupBy + "T12:00:00").toLocaleDateString([], { day: "numeric", month: "short" }) : ""]]
    .filter(([, v]) => v);
  const hosts = [...state.profiles.values()].filter((p) => ["host", "admin"].includes(state.roles.get(p.id))).map((p) => p.display_name).filter(Boolean);
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
      <div class="row" style="gap:10px;flex-wrap:wrap">
        <a class="btn discord grow" href="${DISCORD_CHAT}" target="_blank" rel="noopener">${ICON.chat}${st.open ? "Ask a host to join" : "Tell a host you're interested"}</a>
        ${b.url ? `<a class="btn ghost" href="${esc(b.url)}" target="_blank" rel="noopener">More info ↗</a>` : ""}
      </div>
      <div class="small muted">${hosts.length ? `Hosts: ${esc(hosts.join(", "))}. ` : ""}Tell them which bootcamp; they'll sign you up at the Club price.</div>
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
    <p class="muted" style="margin:6px 0 0;line-height:1.5;max-width:640px">Short, intensive courses run by our teachers. As a Club member you pay the Club price. To join, message one of the hosts and they'll sign you up.</p></header>
  ${state.bootcamps === null ? `<p class="muted small">Loading bootcamps…</p>`
    : state.bootcamps === "error" ? `<div class="card"><p class="small" style="margin:0">Couldn't load the bootcamps right now. <a href="${BOOTCAMPS_PAGE}" target="_blank" rel="noopener">See them on the website ↗</a></p></div>`
    : list.length ? `<div class="bootgrid">${list.map(({ b, st }) => bootCard(b, st)).join("")}</div>`
    : `<div class="card"><h2>No bootcamps planned right now</h2><p class="small muted" style="margin:0">New bootcamps will appear here as soon as they're on the website.</p></div>`}`;
}

// ---------- Month calendar (desktop) ----------
function calendarView() {
  const m = state.calMonth, y = m.getFullYear(), mo = m.getMonth();
  const first = new Date(y, mo, 1), start = new Date(y, mo, 1 - ((first.getDay() + 6) % 7));
  const byDay = new Map();
  const cf = CATEGORIES[state.catFilter] || null;
  for (const s of state.sessions) {
    if (s.cancelled || (cf && cat(s) !== cf)) continue;
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

function homeView() {
  const me = state.me, f = featured();
  const cf = CATEGORIES[state.catFilter] ? state.catFilter : "";
  const rest = upcoming().filter((s) => s !== f && (!cf || cat(s) === CATEGORIES[cf])).slice(0, 14);
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
    <h2>${wide() && state.view === "cal" ? "Calendar" : "Coming up"}</h2>
    <div class="row" style="gap:10px">
      ${tzCity ? `<span class="small muted">Times in ${esc(tzCity)}</span>` : ""}
      <div class="seg viewswitch" role="group" aria-label="View">
        <button type="button" data-act="view" data-v="list" aria-pressed="${state.view !== "cal"}">List</button>
        <button type="button" data-act="view" data-v="cal" aria-pressed="${state.view === "cal"}">Calendar</button>
      </div>
    </div>
  </div>
  <div class="catfilter" role="group" aria-label="Show only">
    <button type="button" data-act="catf" data-v="" aria-pressed="${!cf}">All</button>
    ${Object.entries(CATEGORIES).map(([k, c]) => `<button type="button" data-act="catf" data-v="${k}" aria-pressed="${cf === k}" style="--c:${c.color}"><i></i>${esc(c.label)}</button>`).join("")}
  </div>
  ${wide() && state.view === "cal" ? calendarView()
    : `<div class="slist">${rest.length ? grouped(rest) : `<p class="muted small">${cf ? `No upcoming ${esc(CATEGORIES[cf].label.toLowerCase())} sessions right now.` : "Nothing else planned yet."}</p>`}</div>`}`;
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
  return `
    ${vocab.length ? `<div class="vocab" role="table" aria-label="Vocabulary">${vocab.map((v) => `<div class="vrow" role="row"><span class="vz" role="cell">${esc(v.hanzi)}</span><span class="vp" role="cell">${esc(v.pinyin)}</span><span class="vm" role="cell">${esc(v.meaning)}</span></div>`).join("")}</div>` : ""}
    ${n.body ? `<div class="notebody">${linkify(n.body)}</div>` : ""}
    <div class="row" style="gap:8px;flex-wrap:wrap">
      <button type="button" class="btn ghost" data-act="notes-pdf" data-id="${esc(s.id)}">${ICON.download}Download PDF</button>
      ${isHost() ? `<a class="btn ghost" href="${hostLink(s)}">✎ Edit notes</a>` : ""}
    </div>`;
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
      <input class="input" aria-label="Word ${i + 1}, characters" data-vocab="${i}" data-k="hanzi" value="${esc(v.hanzi)}" placeholder="汉字" lang="zh">
      <input class="input" aria-label="Word ${i + 1}, pinyin" data-vocab="${i}" data-k="pinyin" value="${esc(v.pinyin)}" placeholder="pinyin">
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
  <a class="chatcard" href="${DISCORD_CHAT}" target="_blank" rel="noopener">${ICON.chat}
    <span class="grow"><b>Chat on Discord</b><br><span class="small">Say hi, ask questions, practise between sessions</span></span>
    <span aria-hidden="true" style="font-size:20px">↗</span></a>
  <div class="tabs" role="tablist">
    <button type="button" role="tab" aria-selected="${lb}" data-act="mtab" data-v="lb">Leaderboard</button>
    <button type="button" role="tab" aria-selected="${state.membersTab === "all"}" data-act="mtab" data-v="all">Everyone</button>
    <button type="button" role="tab" aria-selected="${state.membersTab === "map"}" data-act="mtab" data-v="map">Map</button>
  </div>
  ${lb ? leaderboard() : state.membersTab === "map" ? mapView() : directory()}`;
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
  const rest = list.slice(3).map((r, i) => linkOrDiv(r.user_id, `lbrow${r.user_id === state.user.id ? " me" : ""}`, `
      <span class="rk">${i + 4}</span>${avatar(row(r), 40)}
      <div class="grow"><b>${esc(r.name || "Member")}${r.user_id === state.user.id ? " (you)" : ""}</b><div class="small muted">Level ${r.level}</div></div>
      <b>${r[k]} XP</b>`)).join("");
  const mine = myRank(period);
  return `${periods}
  ${podium}
  <div class="stack" style="gap:6px">${rest}</div>
  ${!isHost() && mine && mine <= 3 ? `<p class="small" style="text-align:center;margin:0"><b>You're #${mine}!</b></p>` : ""}
  <p class="small muted" style="margin:0">+${XP_SESSION} XP per session · +${XP_STREAK} XP every 4 weeks in a row · XP for bootcamps · +${XP_HONGBAO} XP per hongbao received. Hosts don't take part.</p>`;
}

function directory() {
  const all = [...state.profiles.values()].filter((p) => state.roles.has(p.id) && (p.show_in_directory || p.id === state.user.id));
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
  <p class="small muted">Tap someone to see their profile. Prefer not to be listed? Turn it off in <a href="#/me">Me</a>.${isAdmin() ? " As admin, you can give XP from a member's profile." : ""}</p>`;
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
  if (!fresh.length || route() !== "me") return "";
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
    const [m, cc] = await Promise.all([import("./worldmap.js?v=26"), sb.rpc("country_counts")]);
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
    const shown = [...state.profiles.values()].filter((p) => p.country === sel && state.roles.has(p.id) && (p.show_in_directory || p.id === state.user.id))
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
  ${!full && !me ? `<p class="small muted" style="margin:0">This member keeps their profile out of the directory.</p>` : ""}
  ${hongbaoGiveBlock(id)}
  ${isAdmin() ? adminXpBlock(id, r, awards) : isHost() && role === "member" ? hostStickerBlock(id) : ""}`;
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

function profileView() {
  const d = draft(), info = fruitInfo(d.fruit), idx = trad() ? 1 : 0;
  const level = myLevel();
  const changed = ["display_name", "fruit", "bg", "country", "chinese_level", "discord", "show_in_directory", "script", "bio", "sticker"]
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
    <summary><span class="grow"><b>Avatar customization</b><span class="small muted">${isHost() ? "Character or fruit" : "Fruit"}, ${stickerKeys.length ? "sticker, " : ""}background colour</span></span><span class="chev" aria-hidden="true">›</span></summary>
    <div class="custbody">
    <a class="unlocklink" href="#/unlocks">${ICON.unlock}<span class="grow"><b>How to unlock avatars &amp; stickers</b><br><span class="small muted">Levels, bootcamps, special sessions and more</span></span><span aria-hidden="true">›</span></a>
    ${isHost() ? `<div>
      <div class="row between" style="align-items:baseline;margin-bottom:8px"><h2>Host characters</h2><span class="small muted">Only hosts can use these</span></div>
      <div class="fruits">${HOST_AVATARS.map((h) => `<button type="button" class="fruitbtn" data-act="fruit" data-key="${h.key}" aria-pressed="${h.key === d.fruit}" aria-label="${esc(h.en)} ${esc(zh(h.zh))}">
          <span class="ring">${avatar(d, 48, { flag: false, fruit: h.key })}</span>
          <span class="cap">${esc(zh(h.zh))}</span></button>`).join("")}</div>
    </div>` : ""}
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

    <label class="check">
      <input type="checkbox" name="show_in_directory" ${d.show_in_directory ? "checked" : ""}>
      <span style="font-size:14.5px;line-height:1.35"><b>Show me in the member directory</b><br><span class="muted">You still appear on the leaderboard, and hosts can always see who's coming to their session.</span></span>
    </label>

    <button class="btn block" ${changed ? "" : "disabled"}>${changed ? "Save changes" : "Saved"}</button>
  </form>

  ${hongbaoMeCard()}
  <section class="stack" style="gap:8px" aria-label="My personal discount code">
    <h2>My personal discount code</h2>
    <div class="row" style="gap:10px;flex-wrap:wrap;align-items:center">
      <button type="button" class="codechip" data-act="copy-code" aria-label="Copy discount code ${MEMBER_CODE}"><code>${MEMBER_CODE}</code><span aria-hidden="true">⧉</span></button>
      <a href="${SHOP_URL}" target="_blank" rel="noopener" style="font-weight:700;font-size:14.5px">Mandarin Zest shop ↗</a>
    </div>
    <span class="small muted">50% off all Mandarin Zest materials. Enter the code at checkout.</span>
  </section>
  ${notificationsCard()}
  ${installHint(true)}
  <div class="row between">
    <span class="small muted">${esc(state.user.email)}</span>
    <button class="linkbtn" data-act="logout">Log out</button>
  </div>`;
}

async function saveProfile() {
  const d = draft();
  const patch = {};
  for (const k of ["display_name", "fruit", "bg", "country", "chinese_level", "discord", "show_in_directory", "script", "bio", "sticker"]) patch[k] = d[k] ?? null;
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
    const { jsPDF, html2canvas } = await import("./vendor/pdf.js?v=26");
    const a = new Date(s.starts_at);
    const date = a.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long", year: "numeric" });
    const vocab = (n.vocab || []).filter((v) => v.hanzi || v.pinyin || v.meaning);
    const lines = (n.body || "").split("\n");

    const page = document.createElement("div");
    page.className = "pdfpage";
    page.innerHTML = `
      <div class="pdfhead pdfblock"><img src="icons/logo.png" alt="" width="64" height="49">
        <div><div class="eyebrow">Mandarin Zest Club · Session notes</div><h1>${esc(s.title)}</h1>
        <div class="pdfmeta">${esc(date)} · ${fmtTime(a)}${s.host_name ? ` · host ${esc(s.host_name)}` : ""}${s.level ? ` · ${esc(s.level)}` : ""}</div></div></div>
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
    ${tog("notify_reminders", "Session reminders", "1 hour before sessions you said you'd join")}
    ${tog("notify_new", "New sessions", "When a new session is added to the calendar")}
    ${tog("notify_notes", "Notes are up", "When your host shares the notes of a session you joined")}
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
  } catch { /* ignore */ }
  if (route() === "me") keepForm(() => render());
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

async function enablePush() {
  try {
    const perm = await Notification.requestPermission();
    state.push.permission = perm;
    if (perm !== "granted") { keepForm(() => render()); return; }
    const reg = await navigator.serviceWorker.ready;
    const sub = (await reg.pushManager.getSubscription())
      || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(VAPID_PUBLIC) });
    if (!(await saveSubscription(sub))) throw new Error("save");
    state.push.subscribed = true;
    toast("Notifications are on");
    keepForm(() => render());
    testPush(true);
  } catch (e) {
    console.error(e);
    toast("Couldn't turn on notifications. Try again.");
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
    render();
  } else if (act === "cal-open") {
    state.calPick = state.calPick === el.dataset.id ? null : el.dataset.id;
    if (state.calPick) state.open.add(state.calPick);
    render();
    if (state.calPick) document.querySelector(".cal + .slist")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  } else if (act === "copy-code") {
    try { await navigator.clipboard.writeText(MEMBER_CODE); toast("Code copied"); }
    catch { toast(`Your code: ${MEMBER_CODE}`); }
  } else if (act === "map-pick") {
    pickCountry(el.dataset.v);
  } else if (act === "map-zoom") {
    document.getElementById("worldmap")?._zoom?.(el.dataset.v === "in" ? 1.5 : 1 / 1.5);
  } else if (act === "hb-give") {
    el.disabled = true; await giveHongbao(el.dataset.id); el.disabled = false;
  } else if (act === "hb-seen") {
    for (const h of state.hbIn) h.seen_at = h.seen_at || new Date().toISOString();
    render();
    await sb.rpc("hongbao_seen");
  } else if (act === "back-custom") {
    state.custOpen = true;
  } else if (act === "host-all") {
    state.hostAll = !!el.dataset.v; render();
  } else if (act === "catf") {
    state.catFilter = el.dataset.v;
    try { localStorage.setItem("mz-cat", state.catFilter); } catch { /* storage off */ }
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
  if (e.target.matches?.("details.custom")) state.custOpen = e.target.open;
}, true);

document.addEventListener("change", (e) => {
  const el = e.target;
  if (el.dataset.pref) savePref(el.dataset.pref, el.checked);
  else if (el.dataset.actChange === "attend-add" && el.value) setAttendance(routeArg(), el.value, true);
  else if (el.dataset.actChange === "map-pick") pickCountry(el.value);
  else if (el.dataset.actChange === "award-camp") { state.awardCamp = el.value; state.awardSticker = undefined; render(); }
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
  } else if (!on) toast("See you there!");
}

addEventListener("hashchange", () => {
  if (route() !== "me") state.draft = null;
  if (route() !== "host") state.noteDraft.clear();
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

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js?v=26").catch(() => {});
