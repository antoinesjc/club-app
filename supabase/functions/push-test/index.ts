// "Send me a test notification" button in the app (logged-in members only).
import { createClient } from "npm:@supabase/supabase-js@2";
import { sendTest } from "../_shared/notify.ts";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const admin = createClient(URL_, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer /, "");
    const { data: { user } } = await admin.auth.getUser(token);
    if (!user) return json({ ok: false, reason: "login" }, 401);
    const sent = await sendTest(admin, user.id);
    return json({ ok: sent > 0, sent });
  } catch (e) {
    console.error(e);
    return json({ ok: false, reason: "error" }, 500);
  }
});
