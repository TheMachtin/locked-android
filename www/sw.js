// Service Worker — Offline-Fähigkeit und PWA-Installation.
// Netz zuerst, Cache als Rückfall. Microsoft Graph und Login werden nie
// gecacht: veraltete Token oder Daten wären schlimmer als ein Fehler.

const CACHE = 'locked-static-v8';
const PRECACHE = [
  './', './index.html', './css/app.css', './manifest.webmanifest',
  './js/main.js', './js/state.js', './js/platform.js', './js/shortcuts.js',
  './js/core/time.js', './js/core/settings.js', './js/core/calc.js',
  './js/core/legacy.js', './js/core/merge.js', './js/core/migrate.js', './js/core/escalation.js',
  './js/core/command.js',
  './js/sync/auth.js', './js/sync/onedrive.js', './js/sync/files.js', './js/sync/refresh.js',
  './js/ui/format.js', './js/ui/toast.js', './js/ui/charts.js', './js/ui/pull.js',
  './js/ui/eintrag.js', './js/ui/dashboard.js', './js/ui/einstellungen.js', './js/ui/daten.js',
  './vendor/msal-browser.min.js',
  './favicon.png', './icon-192.png', './icon-512.png',
  './icon-192-maskable.png', './icon-512-maskable.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(PRECACHE).catch(err => console.warn('precache partial', err))));
  // Kein skipWaiting() — die App fragt erst.
});

self.addEventListener('message', (e) => { if (e.data === 'skipWaiting') self.skipWaiting(); });

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

function istApi(url) {
  return url.hostname === 'graph.microsoft.com'
      || url.hostname.endsWith('login.microsoftonline.com')
      || url.hostname.endsWith('login.live.com')
      || url.hostname.endsWith('login.microsoft.com')
      || url.hostname === 'api.github.com';
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (istApi(url)) return;
  event.respondWith(
    fetch(req)
      .then(res => {
        if (res && res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(req, clone)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(req).then(c => c || new Response('Offline', { status: 503 }))));
});
