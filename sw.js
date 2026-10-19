// Keeps the app shell available offline, and shows Club notifications.
// Data always comes from the network.
const VERSION = "mz-club-v4";
const SHELL = [
  "./", "index.html", "styles.css?v=4", "app.js?v=4", "fruits.js", "countries.js",
  "vendor/supabase.js", "manifest.webmanifest", "icons/logo.png", "icons/icon-192.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
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
  e.respondWith(
    fetch(e.request)
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
    badge: "icons/icon-192.png",
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
