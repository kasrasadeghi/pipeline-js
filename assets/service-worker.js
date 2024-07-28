const CACHE_VERSION = 'pipeline-notes-v2';
const baseFile = 'sw-index.html';
const icons = [
  "favicon.ico",
  "icon512.png",
  "maskable_icon.png",
  "maskable_icon_x192.png",
];

const cacheable_assets = [
  "style.css",
  "boolean-state.js",
  "filedb.js",
  "flatdb.js",
  "indexed-fs.js",
  "parse.js",
  "rewrite.js",
  "state.js",
  'manifest.json',
];

function LOG(...data) {
  console.log('SERVICE WORKER', ...data);
}

async function sha256sum(input_string) {
  const encoder = new TextEncoder('utf-8');
  const bytes = encoder.encode(input_string);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  let result = hashToString(hash);
  return result;
}

async function hashToString(arraybuffer) {
  const bytes = new Uint8Array(arraybuffer);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function fillServiceWorkerCache() {
  const cache = await caches.open(CACHE_VERSION);
  
  // Cache the base file and icons
  for (let asset of [baseFile, ...icons]) {
    LOG(asset);
    try {
      await cache.add(asset);
      LOG('CACHED', asset);
    } catch (e) {
      LOG('failed to cache', asset, e);
    }
  }

  // Fetch all cacheable assets in one request
  try {
    const response = await fetch('/bundle/' + cacheable_assets.join('+'));
    if (!response.ok) {
      throw new Error(`Failed to fetch bundle: ${response.status} ${response.statusText}`);
    }
    const bundle = await response.json();
    LOG('retrieved bundle of', cacheable_assets);
    
    for (let [asset, content] of Object.entries(bundle)) {
      await cache.put(asset, new Response(content, {
        headers: { 'Content-Type': getContentType(asset) }
      }));
    }
  } catch (e) {
    LOG('failed to cache bundle', e);
  }
}

function getContentType(filename) {
  if (filename.endsWith('.js')) return 'application/javascript';
  if (filename.endsWith('.css')) return 'text/css';
  if (filename.endsWith('.json')) return 'application/json';
  return 'text/plain';
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

        const is_asset = [...cacheable_assets, ...icons].some((asset) => event.request.url.endsWith(asset));

        try {
          const sw_index = await cache.match(baseFile).then((response) => response.text());
          const hashes = sw_index.match(/<!-- VERSIONS: (.*) -->/);
          const asset_hashes = JSON.parse(hashes[1]);
          LOG('asset hashes:', asset_hashes);

          let found_asset = cacheable_assets.find((asset) => event.request.url.endsWith(asset));
          if (found_asset !== undefined) {
            const asset_hash = asset_hashes[found_asset];
            if (asset_hash) {
              const response = await cache.match(event.request.url);
              if (response) {
                const cached_hash = await sha256sum(await response.clone().text());
                if (cached_hash !== asset_hash) {
                  LOG('found asset in cache, but hash does not match, fetching:', event.request.url, 'conflicting hashes were', cached_hash, asset_hash);
                  // TODO should fetch the whole bundle and update the cache
                  // - probably should only do this when we fetch a new sw-index / baseFile
                } else {
                  LOG('found asset in cache, no need to fetch:', event.request.url);
                  return response;
                }
              }
            }
          }

        } catch (e) {
          LOG('error', e);
        }

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
              // this should only be things like /disc/, /edit/, etc.
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
