import { createClient } from "./vendor/supabase.js?v=8";
import { FRUITS, HOST_AVATARS, BACKGROUNDS, fruitSvg, fruitInfo, levelFor, progress, XP_SESSION, XP_STREAK, XP_BOOTCAMP } from "./fruits.js?v=8";
import { COUNTRIES } from "./countries.js?v=8";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------
const SUPABASE_URL = "https://eypehvhcqzhwssydvrhn.supabase.co";
const SUPABASE_KEY = "sb_publishable_sFnX5WLyN96IvLDDRY96mw_6dJaG6BG";
const CLUB_PAGE = "https://www.mandarinzest.com/mandarin-zest-club";
const DISCORD_CHAT = "https://discord.com/channels/1560844923874443297/1561210422533820587";

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
const LEVEL_OPTIONS = ["", "Beginner", "Lower intermediate", "Intermediate", "Upper intermediate", "Advanced"];
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
};
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
  bell: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8 a6 6 0 0 1 12 0 c0 7 3 9 3 9 H3 s3 -2 3 -9"/><path d="M10.3 21 a1.94 1.94 0 0 0 3.4 0"/></svg>',
  phone: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="6" y="2" width="12" height="20" rx="3"/><path d="M11 18 h2"/></svg>',
};

function avatar(p, size, { locked = false, flag = true, fruit, bg } = {}) {
  const f = fruit || p?.fruit || "orange";
  const c = flag && !locked ? p?.country : "";
  return `<span class="av${locked ? " locked" : ""}" style="--s:${size}px;--bg-av:${esc(bg || p?.bg || "#fdf1ea")}">` +
    `<span class="disc">${fruitSvg(f)}</span>` +
    (c ? `<img class="flag" src="flags/${esc(c)}.svg" alt="${esc(countryName(c))}" loading="lazy">` : "") +
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
  const [att, notes, board, awards] = await Promise.all([
    sb.from("attendance").select("session_id, user_id"),
    sb.from("session_notes").select("*"),
    sb.rpc("xp_board"),
    sb.from("xp_awards").select("*").order("awarded_at", { ascending: false }),
    sb.rpc("member_stats"),
  ]).then((r) => { stats = r.pop(); return r; });
  for (const r of [att, notes, board, awards]) if (r.error) throw r.error;
  if (!stats.error) state.stats = new Map(stats.data.map((x) => [x.user_id, x.sessions]));
  state.board = board.data;
  state.awards = awards.data;
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
  }
}

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
      <img src="icons/logo.png" alt="Mandarin Zest logo" width="132" height="101">
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
      <img src="icons/logo.png" alt="Mandarin Zest logo" width="132" height="101">
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
    ${item("home", "Home", ICON.home)}${item("sessions", "My sessions", ICON.cal)}${item("members", "Members", ICON.people)}${item("me", "Me", ICON.me)}
    <a class="navchat" href="${DISCORD_CHAT}" target="_blank" rel="noopener">${ICON.chat}<span>Chat on Discord</span></a>
  </nav>`;
}

function render() {
  if (!state.user) { app.innerHTML = loginView(); return; }
  if (!state.role) { app.innerHTML = notMemberView(); return; }
  if (!state.loaded) return;
  const views = { home: homeView, sessions: mySessionsView, members: membersView, me: profileView, host: hostView, member: memberView };
  const blocked = route() === "host" && !isHost();
  const view = blocked ? homeView : (views[route()] || homeView);
  app.innerHTML = `<div class="shell ${trad() ? "zh-trad" : ""}">${nav()}<main class="main" id="main">${view()}</main></div>`;
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
    <div class="row">${goingAvatars(s)}<div class="small muted">${goingLine(s)}${s.host_name ? ` · host ${esc(s.host_name)}` : ""}${s.level ? ` · ${esc(s.level)}` : ""}</div></div>
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

function homeView() {
  const me = state.me, f = featured();
  const rest = upcoming().filter((s) => s !== f).slice(0, 14);
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
  ${installHint()}
  <div class="row between" style="align-items:baseline">
    <h2>Coming up</h2>
    ${tzCity ? `<span class="small muted">Times in ${esc(tzCity)}</span>` : ""}
  </div>
  <div class="slist">${rest.length ? grouped(rest) : `<p class="muted small">Nothing else planned yet.</p>`}</div>`;
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
    <button type="button" class="btn ghost" data-act="notes-pdf" data-id="${esc(s.id)}" style="align-self:flex-start">${ICON.download}Download PDF</button>`;
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
  const hostRecent = isHost()
    ? state.sessions.filter((s) => Date.parse(s.starts_at) <= Date.now() + 30 * 60e3 && Date.parse(s.starts_at) > Date.now() - 21 * 864e5).reverse()
    : [];
  return `
  <header><div class="eyebrow">Mandarin Zest Club</div><h1>My sessions</h1></header>
  ${hostRecent.length ? `<h2>Hosting: attendance &amp; notes</h2>
  <div class="slist">${hostRecent.map((s) => {
    const n = state.notes.get(s.id), count = (state.attendance.get(s.id) || new Set()).size;
    const status = n?.published_at ? "Notes published" : n ? "Draft notes" : "No notes yet";
    const a = new Date(s.starts_at);
    return `<a class="sitem hostrow" href="${hostLink(s)}"><div class="top">
      <span class="grow"><div class="stitle">${esc(s.title)}</div>
      <div class="smeta">${esc(dayName(a))} · ${fmtTime(a)} · ${count} attended · ${status}</div></span>
      <span class="toggle" style="display:inline-flex;align-items:center">Open</span></div></a>`;
  }).join("")}</div>` : ""}
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
      <span class="small ${n?.published_at ? "" : "muted"}" style="${n?.published_at ? "color:var(--green);font-weight:700" : ""}">${n?.published_at ? "Published" : n ? "Draft: only hosts see it" : "Not started"}</span></div>
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
      <button type="button" class="btn ghost grow" data-act="note-save">Save draft</button>
      <button type="button" class="btn grow" data-act="note-publish">${n?.published_at ? "Update notes" : "Publish notes"}</button>
    </div>
    <div class="small muted" style="text-align:center">${n?.published_at ? "Members already got the \"Notes are up\" notification. Updates don't notify again." : "Publishing notifies everyone who came or said they'd come."}</div>
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
    toast(r.data?.first ? "Published! Members will be notified." : "Notes updated");
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
    <button type="button" role="tab" aria-selected="${!lb}" data-act="mtab" data-v="all">Everyone</button>
  </div>
  ${lb ? leaderboard() : directory()}`;
}

const memberLink = (id) => `#/member/${id}`;
const linkOrDiv = (id, cls, inner) => {
  const href = memberLink(id);
  return href ? `<a class="${cls}" href="${href}">${inner}</a>` : `<div class="${cls}">${inner}</div>`;
};

