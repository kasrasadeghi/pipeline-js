// Install event
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open('pipeline-service-worker-cache').then((cache) => {
      return cache.addAll([
        '/index.html',
        '/style.css',
        '/indexed-fs.js',
      ]);
    })
  );
});

// the service worker fails on /api/ subpaths and
// returns either a cached file if it exists
//         or just index.html if it doesn't
self.addEventListener('fetch', (event) => {
  if (event.request.url.includes('/api/')) {
    event.respondWith(new Response('Failure', { status: 500, statusText: 'Internal Server Error' }));
  } else {
    event.respondWith(
      caches.match(event.request).then((response) => {
        return fetch(event.request).catch(() => response);
      }).catch(() => {
        return caches.match('index.html');
      })
    );
  }
});
