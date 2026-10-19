// Login step 1: the app sends the email here. Only Club members (sheet or
// Stripe) get a 6-digit code; everyone else is told the Club is members-only.
// Someone who paid minutes ago is found with a live Stripe check.
import { createClient } from "npm:@supabase/supabase-js@2";
import { clubMemberByEmail } from "../_shared/stripe.ts";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const admin = createClient(URL_, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const anon = createClient(URL_, Deno.env.get("SUPABASE_ANON_KEY")!, { auth: { persistSession: false } });

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

async function role(email: string): Promise<string | null> {
  const { data, error } = await admin.rpc("access_role", { p_email: email });
  if (error) throw error;
  return data ?? null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  try {
    const { email: raw } = await req.json().catch(() => ({}));
    const email = String(raw ?? "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) {
      return json({ ok: false, reason: "bad_email" });
    }

    let r = await role(email);
    if (!r) {
      // Not known yet: maybe they just paid. Ask Stripe directly.
      try {
        const m = await clubMemberByEmail(email);
        if (m) {
          await admin.from("members_stripe").upsert({ ...m, checked_at: new Date().toISOString() });
          r = await role(email);
        }
      } catch (e) {
        console.error("Live Stripe check failed:", e);
      }
    }
    if (!r) return json({ ok: false, reason: "not_member" });

    // Make sure the login account exists (sign-ups are otherwise closed).
    const { error: createErr } = await admin.auth.admin.createUser({ email, email_confirm: true });
    if (createErr && !/already|registered|exists/i.test(createErr.message)) throw createErr;

    const { error } = await anon.auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
    if (error) {
      if (/rate|seconds|security purposes/i.test(error.message)) return json({ ok: false, reason: "wait" });
      throw error;
    }
    return json({ ok: true });
  } catch (e) {
    console.error(e);
    return json({ ok: false, reason: "error" }, 500);
  }
});
