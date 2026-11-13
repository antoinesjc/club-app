// One endpoint for the background jobs:
//   {action:"calendar"}            Google Calendar → sessions   (every 15 min, pg_cron)
//   {action:"notify"}              reminders, new sessions, notes, cancelled/moved sessions (every 5 min, pg_cron)
//   {action:"stripe"}              Stripe → members_stripe      (daily, pg_cron)
//   {action:"sheet", rows:[...]}   "Members" tab → members_manual, returns the Stripe list
//                                  for the "From Stripe" tab    (Apps Script, on edit + hourly)
// Every call must send the header x-sync-secret.
import { createClient } from "npm:@supabase/supabase-js@2";
import ICAL from "npm:ical.js@2";
import { parseIcs } from "../_shared/calendar.js";
import { allClubMembers } from "../_shared/stripe.ts";
import { queueNewSeries, runNotify } from "../_shared/notify.ts";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

async function checkSecret(req: Request): Promise<boolean> {
  const given = req.headers.get("x-sync-secret") ?? "";
  if (given.length < 20) return false;
  const { data, error } = await db.rpc("app_secret", { p_name: "sync_secret" });
  if (error || !data) return false;
  return given === data;
}

async function syncCalendar() {
  const url = Deno.env.get("GCAL_ICS_URL");
  if (!url) throw new Error("GCAL_ICS_URL secret is missing");
  const res = await fetch(url, { headers: { "User-Agent": "mz-club-app" } });
  if (!res.ok) throw new Error(`Calendar feed: HTTP ${res.status}`);
  const from = new Date(Date.now() - 35 * 864e5);
  const to = new Date(Date.now() + 180 * 864e5);
  type Row = { id: string; starts_at: string; [k: string]: unknown };
  const rows: Row[] = parseIcs(ICAL, await res.text(), from, to).map((r: Row) => ({
    ...r, cancelled: false, synced_at: new Date().toISOString(),
  }));
  // Safety: an empty feed is a broken feed, not "every session was cancelled".
  if (!rows.length) throw new Error("Calendar feed has no sessions; nothing changed");
  const nowMs = Date.now();
  // What we knew about these sessions before this sync (to spot moved ones).
  const before = new Map<string, { starts_at: string; cancelled: boolean }>();
  const allIds = rows.map((r) => r.id);
  for (let i = 0; i < allIds.length; i += 100) {
    const { data, error } = await db.from("sessions").select("id, starts_at, cancelled").in("id", allIds.slice(i, i + 100));
    if (error) throw error;
    for (const s of data ?? []) before.set(s.id, s);
  }
  const { data: upcoming, error: e2 } = await db.from("sessions").select("id, starts_at")
    .gte("starts_at", new Date(nowMs).toISOString()).eq("cancelled", false);
  if (e2) throw e2;
  const ids = new Set(allIds);
  const gone = (upcoming ?? []).filter((r) => !ids.has(r.id)).sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  // Safety: a half-broken feed shouldn't cancel most of the calendar at once.
  if (gone.length > 15 && gone.length > (upcoming ?? []).length / 2) throw new Error(`Feed lost ${gone.length} upcoming sessions; nothing changed`);

  const { error } = await db.from("sessions").upsert(rows);
  if (error) throw error;

  // Changes for members who said "I'm in": moved (same id, new time) ...
  const changes: { kind: string; session_id: string; old_starts_at: string | null }[] = [];
  for (const r of rows as { id: string; starts_at: string }[]) {
    const b = before.get(r.id);
    if (b && !b.cancelled && Math.abs(Date.parse(b.starts_at) - Date.parse(r.starts_at)) >= 60e3
        && Math.max(Date.parse(b.starts_at), Date.parse(r.starts_at)) > nowMs) {
      changes.push({ kind: "rescheduled", session_id: r.id, old_starts_at: b.starts_at });
    }
  }
  // ... or left the feed: a one-off event moved to another day comes back with a new id (same calendar
  // event, new start), so pair it with the closest new session of that event within 30 days and carry
  // the "I'm in"s over. Otherwise it was cancelled or deleted.
  const fresh = rows.filter((r) => !before.has(r.id) && Date.parse(r.starts_at) > nowMs);
  const used = new Set<string>();
  for (const g of gone) {
    const uid = g.id.split("|")[0];
    const dist = (r: { starts_at: string }) => Math.abs(Date.parse(r.starts_at) - Date.parse(g.starts_at));
    const match = fresh.filter((r) => !used.has(r.id) && r.id.split("|")[0] === uid && dist(r) <= 30 * 864e5)
      .sort((x, y) => dist(x) - dist(y))[0];
    if (match) {
      used.add(match.id);
      await db.from("interests").update({ session_id: match.id }).eq("session_id", g.id);
      changes.push({ kind: "rescheduled", session_id: match.id, old_starts_at: g.starts_at });
    } else {
      changes.push({ kind: "cancelled", session_id: g.id, old_starts_at: null });
    }
  }
  if (gone.length) await db.from("sessions").update({ cancelled: true }).in("id", gone.map((g) => g.id));
  if (changes.length) {
    await db.from("session_changes").insert(changes);
    // A moved session gets a fresh 1-hour reminder at its new time.
    const moved = changes.filter((c) => c.kind === "rescheduled").map((c) => c.session_id);
    if (moved.length) await db.from("notify_log").delete().eq("kind", "reminder").in("session_id", moved);
  }
  const announced = await queueNewSeries(db, rows);
  return {
    sessions: rows.length, announced,
    cancelled: changes.filter((c) => c.kind === "cancelled").length,
    rescheduled: changes.filter((c) => c.kind === "rescheduled").length,
  };
}

