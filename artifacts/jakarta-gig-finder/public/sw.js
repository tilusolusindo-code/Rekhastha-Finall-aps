/* Service worker Rekhastha — sengaja minimal dan aman:
 *  - API, halaman, dan data pengguna TIDAK PERNAH disimpan (selalu langsung ke jaringan).
 *  - Hanya berkas statis ber-hash di /assets/ yang disimpan, supaya aplikasi terbuka lebih cepat.
 *  - Saat offline, pembukaan halaman menampilkan /offline.html.
 * Naikkan VERSION bila logika berkas ini berubah. */
const VERSION = "v1";
const ASSET_CACHE = `rekhastha-assets-${VERSION}`;
const OFFLINE_CACHE = `rekhastha-offline-${VERSION}`;
const OFFLINE_URL = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(OFFLINE_CACHE).then((c) => c.add(OFFLINE_URL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("rekhastha-") && k !== ASSET_CACHE && k !== OFFLINE_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return; // jangan pernah menyentuh API

  if (req.mode === "navigate") {
    event.respondWith(fetch(req).catch(() => caches.match(OFFLINE_URL)));
    return;
  }

  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(
      caches.open(ASSET_CACHE).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok && res.type === "basic") cache.put(req, res.clone());
        return res;
      }),
    );
  }
});