function leaderboard() {
  const period = state.lbPeriod, k = period === "month" ? "month" : "total";
  const list = rankList(period);
  const month = new Date().toLocaleDateString([], { month: "long" });
  const periods = `<div class="periods" role="group" aria-label="Period">
    <button type="button" data-act="lbp" data-v="month" aria-pressed="${period === "month"}">${esc(month)}</button>
    <button type="button" data-act="lbp" data-v="all" aria-pressed="${period === "all"}">All time</button></div>`;
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
  <div class="small muted" style="text-align:center">${period === "month" ? `XP earned in ${esc(month)}` : "All XP ever earned"}</div>
  ${podium}
  <div class="stack" style="gap:6px">${rest}</div>
  ${!isHost() && mine && mine <= 3 ? `<p class="small" style="text-align:center;margin:0"><b>You're #${mine}!</b></p>` : ""}
  <p class="small muted" style="margin:0">+${XP_SESSION} XP per session · +${XP_STREAK} XP every 4 weeks in a row · +${XP_BOOTCAMP} XP per bootcamp. Hosts don't take part.</p>`;
}

function directory() {
  const all = [...state.profiles.values()].filter((p) => state.roles.has(p.id) && (p.show_in_directory || p.id === state.user.id));
  const byName = (a, b) => (a.display_name || "").localeCompare(b.display_name || "");
  const hosts = all.filter((p) => ["host", "admin"].includes(state.roles.get(p.id))).sort(byName);
  const members = all.filter((p) => !["host", "admin"].includes(state.roles.get(p.id))).sort(byName);
  const levelOf = (id) => state.board.find((r) => r.user_id === id)?.level || 1;
  const sub = (p) => [`Lv ${levelOf(p.id)}`, p.chinese_level, p.discord ? `@${p.discord}` : ""].filter(Boolean).map(esc).join(" · ");
  return `
  ${hosts.length ? `<div class="daylabel">Hosts</div>
  <div class="hostgrid">${hosts.map((p) => linkOrDiv(p.id, "hostcard", `${avatar(p, 44)}<div class="grow"><b style="display:block;overflow:hidden;text-overflow:ellipsis">${esc(p.display_name || "Host")}</b><div class="badge">HOST</div>${p.discord ? `<div class="small muted">@${esc(p.discord)}</div>` : ""}</div>`)).join("")}</div>` : ""}
  <div class="daylabel">Members · ${members.length}</div>
  ${members.length ? `<div class="mgrid">${members.map((p) => linkOrDiv(p.id, "mcard", `${avatar(p, 52)}<b>${esc(p.display_name || "Member")}${p.id === state.user.id ? " (you)" : ""}</b><span class="small muted">${sub(p) || "&nbsp;"}</span>`)).join("")}</div>`
    : `<p class="muted small">Members appear here once they've logged in.</p>`}
  <p class="small muted">Tap someone to see their profile. Prefer not to be listed? Turn it off in <a href="#/me">Me</a>.${isAdmin() ? " As admin, you can give XP from a member's profile." : ""}</p>`;
}

// ---------------------------------------------------------------------------
// One member's profile card (everyone); admins can also give XP here
// ---------------------------------------------------------------------------
function memberView() {
  const id = routeArg();
  const r = state.board.find((x) => x.user_id === id);
  const full = state.profiles.get(id);
  const p = full || (r && { id, display_name: r.name, fruit: r.fruit, bg: r.bg, country: r.country });
  if (!p) return `<a class="linkbtn" href="#/members">← Back</a><div class="card"><h2>Member not found</h2></div>`;
  const role = state.roles.get(id), host = role === "host" || role === "admin";
  const me = id === state.user.id;
  const xp = r?.total || 0, pr = progress(xp);
  const sessions = state.stats.get(id) || 0;
  const info = fruitInfo(p.fruit), idx = trad() ? 1 : 0;
  const facts = [
    host ? null : [`Level ${pr.level}`, `${xp.toLocaleString()} XP${r?.month ? ` · ${r.month.toLocaleString()} this month` : ""}`],
    [String(sessions), sessions === 1 ? "session attended" : "sessions attended"],
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
  ${full?.discord ? `<a class="chatcard" style="display:flex" href="${DISCORD_CHAT}" target="_blank" rel="noopener">${ICON.chat}<span class="grow"><b>@${esc(full.discord)}</b><br><span class="small">Say hi on the Club Discord</span></span><span aria-hidden="true" style="font-size:20px">↗</span></a>` : ""}
  ${!full && !me ? `<p class="small muted" style="margin:0">This member keeps their profile out of the directory.</p>` : ""}
  ${isAdmin() ? adminXpBlock(id, r, awards) : ""}`;
}

