// Admin tab → "Send a notification". Admins only (checked here from the caller's login).
// Body: { title, body, page, audience: "all"|"members"|"hosts"|"pick", ids?: string[],
//         channel: "push"|"fallback"|"both", test?: boolean }
// {name} in the title or message becomes each person's first name.
// channel: push = app notification only; fallback = app notification, or email if they can't get one;
//          both = app notification and email. Nobody who turned emails off in Settings gets an email.
import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const APP_URL = "https://app.mandarinzest.com";
const FROM = "Mandarin Zest Club <club@mandarinzest.com>";
const PAGES = new Set(["home", "sessions", "members", "bootcamps", "me", "notes"]);
const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
const esc = (x: string) => x.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const first = (name: string | null) => (String(name || "").trim().split(/\s+/)[0] || "there");
const fill = (text: string, name: string | null) => text.replace(/\{name\}/gi, first(name));

type R = { user_id: string; email: string; name: string | null; role: string; allow_email: boolean };

async function pushTo(userId: string, payload: string) {
  const { data: subs } = await db.from("push_subscriptions").select("*").eq("user_id", userId);
  let ok = 0;
  for (const s of subs ?? []) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 24 * 3600 });
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

async function sendEmail(key: string, to: string, name: string | null, title: string, body: string, url: string) {
  const html = `<div style="font-family:Arial,sans-serif;color:#2a2420;max-width:480px">
    <p>Hi ${esc(first(name))},</p>
    <h2 style="margin:0 0 8px">${esc(title)}</h2>
    <p style="white-space:pre-line">${esc(body)}</p>
    <p><a href="${url}" style="display:inline-block;background:#1b6f1b;color:#fff;font-weight:bold;padding:12px 20px;border-radius:999px;text-decoration:none">Open the Club app</a></p>
    <p style="color:#6f625a;font-size:12px">From the Mandarin Zest Club team. You can turn off emails in the app under Settings → Notifications.</p></div>`;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM, to: [to], subject: title, html }),
  });
  if (!res.ok) console.error("Resend:", res.status, await res.text());
  return res.ok;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  try {
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer /, "");
    const { data: { user } } = await db.auth.getUser(token);
    if (!user?.email) return json({ ok: false, error: "Please log in again." }, 401);
    const { data: role } = await db.rpc("access_role", { p_email: user.email });
    if (role !== "admin") return json({ ok: false, error: "Admins only." }, 403);

    const b = await req.json().catch(() => ({}));
    const title = String(b.title ?? "").trim().slice(0, 80), body = String(b.body ?? "").trim().slice(0, 300);
    if (!title || !body) return json({ ok: false, error: "Add a title and a message." }, 400);
    const channel = ["push", "fallback", "both"].includes(b.channel) ? b.channel : "push";
    const page = PAGES.has(b.page) ? b.page : "home";
    const url = `${APP_URL}/#/${page}`;
    const audience = ["all", "members", "hosts", "pick"].includes(b.audience) ? b.audience : "all";

    const { data: everyone, error } = await db.rpc("admin_recipients");
    if (error) throw error;
    const ids = new Set((Array.isArray(b.ids) ? b.ids : []).map(String));
    const list = (everyone as R[]).filter((r) => b.test ? r.user_id === user.id
      : audience === "members" ? r.role === "member"
      : audience === "hosts" ? r.role === "host" || r.role === "admin"
      : audience === "pick" ? ids.has(r.user_id) : true);
    if (!list.length) return json({ ok: false, error: "Nobody to send to." }, 400);

    const { data: pub } = await db.rpc("app_secret", { p_name: "vapid_public" });
    const { data: priv } = await db.rpc("app_secret", { p_name: "vapid_private" });
    webpush.setVapidDetails("mailto:club@mandarinzest.com", pub, priv);
    const key = Deno.env.get("RESEND_API_KEY") ?? "";

    let sentPush = 0, sentEmail = 0, unreached = 0;
    const tag = `admin-${Date.now()}`;
    for (const r of list) {
      const t = fill(title, r.name), m = fill(body, r.name);
      const pushed = await pushTo(r.user_id, JSON.stringify({ title: t, body: m, url, tag }));
      let emailed = false;
      if (key && r.email && r.allow_email && (channel === "both" || (channel === "fallback" && !pushed))) {
        emailed = await sendEmail(key, r.email, r.name, t, m, url);
      }
      if (pushed) sentPush++;
      if (emailed) sentEmail++;
      if (!pushed && !emailed) unreached++;
    }
    if (!b.test) {
      await db.from("admin_broadcasts").insert({
        title, body, url, audience: audience === "pick" ? `${list.length} chosen` : audience, channel,
        recipients: list.length, sent_push: sentPush, sent_email: sentEmail, unreached, created_by: user.id,
      });
    }
    return json({ ok: true, recipients: list.length, push: sentPush, email: sentEmail, unreached, emailOff: !key });
  } catch (e) {
    console.error(e);
    return json({ ok: false, error: String((e as Error).message ?? e) }, 500);
  }
});
