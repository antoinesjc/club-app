// Who is a paying Club member according to Stripe.
// Monthly link = recurring subscription: member while it's active (+3 days grace).
// Yearly link  = one-time payment: member for 12 months from the payment date;
//                paying again early adds a year on top of the remaining time.
// Fully refunded payments don't count.

export const PLINK_MONTHLY = "plink_1UR8dsFSITwJ0tdScr66iqQh";
export const PLINK_YEARLY = "plink_1UR8h6FSITwJ0tdSyzBTSsLY";

const GRACE_MS = 3 * 24 * 3600 * 1000;

export type StripeMember = {
  email: string;
  name: string;
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

function periodEnd(sub: Obj): number | null {
  const end = sub.current_period_end ?? sub.items?.data?.[0]?.current_period_end;
  return typeof end === "number" ? end * 1000 : null;
}

// Turn completed Club checkouts into one record per email.
export async function membersFromCheckouts(sessions: Obj[]): Promise<Map<string, StripeMember>> {
  const now = Date.now();
  const club = sessions
    .filter((s) => s.status === "complete" && (s.payment_link === PLINK_MONTHLY || s.payment_link === PLINK_YEARLY))
    .filter((s) => s.customer_details?.email)
    .sort((a, b) => a.created - b.created);

  const byEmail = new Map<string, StripeMember>();
  const yearlyUntil = new Map<string, number>();

  for (const s of club) {
    const email = String(s.customer_details.email).trim().toLowerCase();
    const name = String(s.customer_details.name ?? "").trim();
    const customer = typeof s.customer === "string" ? s.customer : s.customer?.id ?? null;
    let rec: StripeMember | undefined;

    if (s.payment_link === PLINK_YEARLY) {
      if (s.payment_status !== "paid" || await fullyRefunded(s)) continue;
      const paid = s.created * 1000;
      const prev = yearlyUntil.get(email) ?? 0;
      const base = new Date(Math.max(prev, paid));
      base.setUTCFullYear(base.getUTCFullYear() + 1);
      yearlyUntil.set(email, base.getTime());
      rec = { email, name, plan: "yearly", member_until: base.toISOString(), active: base.getTime() > now, customer_id: customer };
    } else {
      const subId = typeof s.subscription === "string" ? s.subscription : s.subscription?.id;
      if (!subId) continue;
      const sub = await stripeGet(`subscriptions/${subId}`);
      const live = ["active", "trialing", "past_due"].includes(sub.status);
      const end = periodEnd(sub);
      const until = end ? new Date(end + GRACE_MS).toISOString() : null;
      rec = { email, name, plan: "monthly", member_until: live ? until : (end ? new Date(end).toISOString() : null), active: live, customer_id: customer };
    }

    const old = byEmail.get(email);
    // Keep whichever record gives access the longest.
    const score = (r: StripeMember) => (r.active ? 1e15 : 0) + (r.member_until ? Date.parse(r.member_until) : (r.active ? 9e14 : 0));
    if (!old || score(rec) >= score(old)) byEmail.set(email, { ...rec, name: rec.name || old?.name || "" });
  }
  return byEmail;
}

export async function allClubMembers(): Promise<Map<string, StripeMember>> {
  const sessions = [
    ...(await listAll("checkout/sessions", { payment_link: PLINK_MONTHLY, status: "complete" })),
    ...(await listAll("checkout/sessions", { payment_link: PLINK_YEARLY, status: "complete" })),
  ];
  return membersFromCheckouts(sessions);
}

export async function clubMemberByEmail(email: string): Promise<StripeMember | null> {
  const sessions = await listAll("checkout/sessions", { "customer_details[email]": email, status: "complete" });
  // Stripe matches the email exactly as typed at checkout; also try lower-case.
  const map = await membersFromCheckouts(sessions);
  return map.get(email.toLowerCase()) ?? null;
}
