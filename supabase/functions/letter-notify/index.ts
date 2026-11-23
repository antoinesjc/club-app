// Post Office: tells people they got a letter (push; email when the app can't notify them and they allow email),
// and tells admins when a letter is reported. Called by the letters insert trigger, letter_report() and a
// 5-minute pg_cron safety net (private.call_fn('letter-notify')). Needs header x-sync-secret.
// The letter itself is never put in the notification or the email: you read it in the app.
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

async function sendEmail(to: string, name: string, title: string, body: string, url: string) {
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) return false;
  const html = `<div style="font-family:Arial,sans-serif;color:#2a2420;max-width:480px">
    <p>Hi ${esc(name || "there")},</p><h2 style="margin:0 0 8px">${esc(title)}</h2><p>${esc(body)}</p>
    <p><a href="${url}" style="display:inline-block;background:#2e7d48;color:#fff;font-weight:bold;padding:12px 20px;border-radius:999px;text-decoration:none">Open the Post Office</a></p>
    <p style="color:#6f625a;font-size:12px">You get this email because app notifications aren't turned on for you. You can change this in the app under Me → Notifications.</p></div>`;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM, to: [to], subject: title, html }),
  });
  if (!res.ok) console.error("Resend:", res.status, await res.text());
  return res.ok;
}

const nameOf = async (id: string) => {
  const { data } = await db.from("profiles").select("display_name").eq("id", id).maybeSingle();
  return (data?.display_name as string) || "A club member";
};

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const given = req.headers.get("x-sync-secret") ?? "";
  const { data: secret } = await db.rpc("app_secret", { p_name: "sync_secret" });
  if (given.length < 20 || !secret || given !== secret) return json({ error: "Not allowed" }, 401);
  try {
    const { data: pub } = await db.rpc("app_secret", { p_name: "vapid_public" });
    const { data: priv } = await db.rpc("app_secret", { p_name: "vapid_private" });
    webpush.setVapidDetails("mailto:club@mandarinzest.com", pub, priv);
    const out = { push: 0, email: 0, reports: 0 };

    // New letters. Claim each row first (notified_at) so two runs never send twice.
    const since = new Date(Date.now() - 2 * 86400e3).toISOString();
    const { data: fresh } = await db.from("letters").select("id, sender, recipient, read_at").is("notified_at", null).gt("created_at", since).order("created_at").limit(50);
    for (const l of fresh ?? []) {
      const { data: claimed } = await db.from("letters").update({ notified_at: new Date().toISOString() }).eq("id", l.id).is("notified_at", null).select("id");
      if (!claimed?.length || l.read_at) continue;
      const from = await nameOf(l.sender);
      const m = { title: `✉️ A letter from ${from}`, body: "You've got mail at the Zest Town Post Office. Tap to read it.", url: `${APP_URL}/#/learn/post/${l.id}`, tag: `letter-${l.id}` };
      if (await pushTo(l.recipient, JSON.stringify(m))) { out.push++; continue; }
      const { data: p } = await db.from("profiles").select("display_name, notify_email").eq("id", l.recipient).maybeSingle();
      if (p?.notify_email === false) continue;
      const { data: u } = await db.auth.admin.getUserById(l.recipient);
      if (u?.user?.email && await sendEmail(u.user.email, p?.display_name ?? "", m.title, `${from} wrote you a short letter in Chinese at the Zest Town Post Office. Open the app to read it and write back.`, m.url)) out.email++;
    }

    // Reported letters: a push to every admin.
    const { data: reps } = await db.from("letters").select("id").not("reported_at", "is", null).is("report_notified_at", null).limit(20);
    if (reps?.length) {
      const { data: roles } = await db.rpc("admin_ids");
      for (const r of reps) {
        const { data: claimed } = await db.from("letters").update({ report_notified_at: new Date().toISOString() }).eq("id", r.id).is("report_notified_at", null).select("id");
        if (!claimed?.length) continue;
        const m = { title: "🚩 A letter was reported", body: "A member reported a letter at the Post Office. Tap to read it.", url: `${APP_URL}/#/learn/post/reported`, tag: `letter-report-${r.id}` };
        for (const a of (roles ?? []) as { id: string }[]) await pushTo(a.id, JSON.stringify(m));
        out.reports++;
      }
    }
    return json({ ok: true, ...out });
  } catch (e) {
    console.error(e);
    return json({ error: (e as Error).message }, 500);
  }
});
