// Turns the Club's Google Calendar feed (.ics) into session rows.
// Same rules as the website calendar (scripts/build_events.py in
// Mandarin-Zest-Class-Calendar), except members also get the Meet link.
// ICAL (ical.js) is passed in so this file runs in Deno and in Node tests.

const CATEGORY_TAGS = new Set(["advanced", "intermediate", "beginner", "native", "character", "general"]);
const KEYWORD_RULES = [
  ["native", ["native"]],
  ["advanced", ["advanced"]],
  ["intermediate", ["intermediate", "hsk review", "listening"]],
  ["character", ["character", "bopomofo", "zhuyin", "stroke"]],
  ["beginner", ["beginner", "vocab"]],
];
const HIDE_TAGS = new Set(["hide", "private"]);
const URL_RE = /(https?:\/\/\S+|www\.\S+|\b[\w.-]+\.(?:com|google\.com|meet|zoom\.us|us|io|net|org)\/\S*)/gi;
const LEVEL_RE = /\(?\s*\b(HSK|TOCFL)\s*(\d)(?:\s*[-–~/]\s*(?:HSK|TOCFL)?\s*(\d))?\s*\)?/i;
const TAG_RE = /#(\w+)/g;
const TOPIC_RE = /^\s*(?:#trial\b[\s,.:;-]*)?topic\s*:\s*(.+)$/im;
const ABOUT_RE = /^\s*about\s*:\s*(.*(?:\n(?![ \t]*\n)(?![ \t]*[A-Za-z][\w ]{0,20}:).*)*)/im;
const HOST_RE = /^\s*host(?:ed by)?\s*:\s*(.+)$/im;
const EMAIL_RE = /\S+@\S+\.\S+/g;
const PHONE_RE = /\+?\d[\d ()./-]{7,}\d/g;
const MEET_RE = /https:\/\/meet\.google\.com\/[a-z]{3,4}-[a-z]{3,4}-[a-z]{3,4}/i;

function descriptionText(raw) {
  return String(raw || "")
    .replace(/<\s*br\s*\/?>|<\/p>|<\/div>|<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">").replace(/&#39;/g, "'").replace(/&quot;/g, '"');
}

function scrub(text, limit) {
  let t = String(text)
    .replace(URL_RE, "").replace(EMAIL_RE, "").replace(PHONE_RE, "")
    .replace(/\bpin\s*:?\s*[\d#]+/gi, "").replace(TAG_RE, "")
    .replace(/[ \t]{2,}/g, " ").replace(/\s*\n\s*/g, " ")
    .replace(/^[\s\-–·|,]+|[\s\-–·|,]+$/g, "");
  if (t.length > limit) t = t.slice(0, limit).replace(/\s+\S*$/, "") + "…";
  return t;
}

function findLine(re, text, limit) {
  const m = re.exec(text);
  return m ? scrub(m[1], limit) : "";
}

export function cleanTitle(raw) {
  let text = String(raw || "").replace(URL_RE, "");
  const tags = new Set([...text.matchAll(TAG_RE)].map((m) => m[1].toLowerCase()));
  text = text.replace(TAG_RE, "");
  let level = "";
  const m = LEVEL_RE.exec(text);
  if (m) {
    const name = m[1].toUpperCase();
    level = m[3] ? `${name} ${m[2]}-${m[3]}` : `${name} ${m[2]}`;
    text = text.slice(0, m.index) + text.slice(m.index + m[0].length);
  }
  for (let i = 0; i < 3; i++) text = text.replace(/^\s*MZ(?:\s*Club)?\b[\s:\-–·|]*/i, "");
  text = text.replace(/[(（]\s*(?:HSK|TOCFL)?\s*$/i, "").replace(/[(（]\s*[)）]/g, "");
  text = text.replace(/\s{2,}/g, " ").replace(/^[\s\-–·|,]+|[\s\-–·|,]+$/g, "");
  return { title: text.trim(), level, tags };
}

function pickCategory(title, level, tags) {
  for (const t of tags) if (CATEGORY_TAGS.has(t)) return t;
  const low = title.toLowerCase();
  for (const [cat, words] of KEYWORD_RULES) if (words.some((w) => low.includes(w))) return cat;
  const nums = (level.match(/\d/g) || []).map(Number);
  if (nums.length) {
    const top = Math.max(...nums);
    return top >= 5 ? "advanced" : top >= 3 ? "intermediate" : "beginner";
  }
  return "general";
}

function meetLink(comp, desc) {
  for (const p of comp.getAllProperties()) {
    const v = String(p.getFirstValue() ?? "");
    const m = MEET_RE.exec(v);
    if (m && /conference|location|description|url/i.test(p.name)) return m[0];
  }
  const m = MEET_RE.exec(desc);
  return m ? m[0] : "";
}

function toRow(ICAL, comp, start, end) {
  const status = String(comp.getFirstPropertyValue("status") || "").toUpperCase();
  if (status === "CANCELLED") return null;
  const klass = String(comp.getFirstPropertyValue("class") || "PUBLIC").toUpperCase();
  if (klass === "PRIVATE" || klass === "CONFIDENTIAL") return null;
  if (start.isDate) return null; // all-day: not a session
  const { title, level, tags } = cleanTitle(comp.getFirstPropertyValue("summary"));
  if (!title || [...tags].some((t) => HIDE_TAGS.has(t))) return null;
  const rawDesc = String(comp.getFirstPropertyValue("description") || "");
  const desc = descriptionText(rawDesc);
  const startJs = start.toJSDate();
  const uid = String(comp.getFirstPropertyValue("uid") || title);
  return {
    id: `${uid}|${startJs.toISOString()}`,
    title,
    level,
    category: pickCategory(title, level, tags),
    starts_at: startJs.toISOString(),
    ends_at: end ? end.toJSDate().toISOString() : null,
    topic: findLine(TOPIC_RE, desc, 200),
    about: findLine(ABOUT_RE, desc, 600),
    host_name: findLine(HOST_RE, desc, 60),
    meet_url: meetLink(comp, rawDesc),
  };
}

export function parseIcs(ICAL, text, from, to) {
  const root = new ICAL.Component(ICAL.parse(text));
  for (const tz of root.getAllSubcomponents("vtimezone")) {
    try { ICAL.TimezoneService.register(tz); } catch (_) { /* already known */ }
  }
  const masters = new Map();
  const exceptions = [];
  for (const ve of root.getAllSubcomponents("vevent")) {
    const uid = String(ve.getFirstPropertyValue("uid") || "");
    if (ve.hasProperty("recurrence-id")) exceptions.push(ve);
    else masters.set(uid, ve);
  }

  const rows = [];
  const inRange = (t) => {
    const d = t.toJSDate();
    return d >= from && d < to;
  };

  const events = new Map();
  for (const [uid, ve] of masters) events.set(uid, new ICAL.Event(ve));
  for (const ex of exceptions) {
    const uid = String(ex.getFirstPropertyValue("uid") || "");
    const master = events.get(uid);
    if (master) master.relateException(ex);
    else {
      // Moved instance whose series isn't in the feed: treat as a one-off.
      const ev = new ICAL.Event(ex);
      if (inRange(ev.startDate)) {
        const row = toRow(ICAL, ex, ev.startDate, ev.endDate);
        if (row) rows.push(row);
      }
    }
  }

  for (const ev of events.values()) {
    if (!ev.isRecurring()) {
      if (inRange(ev.startDate)) {
        const row = toRow(ICAL, ev.component, ev.startDate, ev.endDate);
        if (row) rows.push(row);
      }
      continue;
    }
    const it = ev.iterator();
    let next, guard = 0;
    while ((next = it.next()) && guard++ < 20000) {
      if (next.toJSDate() >= to) break;
      const d = ev.getOccurrenceDetails(next);
      if (!inRange(d.startDate) && !inRange(next)) continue;
      const row = toRow(ICAL, d.item.component, d.startDate, d.endDate);
      if (row) {
        // Keep the series' original slot in the id so a moved instance keeps its "I'm in".
        row.id = `${String(ev.uid)}|${next.toJSDate().toISOString()}`;
        rows.push(row);
      }
    }
  }
  rows.sort((a, b) => a.starts_at.localeCompare(b.starts_at) || a.title.localeCompare(b.title));
  const seen = new Set();
  return rows.filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));
}
