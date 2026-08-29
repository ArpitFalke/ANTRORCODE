/* ════════════════════════════════════════════════════════════════
   ANTROR Code — service worker
   Offline-first app shell: the studio keeps working with no network
   (AI calls obviously still need internet). A product by ANTROR.
   ════════════════════════════════════════════════════════════════ */
'use strict';
const CACHE = 'antror-v1';
const ASSETS = [
  '/', '/index.html', '/login.html', '/register.html', '/settings.html',
  '/legal.html', '/download.html', '/auth.html',
  '/styles.css', '/app.js', '/supabase.js', '/supabase-config.js', '/terminal.js',
  '/manifest.json', '/assets/logo.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => Promise.allSettled(ASSETS.map((a) => c.add(a))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return; // never touch API/CDN traffic
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then((hit) => hit ||
      fetch(e.request).then((r) => {
        const copy = r.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return r;
      }).catch(() => caches.match('/index.html'))
    )
  );
});
