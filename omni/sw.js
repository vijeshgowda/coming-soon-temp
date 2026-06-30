const CACHE_NAME = 'omni-v5';
// Relative paths resolve against the service worker's location (/omni/sw.js),
// so this app stays self-contained under /omni/ alongside sibling apps at root.
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/styles.css',
  './js/app.js',
  './js/boot.js',
  './js/config.js',
  './js/crypto.js',
  './js/signaling.js',
  './js/webrtc.js',
  './js/sounds.js',
  './js/recorder.js',
  './js/qrcode.js',
  './js/i18n.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  // Only handle same-origin GET requests. Cross-origin traffic (signaling
  // WebSocket, STUN/TURN, Google Fonts) is left untouched by the cache.
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;

  // Network-first, cache fallback for static assets.
  e.respondWith(
    fetch(e.request)
      .then(res => {
        const clone = res.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
