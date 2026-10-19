// Sends app notifications (Web Push) with an email fallback (Resend).
// Kinds:
//   reminder     1 hour before a session, to members who said "I'm in"
//   new_session  a new session (new calendar series) appears, to everyone who wants it (push only)
//   notes        the host published the notes, to attendees and "I'm in" members
import webpush from "npm:web-push@3.6.7";
// deno-lint-ignore no-explicit-any
type DB = any;

const APP_URL = "https://app.mandarinzest.com";
const FROM = "Mandarin Zest Club <club@mandarinzest.com>";

type Target = { user_id: string; email: string; name: string; timezone: string; allow_email: boolean };
type Session = { id: string; title: string; starts_at: string; meet_url: string; host_name: string };

function when(s: Session, tz: string) {
  const opts: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" };
  try { return new Date(s.starts_at).toLocaleString("en-US", { ...opts, timeZone: tz || "Europe/Brussels" }); }
  catch { return new Date(s.starts_at).toLocaleString("en-US", { ...opts, timeZone: "Europe/Brussels" }); }
}

function message(kind: string, s: Session, t: Target) {
  if (kind === "reminder") return {
    title: `Starting in 1 hour: ${s.title}`,
    body: `${when(s, t.timezone)}${s.host_name ? ` · host ${s.host_name}` : ""}. Tap to join.`,
    url: `${APP_URL}/#/home`,
    tag: `reminder-${s.id}`,
  };
  if (kind === "new_session") return {
    title: `New session: ${s.title}`,
    body: `${when(s, t.timezone)}. Tap "I'm in" to save your spot.`,
    url: `${APP_URL}/#/home`,
    tag: `new-${s.id}`,
  };
  return {
    title: `Notes are up: ${s.title}`,
    body: "Your host shared the vocabulary and corrections from the session.",
    url: `${APP_URL}/#/sessions`,
    tag: `notes-${s.id}`,
  };
}

const esc = (x: string) => x.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

async function sendEmail(to: string, kind: string, s: Session, t: Target, m: { title: string; body: string; url: string }) {
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) return false;
  const meet = kind === "reminder" && s.meet_url
    ? `<p><a href="${esc(s.meet_url)}" style="display:inline-block;background:#f37a48;color:#2a2420;font-weight:bold;padding:12px 20px;border-radius:999px;text-decoration:none">Join on Google Meet</a></p>` : "";
  const html = `<div style="font-family:Arial,sans-serif;color:#2a2420;max-width:480px">
    <p>Hi ${esc(t.name || "there")},</p>
    <h2 style="margin:0 0 8px">${esc(m.title)}</h2>
    <p>${esc(m.body.replace(" Tap to join.", "").replace('Tap "I\'m in" to save your spot.', ""))}</p>
    ${meet}
    <p><a href="${m.url}" style="color:#a8431a">Open the Club app</a></p>
    <p style="color:#6f625a;font-size:12px">You get this email because app notifications aren't turned on for you. You can change this in the app under Me → Notifications.</p>
  </div>`;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM, to: [to], subject: m.title, html }),
  });
  if (!res.ok) console.error("Resend:", res.status, await res.text());
  return res.ok;
}

async function pushTo(db: DB, userId: string, payload: string) {
  const { data: subs } = await db.from("push_subscriptions").select("*").eq("user_id", userId);
  let ok = 0;
  for (const s of subs ?? []) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 3600 });
      ok++;
      await db.from("push_subscriptions").update({ last_ok_at: new Date().toISOString() }).eq("endpoint", s.endpoint);
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) await db.from("push_subscriptions").delete().eq("endpoint", s.endpoint);
      else console.error("Push failed:", code, (e as Error).message);
    }
  }
  return ok;
}

