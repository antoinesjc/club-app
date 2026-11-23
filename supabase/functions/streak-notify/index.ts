// Streak reminder: a phone notification at 23:00 (member's time zone) when their streak tree hasn't grown today.
// Called every 15 minutes by pg_cron (private.call_fn('streak-notify')). Needs header x-sync-secret.
// Push only, never email. Members turn it off in Settings ("Streak reminder").
import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const APP_URL = "https://app.mandarinzest.com";
const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });

async function pushTo(userId: string, payload: string) {
  const { data: subs } = await db.from("push_subscriptions").select("*").eq("user_id", userId);
  let ok = 0;
  for (const s of subs ?? []) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 3600 });
      ok++;
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) await db.from("push_subscriptions").delete().eq("endpoint", s.endpoint);
      else console.error("Push failed:", code, (e as Error).message);
    }
  }
  return ok;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const given = req.headers.get("x-sync-secret") ?? "";
  const { data: secret } = await db.rpc("app_secret", { p_name: "sync_secret" });
  if (given.length < 20 || !secret || given !== secret) return json({ error: "Not allowed" }, 401);
  try {
    const { data: due, error } = await db.rpc("streak_reminders");
    if (error) throw error;
    const rows = (due ?? []) as { user_id: string; streak: number; day: string }[];
    if (!rows.length) return json({ ok: true, sent: 0 });
    const { data: pub } = await db.rpc("app_secret", { p_name: "vapid_public" });
    const { data: priv } = await db.rpc("app_secret", { p_name: "vapid_private" });
    webpush.setVapidDetails("mailto:club@mandarinzest.com", pub, priv);
    let sent = 0;
    for (const r of rows) {
      const m = {
        title: `🌱 1 hour left for your ${r.streak}-day streak`,
        body: "Your tree hasn't grown today. Review a few flashcards, read a Library chapter, write a character or send a letter in Zest Town to keep it alive.",
        url: `${APP_URL}/#/learn/cards`, tag: `streak-${r.day}`,
      };
      if ((await pushTo(r.user_id, JSON.stringify(m))) > 0) sent++;
    }
    await db.rpc("streak_reminder_sent", { p_users: rows.map((r) => r.user_id), p_days: rows.map((r) => r.day) });
    return json({ ok: true, sent, due: rows.length });
  } catch (e) {
    console.error(e);
    return json({ error: (e as Error).message }, 500);
  }
});
