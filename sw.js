// Keeps the app shell available offline, and shows Club notifications.
// Data always comes from the network.
const VERSION = "mz-club-v135";
const SHELL = [
  "./", "index.html", "styles.css?v=135", "app.js?v=135", "fruits.js?v=135", "hosts-art.js?v=135", "countries.js?v=135", "stickers.js?v=135", "zhuyin.js?v=135", "course-oracle.js?v=135", "worldmap.js?v=135",
  "vendor/supabase.js?v=135", "manifest.webmanifest", "icons/logo.png", "icons/mascot.svg", "icons/icon-192.png", "icons/badge-96.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: "no-cache" })))).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  // Network first, so updates show up right away; cache as a fallback.
  // Page loads ("navigate") can't be re-fetched with options (it throws, and we fell back to the cached page,
  // so phones kept an old version). Fetch them by URL instead.
  const net = e.request.mode === "navigate"
    ? fetch(url.href, { cache: "no-cache", credentials: "same-origin" })
    : fetch(e.request, { cache: "no-cache" }); // always ask the server, so files never mix versions
  e.respondWith(
    net
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match("index.html"))),
  );
});

// Notifications from the Club (reminders, new sessions, notes are up).
self.addEventListener("push", (e) => {
  let m = {};
  try { m = e.data ? e.data.json() : {}; } catch { m = { title: "Mandarin Zest Club", body: e.data?.text() || "" }; }
  e.waitUntil(self.registration.showNotification(m.title || "Mandarin Zest Club", {
    body: m.body || "",
    icon: "icons/icon-192.png",
    badge: "icons/badge-96.png", // white-on-transparent: Android paints this shape in the status bar
    tag: m.tag,
    data: { url: m.url || "./#/home" },
  }));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = e.notification.data?.url || "./#/home";
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const w of wins) {
      if (new URL(w.url).origin === location.origin) { await w.focus(); return w.navigate(url); }
    }
    return self.clients.openWindow(url);
  })());
});
