// The cache name follows APP_VERSION in calc.js, so bumping the version there refreshes offline caches.
importScripts('./calc.js');
const CACHE_NAME = 'spps-resin-v' + self.SPPSCalc.APP_VERSION;
const ASSETS = [
  './', './index.html', './styles.css', './calc.js', './i18n.js', './app.js', './manifest.webmanifest',
  './icon-180.png', './icon-192.png', './icon-512.png', './icon-maskable-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

// Network first, falling back to the cache (and to the app shell for navigations) when offline.
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(event.request).then(response => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
      }
      return response;
    }).catch(() => caches.match(event.request).then(hit => hit || (event.request.mode === 'navigate' ? caches.match('./index.html') : undefined)))
  );
});
