// Who is a paying member according to Stripe, and on which plan (28 Nov 2026):
//   tier "club" = Club membership (monthly, or yearly), tier "self" = Self-Study (monthly).
// Subscriptions (all links since 28 Nov, incl. the new yearly Club link): member while the subscription is
// active (+3 days grace). The tier comes from the subscription's CURRENT product, so a switch in Stripe's
// customer portal (Self-Study <-> Club) is picked up even though the checkout was made with the other link.
// Old yearly links = one-time payment: member for 12 months from the payment date (paying again early adds a year).
// Fully refunded payments don't count.

// Old links (US$20 / US$200) stay listed so people who paid with them keep access.
export const PLINKS_MONTHLY = [
  "plink_1USwvpFSITwJ0tdSclfdQxwj", // Club US$25/month (from 21 Oct 2026)
  "plink_1UR8dsFSITwJ0tdScr66iqQh", // Club US$20/month (old)
];
export const PLINKS_YEARLY = [
  "plink_1USwunFSITwJ0tdSjeNvHqIS", // Club US$250/year, one-time (21 Oct - 28 Nov 2026)
  "plink_1UR8h6FSITwJ0tdSyzBTSsLY", // Club US$200/year, one-time (old)
];
// Links found by their address (their ids are looked up in Stripe on first use).
export const LINK_URLS = {
  clubYearly: "https://buy.stripe.com/14A3cv6Wt4n30feg4B6oo0x", // Club yearly subscription (from 28 Nov 2026)
  self: "https://buy.stripe.com/fZu5kD6Wt4n32nm8C96oo0v",       // Self-Study monthly subscription (from 28 Nov 2026)
};
const isYearly = (l: unknown) => PLINKS_YEARLY.includes(String(l));

const GRACE_MS = 3 * 24 * 3600 * 1000;

export type StripeMember = {
  email: string;
  name: string;
  tier: "club" | "self";
  plan: "monthly" | "yearly";
  member_until: string | null;
  active: boolean;
  customer_id: string | null;
};

// deno-lint-ignore no-explicit-any
type Obj = Record<string, any>;

async function stripeGet(path: string, params: Record<string, string> = {}): Promise<Obj> {
  const key = Deno.env.get("STRIPE_KEY");
  if (!key) throw new Error("STRIPE_KEY secret is missing");
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`https://api.stripe.com/v1/${path}${qs ? "?" + qs : ""}`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`Stripe ${path}: ${body?.error?.message ?? res.status}`);
  return body;
}

async function listAll(path: string, params: Record<string, string>): Promise<Obj[]> {
  const out: Obj[] = [];
  let after = "";
  for (let page = 0; page < 50; page++) {
    const body = await stripeGet(path, { ...params, limit: "100", ...(after ? { starting_after: after } : {}) });
    out.push(...body.data);
    if (!body.has_more || !body.data.length) break;
    after = body.data[body.data.length - 1].id;
  }
  return out;
}

async function fullyRefunded(session: Obj): Promise<boolean> {
  const pi = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
  if (!pi) return false;
  const refunds = await stripeGet("refunds", { payment_intent: pi, limit: "20" });
  const refunded = refunds.data
    .filter((r: Obj) => r.status === "succeeded" || r.status === "pending")
    .reduce((sum: number, r: Obj) => sum + (r.amount ?? 0), 0);
  return refunded > 0 && refunded >= (session.amount_total ?? 0);
}

// Payment link ids and the Self-Study product, looked up from LINK_URLS (once per run).
let LINKS: { ids: Record<string, string>; selfProduct: string | null } | null = null;
export async function links() {
  if (LINKS) return LINKS;
  const ids: Record<string, string> = {}; let after = "";
  const want = new Map(Object.entries(LINK_URLS).map(([k, u]) => [u, k]));
  for (let page = 0; page < 20 && want.size > Object.keys(ids).length; page++) {
    const r = await stripeGet("payment_links", { limit: "100", ...(after ? { starting_after: after } : {}) });
    for (const l of r.data) { const k = want.get(l.url); if (k) ids[k] = l.id; }
    if (!r.has_more || !r.data.length) break;
    after = r.data[r.data.length - 1].id;
  }
  let selfProduct: string | null = null;
  if (ids.self) {
    const items = await stripeGet(`payment_links/${ids.self}/line_items`, { limit: "1" });
    const pr = items.data?.[0]?.price;
    selfProduct = typeof pr?.product === "string" ? pr.product : pr?.product?.id ?? null;
  }
  LINKS = { ids, selfProduct };
  return LINKS;
}

