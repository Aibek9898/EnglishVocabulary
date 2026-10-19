// Offline support. Built assets have hashed names, so they are cached forever;
// the page itself is fetched fresh (with a short timeout) so updates arrive.
const CACHE = 'vocab-v2';
const CORE = ['./', './manifest.webmanifest', './icon.svg', './icon-192.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(CORE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

const put = (request, response) => {
  if (response && response.ok) {
    const copy = response.clone();
    caches.open(CACHE).then((cache) => cache.put(request, copy));
  }
  return response;
};

const timeout = (ms) => new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms));

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  // Google Fonts: cache-first, so the font works offline after the first visit.
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(caches.match(request).then((hit) => hit || fetch(request).then((r) => put(request, r))));
    return;
  }
  if (url.origin !== self.location.origin) return;

  // Pages: network first, fall back to the cached app after 3 s or offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      Promise.race([fetch(request).then((r) => put('./', r)), timeout(3000)]).catch(() =>
        caches.match('./').then((hit) => hit || fetch(request)),
      ),
    );
    return;
  }

  // Hashed assets and icons: cache first.
  event.respondWith(caches.match(request).then((hit) => hit || fetch(request).then((r) => put(request, r))));
});
