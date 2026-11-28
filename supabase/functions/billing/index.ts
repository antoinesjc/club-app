// Plans and bootcamps (28 Nov 2026). Called by the app with the user's login (checked here; verify_jwt off for CORS).
//   { action: "portal" }                     -> { url } Stripe customer portal (change plan, card, cancel), back to Me
//   { action: "links" }                      -> { self, clubMonthly, clubYearly } payment link addresses (plans screen)
//   { action: "plan", plan: "self"|"clubMonthly"|"clubYearly" } -> { client_secret, publishable_key } subscription checkout
//                                               inside the app, same price as the payment link (people without a paid plan)
//   { action: "plan-verify", session_id }    -> { role } saves the new plan at once (no wait for the sync)
//   { action: "bootcamp", url }              -> { client_secret, publishable_key } (embedded) or { url }
//                                               regular price from the website feed (early bird until earlyEnds)
//                                               Self-Study and trial users only (Club members ask a host, Club price)
//   { action: "bootcamp-verify", session_id? } -> { paid: [bootcamp urls] }; a paid one becomes a bootcamp_requests row
//                                               ("Paid US$x in the app"), emailed to the team by bootcamp-notify
import { createClient } from "npm:@supabase/supabase-js@2";
import { links as linkIds, membersFromCheckouts, PLAN_KIND } from "../_shared/stripe.ts";

const APP_URL = "https://app.mandarinzest.com";
const FEED = "https://antoinesjc.github.io/Mandarin-Zest-Class-Calendar/bootcamps.json";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

// deno-lint-ignore no-explicit-any
type Obj = Record<string, any>;
async function stripe(method: "GET" | "POST", path: string, params: Record<string, string> = {}): Promise<Obj> {
  const key = Deno.env.get("STRIPE_KEY");
  if (!key) throw new Error("STRIPE_KEY secret is missing");
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`https://api.stripe.com/v1/${path}${method === "GET" && qs ? "?" + qs : ""}`, {
    method, headers: { Authorization: `Bearer ${key}`, ...(method === "POST" ? { "Content-Type": "application/x-www-form-urlencoded" } : {}) },
    body: method === "POST" ? qs : undefined,
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`Stripe: ${body?.error?.message ?? res.status}`);
  return body;
}

const ymd = (d = new Date()) => d.toISOString().slice(0, 10);
// "US$139" -> 13900 cents
const cents = (s: unknown) => { const m = /([\d.,]+)/.exec(String(s ?? "")); return m ? Math.round(parseFloat(m[1].replace(/,/g, "")) * 100) : 0; };

// The three plans' payment links with their price, straight from Stripe (kept for the life of the function instance).
let PLANS: Obj | null = null;
async function planLinks() {
  if (PLANS) return PLANS;
  const L = await linkIds();
  const ids: Record<string, string | undefined> = { self: L.ids.self, clubMonthly: "plink_1USwvpFSITwJ0tdSclfdQxwj", clubYearly: L.ids.clubYearly };
  const out: Obj = {};
  for (const [k, id] of Object.entries(ids)) {
    if (!id) { out[k] = null; continue; }
    const pl = await stripe("GET", `payment_links/${id}`);
    const items = await stripe("GET", `payment_links/${id}/line_items`, { limit: "1" });
    const pr = items.data?.[0]?.price ?? {};
    out[k] = { url: pl.url, amount: pr.unit_amount ?? null, currency: pr.currency ?? "usd", interval: pr.recurring?.interval ?? null, price: pr.id ?? null };
  }
  PLANS = out;
  return out;
}

