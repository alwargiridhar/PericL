/* PericL Service Worker — offline shell + drift-nudge scheduling.
 *
 * Intentionally minimal: cache only the app shell, let API requests always
 * hit the network. The drift-nudge logic lives here so the nudge still fires
 * when PericL is closed or backgrounded — as long as the OS keeps the SW alive.
 */
const CACHE = "pericl-shell-v1";
const SHELL = [
    "/",
    "/manifest.json",
    "/icon-192.png",
    "/icon-512.png",
    "/apple-touch-icon.png",
];

self.addEventListener("install", (e) => {
    e.waitUntil(
        caches.open(CACHE).then((c) =>
            Promise.allSettled(SHELL.map((u) => c.add(u).catch(() => null)))
        )
    );
    self.skipWaiting();
});

self.addEventListener("activate", (e) => {
    e.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
        )
    );
    self.clients.claim();
});

self.addEventListener("fetch", (e) => {
    const url = new URL(e.request.url);
    // Always go to network for API + auth flows
    if (url.pathname.startsWith("/api") || e.request.method !== "GET") return;
    if (url.origin !== self.location.origin) return;
    e.respondWith(
        caches.match(e.request).then((hit) => {
            if (hit) return hit;
            return fetch(e.request)
                .then((resp) => {
                    if (resp && resp.status === 200 && resp.type === "basic") {
                        const copy = resp.clone();
                        caches.open(CACHE).then((c) => c.put(e.request, copy));
                    }
                    return resp;
                })
                .catch(() => caches.match("/"));
        })
    );
});

/* ---------- Drift nudge ---------- */

// Message channel from the app to schedule a one-off nudge.
// { type: "schedule-drift-nudge", fireAt: <ms epoch>, title, body }
self.addEventListener("message", (e) => {
    const m = e.data || {};
    if (m.type === "schedule-drift-nudge" && typeof m.fireAt === "number") {
        const delay = Math.max(0, m.fireAt - Date.now());
        // Use setTimeout — the SW will be kept alive while the timer is pending
        // on most mobile browsers. Not guaranteed when the OS kills the SW;
        // the app-side modal handles that case on next return.
        self._nudgeTimer && clearTimeout(self._nudgeTimer);
        self._nudgeTimer = setTimeout(() => {
            self.registration.showNotification(m.title || "A gentle nudge", {
                body: m.body || "You've been away a while. One small move back?",
                tag: "pericl-drift-nudge",
                icon: "/icon-192.png",
                badge: "/icon-192.png",
                data: { kind: "drift-nudge", url: "/chat" },
                requireInteraction: false,
                silent: false,
            });
        }, delay);
    }
    if (m.type === "cancel-drift-nudge") {
        self._nudgeTimer && clearTimeout(self._nudgeTimer);
        self._nudgeTimer = null;
    }
});

self.addEventListener("notificationclick", (e) => {
    e.notification.close();
    const url = (e.notification.data && e.notification.data.url) || "/";
    e.waitUntil(
        clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
            for (const w of wins) {
                if ("focus" in w) {
                    w.navigate && w.navigate(url);
                    return w.focus();
                }
            }
            return clients.openWindow(url);
        })
    );
});
