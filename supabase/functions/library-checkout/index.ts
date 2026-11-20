// Library Bookshop: Stripe Checkout for a book, and unlocking it once Stripe says it's paid.
// Called by the app with the member's login (checked here with auth.getUser; verify_jwt off so the CORS preflight passes).
//   { action: "create", book_id }      -> { client_secret, publishable_key } (embedded in the app) or { url } (Stripe page)
//   { action: "verify", session_id? }  -> checks this member's started checkouts, unlocks paid books -> { owned, unlocked }
import { createClient } from "npm:@supabase/supabase-js@2";

const APP_URL = "https://app.mandarinzest.com";
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

// The book's Stripe payment link -> its price, so in-app sales land on the same Stripe product (looked up once, then saved).
async function priceOf(book: Obj): Promise<string | null> {
  if (book.stripe_price) return book.stripe_price;
  if (!book.stripe_link) return null;
  let after = "";
  for (let page = 0; page < 20; page++) {
    const r = await stripe("GET", "payment_links", { limit: "100", ...(after ? { starting_after: after } : {}) });
    const link = r.data.find((l: Obj) => l.url === book.stripe_link);
    if (link) {
      const items = await stripe("GET", `payment_links/${link.id}/line_items`, { limit: "1" });
      const price = items.data?.[0]?.price?.id ?? null;
      if (price) await admin.from("library_books").update({ stripe_price: price }).eq("id", book.id);
      return price;
    }
    if (!r.has_more || !r.data.length) break;
    after = r.data[r.data.length - 1].id;
  }
  return null;
}

async function unlockIfPaid(s: Obj): Promise<string | null> {
  const user = s.metadata?.user_id, book = s.metadata?.book_id;
  if (!user || !book || s.payment_status !== "paid") return null;
  await admin.from("library_purchases").upsert({ user_id: user, book_id: book, source: "stripe", stripe_session: s.id, amount_cents: s.amount_total, currency: s.currency }, { onConflict: "user_id,book_id", ignoreDuplicates: true });
  await admin.from("library_checkouts").update({ status: "paid" }).eq("session_id", s.id);
  return book;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  try {
    const auth = req.headers.get("Authorization") ?? "";
    const { data: u } = await admin.auth.getUser(auth.replace(/^Bearer\s+/i, ""));
    const user = u?.user;
    if (!user) return json({ error: "Please log in again." }, 401);
    const { data: role } = await admin.rpc("access_role", { p_email: user.email ?? "" });
    if (!["member", "host", "admin"].includes(String(role))) return json({ error: "Not allowed" }, 403);
    const body = await req.json().catch(() => ({}));

    if (body.action === "create") {
      const { data: book } = await admin.from("library_books").select("*").eq("id", String(body.book_id ?? "")).maybeSingle();
      if (!book || (!book.published && role !== "admin")) return json({ error: "This book isn't in the shop." }, 404);
      const { data: owned } = await admin.from("library_purchases").select("book_id").eq("user_id", user.id).eq("book_id", book.id).maybeSingle();
      if (owned) return json({ owned: true });
      const { data: pk } = await admin.rpc("app_secret", { p_name: "stripe_publishable" });
      const embedded = !!pk && body.embedded !== false;
      const back = `${APP_URL}/#/learn/library?paid={CHECKOUT_SESSION_ID}`;
      const price = await priceOf(book).catch((e) => { console.error("price lookup", e); return null; });
      const s = await stripe("POST", "checkout/sessions", {
        mode: "payment",
        "line_items[0][quantity]": "1",
        ...(price ? { "line_items[0][price]": price } : {
          "line_items[0][price_data][currency]": book.currency,
          "line_items[0][price_data][unit_amount]": String(book.price_cents),
          "line_items[0][price_data][product_data][name]": `${book.title_zh ? book.title_zh + " · " : ""}${book.title} (Club app book)`,
          "line_items[0][price_data][product_data][description]": book.subtitle ?? "Digital book in the Mandarin Zest Club app",
        }),
        client_reference_id: user.id,
        customer_email: user.email ?? "",
        "metadata[user_id]": user.id,
        "metadata[book_id]": book.id,
        "metadata[kind]": "club-library",
        "payment_intent_data[metadata][book_id]": book.id,
        "payment_intent_data[metadata][kind]": "club-library",
        ...(embedded ? { ui_mode: "embedded", return_url: back } : { success_url: back, cancel_url: `${APP_URL}/#/learn/library?shop=1` }),
      });
      await admin.from("library_checkouts").insert({ session_id: s.id, user_id: user.id, book_id: book.id });
      return json(embedded ? { client_secret: s.client_secret, publishable_key: pk, session_id: s.id } : { url: s.url, session_id: s.id });
    }

    if (body.action === "verify") {
      const since = new Date(Date.now() - 14 * 864e5).toISOString();
      const { data: open } = await admin.from("library_checkouts").select("session_id").eq("user_id", user.id).eq("status", "open").gte("created_at", since);
      const ids = new Set((open ?? []).map((r) => r.session_id));
      if (body.session_id) ids.add(String(body.session_id));
      const unlocked: string[] = [];
      for (const id of ids) {
        if (!/^cs_[A-Za-z0-9_]+$/.test(id)) continue;
        const s = await stripe("GET", `checkout/sessions/${id}`);
        if (s.metadata?.user_id !== user.id) continue;
        const b = await unlockIfPaid(s);
        if (b) unlocked.push(b);
        else if (s.status === "expired") await admin.from("library_checkouts").update({ status: "expired" }).eq("session_id", id);
      }
      const { data: own } = await admin.from("library_purchases").select("book_id").eq("user_id", user.id);
      return json({ owned: (own ?? []).map((r) => r.book_id), unlocked });
    }
    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});
