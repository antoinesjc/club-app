// Emails contact@mandarinzest.com when a member taps "Request to join" on a bootcamp (Resend).
// Called every 5 minutes by pg_cron (private.call_fn('bootcamp-notify')). Needs header x-sync-secret.
// A request is marked notified only once the email went out, so nothing is lost if Resend isn't set up yet.
import { createClient } from "npm:@supabase/supabase-js@2";

const TO = "contact@mandarinzest.com";
const FROM = "Mandarin Zest Club <club@mandarinzest.com>";
const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
const esc = (x: unknown) => String(x ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const given = req.headers.get("x-sync-secret") ?? "";
  const { data: secret } = await db.rpc("app_secret", { p_name: "sync_secret" });
  if (given.length < 20 || !secret || given !== secret) return json({ error: "Not allowed" }, 401);
  const key = Deno.env.get("RESEND_API_KEY");
  try {
    const { data: rows, error } = await db.from("bootcamp_requests").select("*").is("notified_at", null).order("created_at").limit(20);
    if (error) throw error;
    if (!rows?.length) return json({ ok: true, sent: 0 });
    if (!key) return json({ ok: false, waiting: rows.length, error: "RESEND_API_KEY is not set" });
    let sent = 0;
    for (const r of rows) {
      const { data: p } = await db.from("profiles").select("display_name, country, chinese_level, discord").eq("id", r.user_id).maybeSingle();
      const { data: u } = await db.auth.admin.getUserById(r.user_id);
      const mail = u?.user?.email ?? "";
      const name = p?.display_name || mail || "A member";
      const when = new Date(r.created_at).toLocaleString("en-GB", { timeZone: "Asia/Taipei", dateStyle: "medium", timeStyle: "short" });
      const link = /^https?:\/\//.test(r.bootcamp) ? `<a href="${esc(r.bootcamp)}" style="color:#1b6f1b">${esc(r.title)}</a>` : esc(r.title);
      const row = (k: string, v: unknown) => v ? `<tr><td style="padding:4px 12px 4px 0;color:#6f625a">${k}</td><td style="padding:4px 0"><b>${esc(v)}</b></td></tr>` : "";
      const html = `<div style="font-family:Arial,sans-serif;color:#2a2420;max-width:520px">
        <h2 style="margin:0 0 8px">New bootcamp request</h2>
        <p style="margin:0 0 12px">${esc(name)} asked to join ${link} from the Club app.</p>
        <table style="border-collapse:collapse;font-size:14px">
          ${row("Name", p?.display_name)}${row("Email", mail)}${row("Discord", p?.discord)}${row("Country", p?.country)}
          ${row("Chinese level", p?.chinese_level)}${row("Bootcamp", r.title)}${row("Status then", r.status)}${row("Requested", when + " (Taiwan time)")}
        </table>
        <p style="color:#6f625a;font-size:12px;margin-top:16px">Reply to this email to write to ${esc(name)} directly. They were told a host will be in touch by email soon, at the Club price.</p></div>`;
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: FROM, to: [TO], ...(mail ? { reply_to: mail } : {}), subject: `Bootcamp request: ${name} → ${r.title}`, html }),
      });
      if (!res.ok) { console.error("Resend:", res.status, await res.text()); continue; }
      await db.from("bootcamp_requests").update({ notified_at: new Date().toISOString() }).eq("id", r.id);
      sent++;
    }
    return json({ ok: true, sent, total: rows.length });
  } catch (e) {
    console.error(e);
    return json({ ok: false, error: String((e as Error).message ?? e) }, 500);
  }
});
