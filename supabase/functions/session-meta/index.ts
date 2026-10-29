// Level and categories of each session, read from the Google Calendar description exactly like the
// website calendar (scripts/build_events.py in Mandarin-Zest-Class-Calendar, 30 Oct 2026):
//     Level: Beginner                  (Beginner, Intermediate, Advanced or All levels)
//     Category: Conversation, Culture  (one or more: conversation, culture, grammar, characters,
//                                       book club, listening, reading, vocabulary, no agenda)
// Without those lines they are guessed from the title. Writes sessions.skill_level and sessions.cats.
// (The Host: line is already read by the main calendar sync into sessions.host_name.)
// Called every 15 minutes by pg_cron (private.call_fn('session-meta')). Needs header x-sync-secret.
import { createClient } from "npm:@supabase/supabase-js@2";
import ICAL from "npm:ical.js@2";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });

const LEVEL_WORDS: Record<string, string> = {
  "beginner": "Beginner", "beginners": "Beginner", "elementary": "Beginner", "basic": "Beginner",
  "intermediate": "Intermediate", "inter": "Intermediate",
  "advanced": "Advanced",
  "all": "All levels", "all levels": "All levels", "any": "All levels", "everyone": "All levels", "mixed": "All levels",
};
const CATEGORY_WORDS: Record<string, string> = {
  "conversation": "conversation", "conversations": "conversation", "speaking": "conversation", "talk": "conversation",
  "culture": "culture", "cultural": "culture",
  "grammar": "grammar",
  "characters": "characters", "character": "characters", "hanzi": "characters", "writing": "characters",
  "book club": "bookclub", "bookclub": "bookclub", "book": "bookclub",
  "listening": "listening",
  "reading": "reading",
  "vocabulary": "vocabulary", "vocab": "vocabulary", "words": "vocabulary",
  "no agenda": "noagenda", "noagenda": "noagenda", "free talk": "noagenda", "open": "noagenda", "none": "noagenda",
};
const KEYWORD_RULES: [string, string[]][] = [
  ["bookclub", ["book club", "bookclub"]],
  ["characters", ["character", "bopomofo", "zhuyin", "stroke", "hanzi"]],
  ["grammar", ["grammar"]],
  ["listening", ["listening", "video comprehension"]],
  ["reading", ["reading"]],
  ["vocabulary", ["vocab"]],
  ["culture", ["culture", "geography", "holiday", "festival", "dumpling", "snack", "food"]],
  ["noagenda", ["no agenda", "free talk", "topictbd", "topic tbd", "open topic"]],
  ["conversation", ["conversation", "native", "speaking", "chat"]],
];
const LEVEL_LINE_RE = /^\s*level\s*:\s*(.+)$/im;
const CATEGORY_LINE_RE = /^\s*categor(?:y|ies)\s*:\s*(.+)$/im;
const HSK_RE = /\b(?:HSK|TOCFL)\s*(\d)(?:\s*[-–~/]\s*(?:HSK|TOCFL)?\s*(\d))?/i;
const TAG_RE = /#(\w+)/g;

function descriptionText(raw: string) {
  return String(raw || "")
    .replace(/<\s*br\s*\/?>|<\/p>|<\/div>|<\/li>/gi, "\n").replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'").replace(/&quot;/g, '"');
}

function parseLevel(desc: string, title: string, tags: Set<string>) {
  const m = LEVEL_LINE_RE.exec(desc);
  if (m) {
    const low = m[1].trim().toLowerCase().replace(/\.$/, "");
    for (const [w, l] of Object.entries(LEVEL_WORDS).sort((a, b) => b[0].length - a[0].length)) if (low.startsWith(w)) return l;
  }
  for (const t of tags) if (LEVEL_WORDS[t]) return LEVEL_WORDS[t];
  const low = title.toLowerCase();
  for (const w of ["advanced", "intermediate", "beginner"]) if (low.includes(w)) return LEVEL_WORDS[w];
  const h = HSK_RE.exec(title);
  if (h) {
    const nums = [Number(h[1]), Number(h[2] || h[1])];
    const mid = (Math.min(...nums) + Math.max(...nums)) / 2;
    return mid <= 2.5 ? "Beginner" : mid <= 4 ? "Intermediate" : "Advanced";
  }
  return ""; // unknown: "All levels" is only set on purpose
}

