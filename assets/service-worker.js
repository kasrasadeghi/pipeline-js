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
  "calendar.js",
  "components.js",
  "date-util.js",
  "filedb.js",
  "flatdb.js",
  "global.js",
  "indexed-fs.js",
  "parse.js",
  "remote.js",
  "rewrite.js",
  "state.js",
  "status.js",
  "sync.js",
  'manifest.json',
];

// Strategy: we fetch-fallback the basefile, but then cache-fallback the assets.
// This speeds up loading every file that's up-to-date, which basically every file should be for all users, after the first load.
// The first load also bundles the assets, so there aren't even that many network requests to become up-to-date.
// If the cache-fallback fails, then we'll fetch-fallback the asset again.  This may actually never happen.

function LOG(...data) {
  // ignore nonresults
  if (! data.map(x => `${x}`).join(" ").startsWith("RESULT")) {
    return;
  }
  
  console.log('SERVICE WORKER', ...data);
}

async function fillServiceWorkerCache() {
  // delete contents of all caches
  const keys = await caches.keys();
  for (let key of keys) {
    await caches.delete(key);
  }

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
    
    for (let [asset, obj] of Object.entries(bundle)) {
      await cache.put(asset, new Response(obj.content, {
        url: self.location.origin + asset,
        headers: { 'Content-Type': getContentType(asset), "x-hash": obj.hash },
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

function urlToCachedFilePath(url) {
  const asset = [...cacheable_assets, ...icons].find((asset) => url.endsWith(asset));
  if (asset) {
    return asset;
  }
  return baseFile;
}

function headersToObj(headers) {
  return Array.from(headers.entries()).reduce((acc, [key, value]) => {
    acc[key] = value;
    return acc;
  });
}

async function fetchWithFallbackToCache(request, cache) {
  // fetch
  try {
    LOG(`attempting fetch ${request.url}`);
    const fetchedResponse = await fetch(request, { signal: AbortSignal.timeout(2000) }); // 2 second timeout
    if (!fetchedResponse.ok) {
      throw new Error(`response status is not ok: ${fetchedResponse.status} ${fetchedResponse.statusText}`);
    } else {
      LOG(`RESULT fetch succeeded! ${request.url}`, "cache keys", await cache.keys(), fetchedResponse, headersToObj(fetchedResponse.headers));
      cache.put(request.url, fetchedResponse.clone());
      return fetchedResponse;
    }

  // use cache if fetch fails
  } catch (e) {
    LOG("network failed, loading from cache:", request.url, e);
    // fetch timeout and other errors
    let cachedResponse = await cache.match(request.url);
    if (cachedResponse) {
      LOG(`RESULT network failed, but found in cache! ${request.url} (${cachedResponse.headers.get("Content-Length")} bytes)`);
      return cachedResponse;
    }
    throw new Error(`cache miss '${request.url}' for file '${request.url}' after network failure`);
  }
}

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
        let filepath = urlToCachedFilePath(event.request.url);

        if (filepath === baseFile) {
          return fetchWithFallbackToCache(event.request, cache);
        }

        LOG(`checking cache for asset ${event.request.url} -> ${filepath}`);

        let asset_cache_log = [];
        try {
          // The baseFile contains a list of asset hashes, and is used as the reference point
          // to detect whether the other assets are stale or up-to-date.

          const sw_index = await cache.match(baseFile).then((response) => response.text());
          asset_cache_log.push(['sw_index:', sw_index]);
          const hashes = sw_index.match(/<!-- VERSIONS: (.*) -->/);
          asset_cache_log.push(['hashes:', hashes]);
          const asset_hashes = JSON.parse(hashes[1]);
          asset_cache_log.push(['asset_hashes:', asset_hashes]);

          const asset_hash = asset_hashes[filepath];
          
          if (asset_hash) {
            const response = await cache.match(event.request.url);
            if (response) {
              LOG("found cached response for filepath with version hash in index.html", filepath, response, headersToObj(response.headers));
              // the x-hash is now run on the server and stored in every request, mostly because hashing the images in javascript doesn't work
              // - for some reason, png requests don't have a .bytes() method, and the .text() method doesn't return the same hash as the server
              const cached_hash = response.headers.get('x-hash');
              // theoretically, we can just assume that contents of the cache are correct as long as we fetch a bundle every time the version hashes in the index.html changes, and then just do edge-detection for the versions changing
              // - comparing hashes allows us to have a little more certainty that what we've cached actually matches the index.html on the server, but i need to think through this a bit more to make sure it's actually necessary, or even correct.

              if (cached_hash !== asset_hash) {
                asset_cache_log.push(['found asset in cache, but hash does not match, fetching:', event.request.url, 'conflicting hashes were', cached_hash, asset_hash]);
                // TODO should fetch the whole bundle and update the cache
                // - probably should only do this when we fetch a new sw-index / baseFile
              } else {
                LOG('RESULT found asset in cache, no need to fetch:', event.request.url);
                return response;
              }
            }
          } else {
            LOG('asset hash not found in hashes, fetching:', event.request.url, asset_cache_log);
          }

        } catch (e) {
          LOG('error', e, asset_cache_log);
        }

        LOG(`asset not cached, loading ${event.request.url} -> ${filepath}`, asset_cache_log);

        fetchWithFallbackToCache(event.request, cache);
      })()
    );
  }
});
