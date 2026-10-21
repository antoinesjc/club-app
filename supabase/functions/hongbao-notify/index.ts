// Tells members they received a hongbao (Web Push, email fallback via Resend).
// Called every 5 minutes by pg_cron (private.call_fn('hongbao-notify')). Needs header x-sync-secret.
import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const APP_URL = "https://app.mandarinzest.com";
const FROM = "Mandarin Zest Club <club@mandarinzest.com>";
const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
const esc = (x: string) => x.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

async function pushTo(userId: string, payload: string) {
  const { data: subs } = await db.from("push_subscriptions").select("*").eq("user_id", userId);
  let ok = 0;
  for (const s of subs ?? []) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 86400 });
      ok++;
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) await db.from("push_subscriptions").delete().eq("endpoint", s.endpoint);
      else console.error("Push failed:", code, (e as Error).message);
    }
  }
  return ok;
}

async function email(to: string, name: string, m: { title: string; body: string; url: string }) {
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) return false;
  const html = `<div style="font-family:Arial,sans-serif;color:#2a2420;max-width:480px">
    <p>Hi ${esc(name || "there")},</p><h2 style="margin:0 0 8px">${esc(m.title)}</h2>
    <p>${esc(m.body.replace(" Open the app to see it.", ""))}</p>
    <p><a href="${m.url}" style="color:#1b6f1b">Open the Club app</a></p>
    <p style="color:#6f625a;font-size:12px">You get this email because app notifications aren't turned on for you. You can change this in the app under Me → Notifications.</p></div>`;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM, to: [to], subject: m.title, html }),
  });
  if (!res.ok) console.error("Resend:", res.status, await res.text());
  return res.ok;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const given = req.headers.get("x-sync-secret") ?? "";
  const { data: secret } = await db.rpc("app_secret", { p_name: "sync_secret" });
  if (given.length < 20 || !secret || given !== secret) return json({ error: "Not allowed" }, 401);
  try {
    const { data: hbs, error } = await db.from("hongbaos").select("id, giver, receiver").is("notified_at", null).order("created_at").limit(50);
    if (error) throw error;
    if (!hbs?.length) return json({ ok: true, sent: 0 });
    const { data: pub } = await db.rpc("app_secret", { p_name: "vapid_public" });
    const { data: priv } = await db.rpc("app_secret", { p_name: "vapid_private" });
    webpush.setVapidDetails("mailto:club@mandarinzest.com", pub, priv);
    let sent = 0;
    for (const h of hbs) {
      const { data: g } = await db.from("profiles").select("display_name").eq("id", h.giver).maybeSingle();
      const m = { title: "🧧 You received a hongbao!", body: `${g?.display_name || "A member"} sent you a hongbao: +30 XP. Open the app to see it.`, url: `${APP_URL}/#/me`, tag: `hongbao-${h.id}` };
      let ok = (await pushTo(h.receiver, JSON.stringify(m))) > 0;
      if (!ok) {
        const { data: r } = await db.from("profiles").select("display_name, notify_email").eq("id", h.receiver).maybeSingle();
        const { data: u } = await db.auth.admin.getUserById(h.receiver);
        if (r?.notify_email !== false && u?.user?.email) ok = await email(u.user.email, r?.display_name ?? "", m);
      }
      await db.from("hongbaos").update({ notified_at: new Date().toISOString() }).eq("id", h.id);
      if (ok) sent++;
    }
    return json({ ok: true, sent, total: hbs.length });
  } catch (e) {
    console.error(e);
    return json({ ok: false, error: String((e as Error).message ?? e) }, 500);
  }
});
