import { createClient } from "./vendor/supabase.js";
import { FRUITS, BACKGROUNDS, STARTER_FRUITS, fruitSvg, fruitInfo } from "./fruits.js";
import { COUNTRIES } from "./countries.js";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------
const SUPABASE_URL = "https://eypehvhcqzhwssydvrhn.supabase.co";
const SUPABASE_KEY = "sb_publishable_sFnX5WLyN96IvLDDRY96mw_6dJaG6BG";
const CLUB_PAGE = "https://www.mandarinzest.com/mandarin-zest-club";

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
const LEVEL_OPTIONS = ["", "Just starting", "HSK 1", "HSK 2", "HSK 3", "HSK 4", "HSK 5", "HSK 6", "HSK 7-9",
  "TOCFL A1", "TOCFL A2", "TOCFL B1", "TOCFL B2", "TOCFL C1", "TOCFL C2", "Native / heritage"];

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
};

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
  state.interests = new Map();
  for (const i of ints.data) {
    if (!state.interests.has(i.session_id)) state.interests.set(i.session_id, new Set());
    state.interests.get(i.session_id).add(i.user_id);
  }
  state.profiles = new Map(profs.data.map((p) => [p.id, p]));
  state.roles = new Map(roles.data.map((r) => [r.id, r.role]));
  state.me = state.profiles.get(state.user.id) || state.me;
  state.loaded = true;
}

