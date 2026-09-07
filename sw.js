/* ANTROR Code — service worker retired.
   This self-uninstalling worker removes every old cache and unregisters
   itself, so browsers that installed a previous version get clean, always-fresh files. */
'use strict';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.map((k) => caches.delete(k))))
      .then(() => self.registration.unregister())
      .then(() => self.clients.claim())
  );
});
