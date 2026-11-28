// Hands the free trials to the "Club members" Google Sheet (Apps Script, "Free trials" tab).
// Needs header x-sync-secret (same secret as the sync function). Only trial users who haven't paid yet:
// once they take a paid plan they leave this list and show up in the Members tab instead.
import { createClient } from "npm:@supabase/supabase-js@2";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const given = req.headers.get("x-sync-secret") ?? "";
  const { data: secret } = await db.rpc("app_secret", { p_name: "sync_secret" });
  if (given.length < 20 || !secret || given !== secret) return json({ error: "Not allowed" }, 401);
  const { data, error } = await db.rpc("trials_for_sheet");
  if (error) return json({ ok: false, error: error.message }, 500);
  return json({ ok: true, trials: data ?? [] });
});