async function startSession(user) {
  state.user = user;
  const { data, error } = await sb.rpc("start_session");
  if (error) throw error;
  state.role = data?.role ?? null;
  if (!state.role) return render();
  await loadAll();
  render();
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

function nav() {
  const r = route();
  const item = (id, label, icon) => `<a href="#/${id}" ${r === id ? 'aria-current="page"' : ""}>${icon}<span>${label}</span></a>`;
  return `<nav class="nav" aria-label="Main">
    <div class="brand"><img src="icons/logo.png" alt=""><span>MANDARIN ZEST CLUB</span></div>
    ${item("home", "Home", ICON.home)}${item("sessions", "My sessions", ICON.cal)}${item("members", "Members", ICON.people)}${item("me", "Me", ICON.me)}
  </nav>`;
}

function render() {
  if (!state.user) { app.innerHTML = loginView(); return; }
  if (!state.role) { app.innerHTML = notMemberView(); return; }
  if (!state.loaded) return;
  const views = { home: homeView, sessions: mySessionsView, members: membersView, me: profileView };
  const view = views[route()] || homeView;
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
  ${featuredCard(f)}
  ${installHint()}
  <div class="row between" style="align-items:baseline">
    <h2>Coming up</h2>
    ${tzCity ? `<span class="small muted">Times in ${esc(tzCity)}</span>` : ""}
  </div>
  <div class="slist">${rest.length ? grouped(rest) : `<p class="muted small">Nothing else planned yet.</p>`}</div>`;
}

function mySessionsView() {
  const mine = state.sessions.filter((s) => iAmIn(s));
  const next = mine.filter((s) => !ended(s));
  const past = mine.filter((s) => ended(s)).reverse();
  return `
  <header><div class="eyebrow">Mandarin Zest Club</div><h1>My sessions</h1></header>
  <h2>Coming up</h2>
  <div class="slist">${next.length ? grouped(next) : `<div class="card"><p class="muted small" style="margin:0">Tap <b>I'm in</b> on a session and it shows up here.</p></div>`}</div>
  <h2>Past sessions</h2>
  <div class="card mint"><div class="small" style="line-height:1.45"><b>Session notes are coming soon.</b> Your host's vocabulary, sentences and corrections will appear here after each session.</div></div>
  <div class="slist">${past.length ? past.map(sessionItem).join("") : `<p class="muted small">Sessions you joined in the last month will be listed here.</p>`}</div>`;
}

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------
function membersView() {
  const all = [...state.profiles.values()].filter((p) => state.roles.has(p.id) && (p.show_in_directory || p.id === state.user.id));
  const byName = (a, b) => (a.display_name || "").localeCompare(b.display_name || "");
  const hosts = all.filter((p) => ["host", "admin"].includes(state.roles.get(p.id))).sort(byName);
  const members = all.filter((p) => !["host", "admin"].includes(state.roles.get(p.id))).sort(byName);
  const sub = (p) => [p.chinese_level, p.discord ? `@${p.discord}` : ""].filter(Boolean).map(esc).join(" · ");
  return `
  <header><div class="eyebrow">Mandarin Zest Club</div><h1>Members</h1></header>
  ${hosts.length ? `<div class="daylabel">Hosts</div>
  <div class="hostgrid">${hosts.map((p) => `<div class="hostcard">${avatar(p, 44)}<div class="grow"><b style="display:block;overflow:hidden;text-overflow:ellipsis">${esc(p.display_name || "Host")}</b><div class="badge">HOST</div>${p.discord ? `<div class="small muted">@${esc(p.discord)}</div>` : ""}</div></div>`).join("")}</div>` : ""}
  <div class="daylabel">Members · ${members.length}</div>
  ${members.length ? `<div class="mgrid">${members.map((p) => `<div class="mcard">${avatar(p, 52)}<b>${esc(p.display_name || "Member")}${p.id === state.user.id ? " (you)" : ""}</b><span class="small muted">${sub(p) || "&nbsp;"}</span></div>`).join("")}</div>`
    : `<p class="muted small">Members appear here once they've logged in.</p>`}
  <p class="small muted">Leaderboard and XP are coming soon. Prefer not to be listed? Turn it off in <a href="#/me">Me</a>.</p>`;
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
  const level = 1; // XP and levels arrive in phase 3
  const changed = ["display_name", "fruit", "bg", "country", "chinese_level", "discord", "show_in_directory", "script"]
    .some((k) => d[k] !== state.me[k]);
  return `
  <header class="row" style="gap:16px">
    ${avatar(d, 96)}
    <div class="grow">
      <div class="eyebrow">${state.role === "admin" ? "Admin" : state.role === "host" ? "Host" : "Member"}</div>
      <h1>${esc(d.display_name || "Me")}</h1>
      <div style="font-size:15px;font-weight:700;color:var(--orange-ink);margin-top:4px">${zh(info.zh)} <span style="font-weight:600">${esc(info.py[idx])}</span></div>
    </div>
  </header>

  <form class="stack" data-form="profile" style="gap:16px">
    <label class="field">Name others see
      <input class="input" name="display_name" maxlength="40" value="${esc(d.display_name)}" autocomplete="nickname">
    </label>

    <div>
      <div class="row between" style="align-items:baseline;margin-bottom:8px"><h2>Your fruit</h2><span class="small muted">Earn XP to unlock more</span></div>
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
      <span style="font-size:14.5px;line-height:1.35"><b>Show me in the member directory</b><br><span class="muted">Hosts can always see who's coming to their session.</span></span>
    </label>

    <button class="btn block" ${changed ? "" : "disabled"}>${changed ? "Save changes" : "Saved"}</button>
  </form>

  ${installHint(true)}
  <div class="row between">
    <span class="small muted">${esc(state.user.email)}</span>
    <button class="linkbtn" data-act="logout">Log out</button>
  </div>`;
}

async function saveProfile() {
  const d = draft();
  const patch = {};
  for (const k of ["display_name", "fruit", "bg", "country", "chinese_level", "discord", "show_in_directory", "script"]) patch[k] = d[k];
  patch.display_name = String(patch.display_name || "").trim().slice(0, 40);
  patch.discord = String(patch.discord || "").trim().replace(/^@/, "").slice(0, 40);
  const { data, error } = await sb.from("profiles").update(patch).eq("id", state.user.id).select().single();
  if (error) { toast("Couldn't save. Please try again."); return; }
  state.me = data; state.profiles.set(data.id, data); state.draft = null;
  toast("Saved");
  render();
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
  }
});

document.addEventListener("input", (e) => {
  const form = e.target.closest('form[data-form="profile"]');
  if (!form || !e.target.name) return;
  const d = draft();
  d[e.target.name] = e.target.type === "checkbox" ? e.target.checked : e.target.value;
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
  }
});

// Re-render the profile without losing typed values in text fields.
function keepForm(fn) {
  const form = document.querySelector('form[data-form="profile"]');
  if (form) for (const input of form.querySelectorAll("input[name], select[name]")) {
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

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