function adminXpBlock(id, r, awards) {
  return `
  <form class="card" data-form="award" style="gap:12px">
    <div class="row between" style="align-items:baseline"><h2>Give XP</h2><span class="small muted">Admin only</span></div>
    ${r ? "" : `<div class="small muted">Hosts and admins don't earn XP.</div>`}
    <div class="periods" style="justify-content:flex-start" role="group" aria-label="Kind">
      <button type="button" data-act="award-kind" data-v="bootcamp" aria-pressed="${(state.awardKind || "bootcamp") === "bootcamp"}">Bootcamp +${XP_BOOTCAMP}</button>
      <button type="button" data-act="award-kind" data-v="bonus" aria-pressed="${state.awardKind === "bonus"}">Other bonus</button>
    </div>
    <div class="grid2">
      <label class="field">Points<input class="input" name="points" type="number" min="-2000" max="2000" step="1" value="${state.awardKind === "bonus" ? 50 : XP_BOOTCAMP}" required></label>
      <label class="field">Reason<input class="input" name="reason" maxlength="120" placeholder="${state.awardKind === "bonus" ? "e.g. helped a new member" : "e.g. Pronunciation Bootcamp, Jan 2027"}"></label>
    </div>
    <button class="btn green block" ${r ? "" : "disabled"}>Give XP</button>
    <div class="small muted">Use a negative number to correct a mistake. Members see their own awards.</div>
  </form>
  <section class="card" style="gap:0">
    <h2 style="margin-bottom:6px">XP given by admins</h2>
    ${awards.length ? awards.map((a) => `<div class="awardrow"><b style="width:64px">${a.points > 0 ? "+" : ""}${a.points}</b>
      <span class="grow">${esc(a.kind === "bootcamp" ? "Bootcamp" : "Bonus")}${a.reason ? ` · ${esc(a.reason)}` : ""}<br><span class="small muted">${new Date(a.awarded_at).toLocaleDateString()}</span></span>
      <button type="button" class="xbtn" data-act="award-del" data-id="${a.id}" aria-label="Remove this award">×</button></div>`).join("")
      : `<p class="small muted" style="margin:0">None yet. Session XP comes from attendance ticks.</p>`}
  </section>`;
}

async function giveXp(form) {
  const id = routeArg();
  const points = parseInt(form.points.value, 10);
  if (!points || Math.abs(points) > 2000) { toast("Enter a number of points."); return; }
  const kind = state.awardKind || "bootcamp";
  const { data, error } = await sb.from("xp_awards").insert({ user_id: id, points, kind, reason: form.reason.value.trim().slice(0, 120) }).select().single();
  if (error) { toast("Couldn't give XP."); return; }
  state.awards.unshift(data);
  await refreshBoard();
  toast(`${points > 0 ? "+" : ""}${points} XP given`);
}

async function refreshBoard() {
  const { data } = await sb.rpc("xp_board");
  if (data) state.board = data;
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
  const changed = ["display_name", "fruit", "bg", "country", "chinese_level", "discord", "show_in_directory", "script", "bio"]
    .some((k) => d[k] !== state.me[k]);
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

    <div>
      <h2 style="margin-bottom:8px">Background</h2>
      <div class="swatches">${BACKGROUNDS.map(([hex, name]) =>
        `<button type="button" class="swatch" style="background:${hex}" data-act="bg" data-hex="${hex}" aria-label="${name}" aria-pressed="${hex === d.bg}"></button>`).join("")}</div>
    </div>

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
  for (const k of ["display_name", "fruit", "bg", "country", "chinese_level", "discord", "show_in_directory", "script", "bio"]) patch[k] = d[k];
  patch.display_name = String(patch.display_name || "").trim().slice(0, 40);
  patch.discord = String(patch.discord || "").trim().replace(/^@/, "").slice(0, 40);
  patch.bio = String(patch.bio || "").replace(/\s+/g, " ").trim().slice(0, BIO_MAX);
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
    const { jsPDF, html2canvas } = await import("./vendor/pdf.js?v=8");
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
  } else if (act === "mtab") {
    state.membersTab = el.dataset.v; render();
  } else if (act === "lbp") {
    state.lbPeriod = el.dataset.v; render();
  } else if (act === "award-kind") {
    state.awardKind = el.dataset.v; render();
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

document.addEventListener("change", (e) => {
  const el = e.target;
  if (el.dataset.pref) savePref(el.dataset.pref, el.checked);
  else if (el.dataset.actChange === "attend-add" && el.value) setAttendance(routeArg(), el.value, true);
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
    app.innerHTML = `<main class="login"><div class="hero"><img src="icons/logo.png" alt="" width="132"><h1>Can't reach the Club</h1><p class="muted">Check your internet connection and try again.</p></div><button class="btn block" onclick="location.reload()">Try again</button></main>`;
  }
})();

sb.auth.onAuthStateChange((event) => {
  if (event === "SIGNED_OUT" && state.user) { state.user = null; state.role = null; render(); }
});

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js?v=8").catch(() => {});
