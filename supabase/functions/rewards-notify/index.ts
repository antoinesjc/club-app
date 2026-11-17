// Phone notifications for rewards: XP given by the team, new stickers, new characters and level-ups.
// Called every 5 minutes by pg_cron (private.call_fn('rewards-notify')). Needs header x-sync-secret.
// Push only (no email). Members can turn these off in Settings ("Rewards").
import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const APP_URL = "https://app.mandarinzest.com";
const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });

// Keep in sync with fruits.js (level → fruits) and stickers.js (key → name).
const FRUITS: [number, string][] = [[1, "Orange"], [1, "Apple"], [1, "Peach"], [2, "Strawberry"], [3, "Lemon"], [4, "Mango"], [5, "Watermelon"],
  [6, "Pineapple"], [7, "Kiwi"], [8, "Cherry"], [9, "Coconut"], [10, "Dragon fruit"], [11, "Lychee"], [12, "Pomelo"], [13, "Star fruit"],
  [14, "Guava"], [15, "Passion fruit"], [16, "Persimmon"], [17, "Rambutan"], [18, "Durian"]];
const STICKERS: Record<string, string> = { boba: "Bubble tea", tones: "Four tones", lantern: "Lantern", dumpling: "Dumpling", brush: "Brush",
  mooncake: "Mooncake", phone: "Smartphone", heart: "Orange heart", medal: "Medal", founder: "Founding member", turkey: "Turkey" };
const AVATARS: Record<string, string> = { corn: "Corn" };

async function pushTo(userId: string, payload: string) {
  const { data: subs } = await db.from("push_subscriptions").select("*").eq("user_id", userId);
  let ok = 0;
  for (const s of subs ?? []) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 86400 });
      ok++;
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) await db.from("push_subscriptions").delete().eq("endpoint", s.endpoint);
      else console.error("Push failed:", code, (e as Error).message);
    }
  }
  return ok;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const given = req.headers.get("x-sync-secret") ?? "";
  const { data: secret } = await db.rpc("app_secret", { p_name: "sync_secret" });
  if (given.length < 20 || !secret || given !== secret) return json({ error: "Not allowed" }, 401);
  try {
    const [xp, stk, av, lv] = await Promise.all([
      db.from("xp_awards").select("id, user_id, points, reason").is("notified_at", null).limit(100),
      db.from("sticker_awards").select("id, user_id, sticker").is("notified_at", null).limit(100),
      db.from("avatar_awards").select("id, user_id, avatar, reason").is("notified_at", null).limit(100),
      db.rpc("reward_level_ups"),
    ]);
    for (const r of [xp, stk, av, lv]) if (r.error) throw r.error;
    const msgs: { user: string; m: Record<string, string> }[] = [];
    for (const a of xp.data!) msgs.push({ user: a.user_id, m: { title: `⭐ +${a.points} XP`, body: a.reason || "A gift from the Mandarin Zest team.", url: `${APP_URL}/#/me`, tag: `xp-${a.id}` } });
    for (const a of stk.data!) msgs.push({ user: a.user_id, m: { title: "🎉 New sticker!", body: `You got the ${STICKERS[a.sticker] || a.sticker} sticker. Wear it on your avatar in Me.`, url: `${APP_URL}/#/me`, tag: `stk-${a.id}` } });
    for (const a of av.data!) msgs.push({ user: a.user_id, m: { title: "🎉 New character unlocked!", body: `${AVATARS[a.avatar] || a.avatar} is yours. Choose it in Me → Avatar customization.`, url: `${APP_URL}/#/me`, tag: `av-${a.id}` } });
    for (const u of (lv.data ?? []) as { user_id: string; new_level: number }[]) {
      const f = FRUITS.filter(([l]) => l === u.new_level).map(([, n]) => n);
      msgs.push({ user: u.user_id, m: { title: `🎉 Level ${u.new_level}!`, body: f.length ? `You unlocked the ${f.join(" and ")}. Choose it in Me.` : "Keep it up!", url: `${APP_URL}/#/me`, tag: `lv-${u.user_id}-${u.new_level}` } });
    }
    let sent = 0;
    if (msgs.length) {
      const { data: pub } = await db.rpc("app_secret", { p_name: "vapid_public" });
      const { data: priv } = await db.rpc("app_secret", { p_name: "vapid_private" });
      webpush.setVapidDetails("mailto:club@mandarinzest.com", pub, priv);
      const users = [...new Set(msgs.map((x) => x.user))];
      const { data: prefs } = await db.from("profiles").select("id, notify_rewards").in("id", users);
      const off = new Set((prefs ?? []).filter((p) => p.notify_rewards === false).map((p) => p.id));
      for (const x of msgs) if (!off.has(x.user)) sent += (await pushTo(x.user, JSON.stringify(x.m))) > 0 ? 1 : 0;
    }
    const now = new Date().toISOString();
    const mark = (t: string, rows: { id: string }[]) => rows.length ? db.from(t).update({ notified_at: now }).in("id", rows.map((r) => r.id)) : null;
    await Promise.all([mark("xp_awards", xp.data!), mark("sticker_awards", stk.data!), mark("avatar_awards", av.data!)]);
    return json({ ok: true, messages: msgs.length, sent });
  } catch (e) {
    console.error(e);
    return json({ error: (e as Error).message }, 500);
  }
});
