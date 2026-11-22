/*
 * Service Worker Sunnet: приложение открывается даже без сети (оболочка из кэша).
 * Безопасность: ответы API и медиа НИКОГДА не кэшируются здесь — личные данные
 * не оседают в общем кэше устройства.
 */
const VERSION = 'omni-v5';
const SHELL = ['/', '/manifest.webmanifest', '/icons/icon.svg', '/icons/icon-192.png', '/theme-init.js'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return; // API и медиа — только из сети

  // Навигация: сеть, при офлайне — оболочка из кэша
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          // В кэш — только настоящая страница (не 502 «сервер просыпается»)
          if (res.ok && (res.headers.get('content-type') || '').includes('text/html')) {
            const copy = res.clone();
            caches.open(VERSION).then((c) => c.put('/', copy));
          }
          return res;
        })
        .catch(() => caches.match('/')),
    );
    return;
  }

  // Статика с хэшем в имени — cache-first
  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/')) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            const type = res.headers.get('content-type') || '';
            if (res.ok && !type.includes('text/html')) {
              const copy = res.clone();
              caches.open(VERSION).then((c) => c.put(req, copy));
            }
            return res;
          }),
      ),
    );
  }
});