function periodEnd(sub: Obj): number | null {
  const end = sub.current_period_end ?? sub.items?.data?.[0]?.current_period_end;
  return typeof end === "number" ? end * 1000 : null;
}

// Turn completed Club checkouts into one record per email.
export async function membersFromCheckouts(sessions: Obj[]): Promise<Map<string, StripeMember>> {
  const now = Date.now();
  const L = await links();
  const subLinks = new Set([...PLINKS_MONTHLY, ...Object.values(L.ids)]);
  const club = sessions
    .filter((s) => s.status === "complete" && (subLinks.has(String(s.payment_link)) || isYearly(s.payment_link)))
    .filter((s) => s.customer_details?.email)
    .sort((a, b) => a.created - b.created);

  const byEmail = new Map<string, StripeMember>();
  const yearlyUntil = new Map<string, number>();

  for (const s of club) {
    const email = String(s.customer_details.email).trim().toLowerCase();
    const name = String(s.customer_details.name ?? "").trim();
    const customer = typeof s.customer === "string" ? s.customer : s.customer?.id ?? null;
    let rec: StripeMember | undefined;

    if (isYearly(s.payment_link)) {
      if (s.payment_status !== "paid" || await fullyRefunded(s)) continue;
      const paid = s.created * 1000;
      const prev = yearlyUntil.get(email) ?? 0;
      const base = new Date(Math.max(prev, paid));
      base.setUTCFullYear(base.getUTCFullYear() + 1);
      yearlyUntil.set(email, base.getTime());
      rec = { email, name, tier: "club", plan: "yearly", member_until: base.toISOString(), active: base.getTime() > now, customer_id: customer };
    } else {
      const subId = typeof s.subscription === "string" ? s.subscription : s.subscription?.id;
      if (!subId) continue;
      const sub = await stripeGet(`subscriptions/${subId}`);
      const live = ["active", "trialing", "past_due"].includes(sub.status);
      const end = periodEnd(sub);
      const until = end ? new Date(end + GRACE_MS).toISOString() : null;
      const price = sub.items?.data?.[0]?.price ?? {};
      const product = typeof price.product === "string" ? price.product : price.product?.id;
      const tier = L.selfProduct && product === L.selfProduct ? "self" : "club";
      const plan = price.recurring?.interval === "year" ? "yearly" : "monthly";
      rec = { email, name, tier, plan, member_until: live ? until : (end ? new Date(end).toISOString() : null), active: live, customer_id: customer };
    }

    const old = byEmail.get(email);
    // Keep whichever record gives access the longest (an active Club record beats an active Self-Study one).
    const score = (r: StripeMember) => (r.active ? 1e15 : 0) + (r.active && r.tier === "club" ? 1e14 : 0) + (r.member_until ? Date.parse(r.member_until) : (r.active ? 9e13 : 0));
    if (!old || score(rec) >= score(old)) byEmail.set(email, { ...rec, name: rec.name || old?.name || "" });
  }
  return byEmail;
}

export async function allClubMembers(): Promise<Map<string, StripeMember>> {
  const sessions: Obj[] = [];
  const L = await links();
  for (const link of [...PLINKS_MONTHLY, ...PLINKS_YEARLY, ...Object.values(L.ids)]) {
    sessions.push(...(await listAll("checkout/sessions", { payment_link: link, status: "complete" })));
  }
  return membersFromCheckouts(sessions);
}

export async function clubMemberByEmail(email: string): Promise<StripeMember | null> {
  const sessions = await listAll("checkout/sessions", { "customer_details[email]": email, status: "complete" });
  // Stripe matches the email exactly as typed at checkout; also try lower-case.
  const map = await membersFromCheckouts(sessions);
  return map.get(email.toLowerCase()) ?? null;
}