async function syncStripe() {
  const members = [...(await allClubMembers()).values()];
  const now = new Date().toISOString();
  if (members.length) {
    const { error } = await db.from("members_stripe").upsert(members.map((m) => ({ ...m, checked_at: now })));
    if (error) throw error;
  }
  const emails = new Set(members.map((m) => m.email));
  const { data: old } = await db.from("members_stripe").select("email");
  const missing = (old ?? []).map((r) => r.email).filter((e) => !emails.has(e));
  if (missing.length) await db.from("members_stripe").update({ active: false, checked_at: now }).in("email", missing);
  return { members: members.length, active: members.filter((m) => m.active).length };
}

type SheetRow = { email?: string; name?: string; role?: string; status?: string; note?: string };

async function syncSheet(rows: SheetRow[]) {
  const clean = new Map<string, Record<string, string>>();
  for (const r of rows ?? []) {
    const email = String(r.email ?? "").trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(email)) continue;
    const role = ["member", "host", "admin"].includes(String(r.role).trim().toLowerCase())
      ? String(r.role).trim().toLowerCase() : "member";
    const status = String(r.status ?? "").trim().toLowerCase() === "blocked" ? "blocked" : "active";
    clean.set(email, { email, name: String(r.name ?? "").trim().slice(0, 80), role, status, note: String(r.note ?? "").slice(0, 200) });
  }
  // Safety: never wipe the list because of an empty or broken upload.
  if (clean.size === 0) throw new Error("Sheet sent no members; nothing changed");
  const list = [...clean.values()].map((r) => ({ ...r, synced_at: new Date().toISOString() }));
  const { error } = await db.from("members_manual").upsert(list);
  if (error) throw error;
  const { data: old } = await db.from("members_manual").select("email");
  const removed = (old ?? []).map((r) => r.email).filter((e) => !clean.has(e));
  if (removed.length) await db.from("members_manual").delete().in("email", removed);
  return { manual: list.length, removed: removed.length };
}

async function stripeList() {
  const { data, error } = await db.from("members_stripe")
    .select("email, name, plan, member_until, active, checked_at").order("active", { ascending: false }).order("email");
  if (error) throw error;
  return data;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (!(await checkSecret(req))) return json({ error: "Not allowed" }, 401);
  try {
    const body = await req.json().catch(() => ({}));
    switch (body.action) {
      case "notify":
        return json({ ok: true, ...(await runNotify(db)) });
      case "calendar":
        return json({ ok: true, ...(await syncCalendar()) });
      case "stripe":
        return json({ ok: true, ...(await syncStripe()), stripe: await stripeList() });
      case "sheet": {
        const result = await syncSheet(body.rows);
        const extra = body.stripeNow ? await syncStripe() : {};
        return json({ ok: true, ...result, ...extra, stripe: await stripeList() });
      }
      default:
        return json({ error: "Unknown action" }, 400);
    }
  } catch (e) {
    console.error(e);
    return json({ ok: false, error: String((e as Error).message ?? e) }, 500);
  }
});