async function deliver(db: DB, kind: string, s: Session) {
  const { data: targets, error } = await db.rpc("notify_targets", { p_kind: kind, p_session: s.id });
  if (error) throw error;
  let push = 0, email = 0;
  for (const t of (targets ?? []) as Target[]) {
    const m = message(kind, s, t);
    const sentPush = await pushTo(db, t.user_id, JSON.stringify(m));
    let channel = sentPush ? "push" : "";
    if (!sentPush && kind !== "new_session" && t.allow_email && t.email) {
      if (await sendEmail(t.email, kind, s, t, m)) channel = "email";
    }
    if (channel) {
      push += channel === "push" ? 1 : 0;
      email += channel === "email" ? 1 : 0;
      await db.from("notify_log").insert({ kind, session_id: s.id, user_id: t.user_id, channel });
    }
  }
  return { push, email };
}

export async function runNotify(db: DB) {
  const { data: pub } = await db.rpc("app_secret", { p_name: "vapid_public" });
  const { data: priv } = await db.rpc("app_secret", { p_name: "vapid_private" });
  webpush.setVapidDetails("mailto:club@mandarinzest.com", pub, priv);

  const out: Record<string, unknown> = {};
  // 1. Reminders: sessions starting in 45–75 minutes.
  const now = Date.now();
  const { data: soon } = await db.from("sessions").select("id, title, starts_at, meet_url, host_name")
    .eq("cancelled", false)
    .gte("starts_at", new Date(now + 45 * 60e3).toISOString())
    .lte("starts_at", new Date(now + 75 * 60e3).toISOString());
  for (const s of soon ?? []) out[`reminder:${s.title}`] = await deliver(db, "reminder", s);

  // 2. Queued work: new sessions and published notes.
  const { data: queue } = await db.from("notify_outbox").select("*").is("done_at", null).order("id").limit(20);
  for (const q of queue ?? []) {
    const { data: s } = await db.from("sessions").select("id, title, starts_at, meet_url, host_name, cancelled").eq("id", q.session_id).single();
    const skip = !s || s.cancelled || (q.kind === "new_session" && Date.parse(s.starts_at) < now);
    if (!skip) out[`${q.kind}:${s.title}`] = await deliver(db, q.kind, s);
    await db.from("notify_outbox").update({ done_at: new Date().toISOString() }).eq("id", q.id);
  }
  return out;
}

// Calendar sync calls this with the session rows it just saw.
export async function queueNewSeries(db: DB, rows: { id: string; starts_at: string }[]) {
  const firstBySeries = new Map<string, { id: string; starts_at: string }>();
  for (const r of rows) {
    const uid = r.id.split("|")[0];
    if (Date.parse(r.starts_at) < Date.now()) continue;
    const cur = firstBySeries.get(uid);
    if (!cur || r.starts_at < cur.starts_at) firstBySeries.set(uid, r);
  }
  const uids = [...firstBySeries.keys()];
  if (!uids.length) return 0;
  const { data: known } = await db.from("known_series").select("uid").in("uid", uids);
  const knownSet = new Set((known ?? []).map((k: { uid: string }) => k.uid));
  const fresh = uids.filter((u) => !knownSet.has(u));
  if (!fresh.length) return 0;
  await db.from("known_series").insert(fresh.map((uid) => ({ uid })));
  await db.from("notify_outbox").insert(fresh.map((uid) => ({ kind: "new_session", session_id: firstBySeries.get(uid)!.id })));
  return fresh.length;
}

// For the "Send me a test" button in the app.
export async function sendTest(db: DB, userId: string) {
  const { data: pub } = await db.rpc("app_secret", { p_name: "vapid_public" });
  const { data: priv } = await db.rpc("app_secret", { p_name: "vapid_private" });
  webpush.setVapidDetails("mailto:club@mandarinzest.com", pub, priv);
  return pushTo(db, userId, JSON.stringify({
    title: "Notifications are on",
    body: "You'll hear from the Club here: reminders, new sessions and notes.",
    url: `${APP_URL}/#/me`, tag: "test",
  }));
}
