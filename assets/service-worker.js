const CACHE_VERSION = 'pipeline-notes-v1';
const baseFile = 'sw-index.html';
const assets = [
  "favicon.ico",
  "icon512.png",
  "maskable_icon.png",
  "maskable_icon_x192.png",

  'manifest.json',
  'style.css',
  'boolean-state.js',
  'filedb.js',
  'flatdb.js',
  'indexed-fs.js',
  'parse.js',
  'rewrite.js',
  'state.js',
];

function LOG(...data) {
  console.log('SERVICE WORKER', ...data);
}

async function fillServiceWorkerCache() {
  const cache = await caches.open(CACHE_VERSION);
  for (let asset of [baseFile, ...assets]) {
    LOG(asset);
    try {
      await cache.add(asset);
      LOG('CACHED', asset);
    } catch (e) {
      LOG('failed to cache', asset, e);
    }
  }
}

// Install event
self.addEventListener('install', (event) => {
  event.waitUntil(
    fillServiceWorkerCache().then(() => self.skipWaiting())
  );
});

// the service worker fails on /api/ subpaths and
// returns either a cached file if it exists
//         or just index.html if it doesn't
self.addEventListener('fetch', (event) => {
  LOG('handling fetch request', event.request.url);

  if (event.request.url.includes('/api/')) {
    return; // don't use the cache for /api/ subpaths
  } else if (event.request.url.startsWith('chrome-extension://')) {
    return; // don't cache chrome extension requests
  } else {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_VERSION);

        const is_asset = assets.some((asset) => event.request.url.endsWith(asset));
        LOG(`${event.request.url}: is_asset: ${is_asset}`)

        // fetch
        try {
          LOG(`attempting fetch ${event.request.url}`);
          const fetchedResponse = await fetch(event.request, { signal: AbortSignal.timeout(2000) }); // 2 second timeout
          if (!fetchedResponse.ok) {
            throw new Error(`response status is not ok: ${fetchedResponse.status} ${fetchedResponse.statusText}`);
          } else {
            LOG(`fetch succeeded! ${event.request.url}`)
            if (is_asset) {
              cache.put(event.request.url, fetchedResponse.clone());
            } else {
              cache.put(baseFile, fetchedResponse.clone());
            }
            return fetchedResponse;
          }

        // use cache if fetch fails
        } catch (e) {
          LOG("network failed, loading from cache:", event.request.url, e);
          // fetch timeout and other errors
          let cachedResponse = null;
          let file_to_find = null;
          if (is_asset) {
            cachedResponse = await cache.match(event.request.url);
            file_to_find = event.request.url;
          } else {
            cachedResponse = await cache.match(baseFile);
            file_to_find = baseFile;
          }
          if (cachedResponse) {
            LOG(`found in cache! ${event.request.url} -> ${file_to_find} (${cachedResponse.headers.get("content-length")} bytes)`);
            return cachedResponse;
          }
          throw new Error(`cache miss '${event.request.url}' for file '${file_to_find}' after network failure`);
        }
      })()
    );
  }
});