function parseCategories(desc: string, title: string, tags: Set<string>) {
  let found: string[] = [];
  const m = CATEGORY_LINE_RE.exec(desc);
  if (m) {
    for (const part of m[1].toLowerCase().split(/[,/;&+]|\band\b/)) {
      const k = CATEGORY_WORDS[part.trim().replace(/[.!]+$/, "")];
      if (k && !found.includes(k)) found.push(k);
    }
  }
  if (!found.length) found = [...tags].filter((t) => CATEGORY_WORDS[t]).map((t) => CATEGORY_WORDS[t]);
  if (!found.length) {
    const low = title.toLowerCase();
    const hits: [number, string][] = [];
    for (const [cat, words] of KEYWORD_RULES) {
      const pos = words.filter((w) => low.includes(w)).map((w) => low.indexOf(w));
      if (pos.length) hits.push([Math.min(...pos), cat]);
    }
    found = hits.sort((a, b) => a[0] - b[0]).map((h) => h[1]);
  }
  return found.length ? found : ["conversation"];
}

function metaOf(comp: ICAL.Component) {
  const summary = String(comp.getFirstPropertyValue("summary") || "");
  const tags = new Set([...summary.matchAll(TAG_RE)].map((x) => x[1].toLowerCase()));
  const title = summary.replace(TAG_RE, "");
  const desc = descriptionText(String(comp.getFirstPropertyValue("description") || ""));
  return { skill_level: parseLevel(desc, title, tags), cats: parseCategories(desc, title, tags) };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const given = req.headers.get("x-sync-secret") ?? "";
  const { data: secret } = await db.rpc("app_secret", { p_name: "sync_secret" });
  if (given.length < 20 || !secret || given !== secret) return json({ error: "Not allowed" }, 401);
  try {
    const url = Deno.env.get("GCAL_ICS_URL");
    if (!url) throw new Error("GCAL_ICS_URL secret is missing");
    const res = await fetch(url, { headers: { "User-Agent": "mz-club-app" } });
    if (!res.ok) throw new Error(`Calendar feed: HTTP ${res.status}`);
    const root = new ICAL.Component(ICAL.parse(await res.text()));
    for (const tz of root.getAllSubcomponents("vtimezone")) { try { ICAL.TimezoneService.register(tz); } catch (_) { /* known */ } }
    const series = new Map<string, ReturnType<typeof metaOf>>();   // uid → meta of the series
    const moved = new Map<string, ReturnType<typeof metaOf>>();    // "uid|start ISO" → meta of an edited occurrence
    for (const ve of root.getAllSubcomponents("vevent")) {
      const uid = String(ve.getFirstPropertyValue("uid") || "");
      const meta = metaOf(ve);
      if (ve.hasProperty("recurrence-id")) {
        const start = ve.getFirstPropertyValue("dtstart") as ICAL.Time;
        if (start) moved.set(`${uid}|${start.toJSDate().toISOString()}`, meta);
      } else series.set(uid, meta);
    }
    const since = new Date(Date.now() - 40 * 864e5).toISOString();
    const { data: rows, error } = await db.from("sessions").select("id, title, skill_level, cats").gte("starts_at", since);
    if (error) throw error;
    let changed = 0;
    for (const r of rows ?? []) {
      const uid = r.id.split("|")[0];
      const meta = moved.get(r.id) ?? series.get(uid) ?? { skill_level: parseLevel("", r.title, new Set()), cats: parseCategories("", r.title, new Set()) };
      if (meta.skill_level === (r.skill_level ?? "") && JSON.stringify(meta.cats) === JSON.stringify(r.cats ?? [])) continue;
      const { error: e2 } = await db.from("sessions").update(meta).eq("id", r.id);
      if (e2) throw e2;
      changed++;
    }
    return json({ ok: true, sessions: rows?.length ?? 0, changed });
  } catch (e) {
    console.error(e);
    return json({ ok: false, error: String((e as Error).message ?? e) }, 500);
  }
});
