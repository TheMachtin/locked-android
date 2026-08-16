// Service Worker — Offline-fähigkeit + PWA-Install
// - Static Assets werden gecached (Network-first, fallback Cache)
// - Microsoft Graph / Login wird NIE gecached (frische Daten nötig)
// - CDN-Scripts (MSAL, SheetJS) werden mitgecached, damit App offline lädt

const CACHE = 'locked-static-v2';
const PRECACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './favicon.png',
  './icon-192.png',
  './icon-512.png',
  './icon-192-maskable.png',
  './icon-512-maskable.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(PRECACHE).catch(err => console.warn('precache partial', err)))
  );
  // skipWaiting() NICHT automatisch — App fragt User erst
});

self.addEventListener('message', (e) => {
  if (e.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function isApiRequest(url) {
  return url.hostname === 'graph.microsoft.com'
      || url.hostname.endsWith('login.microsoftonline.com')
      || url.hostname.endsWith('login.live.com')
      || url.hostname.endsWith('login.microsoft.com');
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') {
    // POST/PUT immer durchs Netz (Saves zu OneDrive)
    return;
  }
  const url = new URL(req.url);
  if (isApiRequest(url)) {
    // API ungecached
    return;
  }
  // Network-first: frische Version, bei Fehlschlag Cache
  event.respondWith(
    fetch(req)
      .then(res => {
        if (res && res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(req, clone)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(req).then(cached => cached || new Response('Offline', { status: 503, statusText: 'Offline' })))
  );
});