async function markPaid(s: Obj): Promise<string | null> {
  const user = s.metadata?.user_id, camp = s.metadata?.bootcamp;
  if (!user || !camp || s.payment_status !== "paid") return null;
  const { data: c } = await admin.from("bootcamp_checkouts").select("*").eq("session_id", s.id).maybeSingle();
  if (!c || c.status === "paid") return c ? camp : null;
  await admin.from("bootcamp_checkouts").update({ status: "paid" }).eq("session_id", s.id);
  const amount = `US$${((s.amount_total ?? c.amount_cents) / 100).toFixed(2).replace(/\.00$/, "")}`;
  await admin.from("bootcamp_requests").upsert({ user_id: user, bootcamp: camp, title: c.title, status: `Paid ${amount} in the app (regular price)`, notified_at: null }, { onConflict: "user_id,bootcamp" });
  return camp;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  try {
    const auth = req.headers.get("Authorization") ?? "";
    const { data: u } = await admin.auth.getUser(auth.replace(/^Bearer\s+/i, ""));
    const user = u?.user;
    if (!user) return json({ error: "Please log in again." }, 401);
    const email = (user.email ?? "").toLowerCase();
    const { data: role } = await admin.rpc("access_role", { p_email: email });
    const body = await req.json().catch(() => ({}));

    if (body.action === "links") { const P = await planLinks(); return json(Object.fromEntries(Object.entries(P).map(([k, v]) => [k, v && { ...v, price: undefined }]))); }

    if (body.action === "plan") {
      const P = await planLinks(), plan = String(body.plan ?? ""), price = P[plan]?.price;
      if (!price) return json({ error: "This plan isn't available right now." }, 404);
      // Already paying (Self-Study or Club): plan changes go through the portal, so nobody pays twice.
      const { data: cur } = await admin.from("members_stripe").select("tier").eq("email", email).eq("active", true).gt("member_until", new Date().toISOString());
      if ((cur ?? []).length && role !== "admin") return json({ error: "already_subscribed" }, 409);
      const { data: pk } = await admin.rpc("app_secret", { p_name: "stripe_publishable" });
      if (!pk) return json({ url: P[plan].url });
      const found = await stripe("GET", "customers", { email, limit: "1" }).catch(() => null);
      const customer = found?.data?.[0]?.id;
      const s = await stripe("POST", "checkout/sessions", {
        mode: "subscription",
        "line_items[0][price]": price,
        "line_items[0][quantity]": "1",
        ...(customer ? { customer } : { customer_email: email }),
        client_reference_id: user.id,
        "metadata[kind]": PLAN_KIND, "metadata[plan]": plan, "metadata[user_id]": user.id,
        "subscription_data[metadata][kind]": PLAN_KIND, "subscription_data[metadata][plan]": plan,
        allow_promotion_codes: "true",
        ui_mode: "embedded_page", redirect_on_completion: "if_required",
        return_url: `${APP_URL}/#/plans/paid/{CHECKOUT_SESSION_ID}`,
      });
      return json({ client_secret: s.client_secret, publishable_key: pk, session_id: s.id });
    }

    if (body.action === "plan-verify") {
      const id = String(body.session_id ?? "");
      if (!/^cs_[A-Za-z0-9_]+$/.test(id)) return json({ error: "bad session" }, 400);
      const s = await stripe("GET", `checkout/sessions/${id}`);
      if (s.metadata?.user_id !== user.id || s.metadata?.kind !== PLAN_KIND) return json({ error: "Not allowed" }, 403);
      if (s.status === "complete") {
        // Save under the login email too (the checkout email is the same: customer_email / customer found by it).
        const map = await membersFromCheckouts([s]);
        for (const m of map.values()) await admin.from("members_stripe").upsert({ ...m, email: m.email || email, checked_at: new Date().toISOString() });
      }
      const { data: r2 } = await admin.rpc("access_role", { p_email: email });
      return json({ status: s.status, role: r2 ?? null });
    }

    if (body.action === "portal") {
      // Expired trials and lapsed members can't change a plan here; they buy one from the plans screen.
      const { data: rows } = await admin.from("members_stripe").select("customer_id, active, tier").eq("email", email);
      let customer = (rows ?? []).filter((r) => r.customer_id).sort((a, b) => Number(b.active) - Number(a.active))[0]?.customer_id ?? null;
      if (!customer) {
        const found = await stripe("GET", "customers", { email, limit: "1" });
        customer = found.data?.[0]?.id ?? null;
      }
      if (!customer) return json({ error: "no_subscription" }, 404);
      const s = await stripe("POST", "billing_portal/sessions", { customer, return_url: `${APP_URL}/#/me` });
      return json({ url: s.url });
    }

    if (body.action === "bootcamp") {
      if (!["self", "trial", "admin"].includes(String(role))) return json({ error: "Not allowed" }, 403);
      const feed = await (await fetch(FEED, { headers: { "User-Agent": "mz-club-app" } })).json();
      const b = (feed?.bootcamps ?? []).find((x: Obj) => (x.url || x.title) === String(body.url ?? ""));
      if (!b) return json({ error: "This bootcamp isn't open right now." }, 404);
      const today = ymd();
      const open = !/closed|full/i.test(b.status || "") && (/open/i.test(b.status || "") || (b.signupBy && today <= b.signupBy));
      if (!open) return json({ error: "Sign-ups for this bootcamp are closed." }, 409);
      const early = b.early && b.earlyEnds && today <= b.earlyEnds;
      const amount = cents(early ? b.early : b.price);
      if (amount < 100) return json({ error: "The price isn't set yet. Please try again later." }, 409);
      const key = b.url || b.title;
      const { data: done } = await admin.from("bootcamp_checkouts").select("session_id").eq("user_id", user.id).eq("bootcamp", key).eq("status", "paid").maybeSingle();
      if (done) return json({ paid: true });
      const { data: pk } = await admin.rpc("app_secret", { p_name: "stripe_publishable" });
      const embedded = !!pk && body.embedded !== false;
      const back = `${APP_URL}/#/bootcamps/paid/{CHECKOUT_SESSION_ID}`;
      const s = await stripe("POST", "checkout/sessions", {
        mode: "payment",
        "line_items[0][quantity]": "1",
        "line_items[0][price_data][currency]": "usd",
        "line_items[0][price_data][unit_amount]": String(amount),
        "line_items[0][price_data][product_data][name]": `${b.title}${early ? " (early bird)" : ""}`,
        "line_items[0][price_data][product_data][description]": [b.dates, b.format].filter(Boolean).join(" · ").slice(0, 300) || "Mandarin Zest bootcamp",
        client_reference_id: user.id,
        customer_email: email,
        "metadata[user_id]": user.id,
        "metadata[bootcamp]": key,
        "metadata[kind]": "club-bootcamp",
        "payment_intent_data[metadata][bootcamp]": key,
        "payment_intent_data[metadata][kind]": "club-bootcamp",
        ...(embedded ? { ui_mode: "embedded_page", redirect_on_completion: "if_required", return_url: back } : { success_url: back, cancel_url: `${APP_URL}/#/bootcamps` }),
      });
      await admin.from("bootcamp_checkouts").insert({ session_id: s.id, user_id: user.id, bootcamp: key, title: String(b.title).slice(0, 200), amount_cents: amount });
      return json(embedded ? { client_secret: s.client_secret, publishable_key: pk, session_id: s.id } : { url: s.url, session_id: s.id });
    }

    if (body.action === "bootcamp-verify") {
      const since = new Date(Date.now() - 14 * 864e5).toISOString();
      const { data: open } = await admin.from("bootcamp_checkouts").select("session_id").eq("user_id", user.id).eq("status", "open").gte("created_at", since);
      const ids = new Set((open ?? []).map((r) => r.session_id));
      if (body.session_id) ids.add(String(body.session_id));
      for (const id of ids) {
        if (!/^cs_[A-Za-z0-9_]+$/.test(id)) continue;
        const s = await stripe("GET", `checkout/sessions/${id}`);
        if (s.metadata?.user_id !== user.id) continue;
        if (!(await markPaid(s)) && s.status === "expired") await admin.from("bootcamp_checkouts").update({ status: "expired" }).eq("session_id", id);
      }
      const { data: paid } = await admin.from("bootcamp_checkouts").select("bootcamp").eq("user_id", user.id).eq("status", "paid");
      return json({ paid: (paid ?? []).map((r) => r.bootcamp) });
    }
    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});
