// Click tracking for Mandarin Zest emails (welcome email, Start Here sheet script apps-script/free-pdf-emails.gs
// in the Mandarin-Zest-Class-Calendar repo). Deployed with verify_jwt = false.
// GET  /go?r=<rid>&l=<link>&u=<url>  -> records the click (rid = random id per email, no email address), then 302 to the page.
//      Only mandarinzest.com pages are allowed, so it can't be used as an open redirect.
// POST /go {rids:[...]}               -> the clicks for those ids (only someone who has the ids, i.e. the sheet, can read them).
const SB = Deno.env.get("SUPABASE_URL")!, KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };
const HOME = "https://www.mandarinzest.com/";
const RID = /^[a-z0-9]{12,40}$/i, LINK = /^[a-z0-9-]{1,80}$/;
// link scanners and prefetchers (corporate email security, previews): recorded but not counted as clicks
const BOT = /bot|crawl|spider|preview|scanner|proofpoint|barracuda|mimecast|safelinks|microsoft office|python|curl|wget|headless|go-http|java\//i;

Deno.serve(async (req) => {
  const url = new URL(req.url);
  if (req.method === "POST") {
    let rids: string[] = [];
    try { rids = ((await req.json()).rids || []).filter((r: string) => RID.test(r)).slice(0, 1000); } catch (_) { /* empty */ }
    if (!rids.length) return json([]);
    const r = await fetch(`${SB}/rest/v1/email_clicks?select=rid,link,ua,clicked_at&rid=in.(${rids.join(",")})&order=clicked_at.asc`, { headers: H });
    const rows = r.ok ? await r.json() : [];
    return json(rows.filter((x: { ua: string }) => !BOT.test(x.ua || "")).map((x: { rid: string; link: string; clicked_at: string }) => ({ r: x.rid, l: x.link, t: x.clicked_at })));
  }
  let to = url.searchParams.get("u") || HOME;
  if (!/^https:\/\/www\.mandarinzest\.com(\/|$)/.test(to)) to = HOME;
  const rid = url.searchParams.get("r") || "", link = (url.searchParams.get("l") || "").toLowerCase();
  if (req.method === "GET" && RID.test(rid) && LINK.test(link)) {
    const ua = (req.headers.get("user-agent") || "").slice(0, 300);
    try { await fetch(`${SB}/rest/v1/email_clicks`, { method: "POST", headers: { ...H, Prefer: "return=minimal" }, body: JSON.stringify({ rid, link, ua }) }); } catch (_) { /* never block the visitor */ }
  }
  return new Response(null, { status: 302, headers: { Location: to, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
});
function json(x: unknown) { return new Response(JSON.stringify(x), { headers: { "Content-Type": "application/json" } }); }
