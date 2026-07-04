/** Pipeline Service Worker - Configurable offline-first caching */

// Hardcoded endpoint for index with version hashes
const INDEX_PATH = 'sw-index.html';

// User-configurable values
const CONFIG = {
  "cache_name": "pipeline-notes-v2",
  "assets_dir": "assets",
  "index_path": "assets/index.html",
  "bypass_patterns": ["/api/", "chrome-extension://"],
  "assets": ["boolean-state.js", "calendar.js", "components.js", "date-util.js", "favicon.ico", "filedb.js", "flatdb.js", "global.js", "icon16.png", "icon192.png", "icon512.png", "index.html", "indexed-fs.js", "install-service-worker.js", "manifest.json", "maskable_icon.png", "maskable_icon_x192.png", "maskable_icon_x512.png", "parse.js", "ref.js", "remote.js", "render.js", "rewrite.js", "sanitize.js", "service-worker.js", "state.js", "status.js", "style.css", "sync.js"],
  "bundle_endpoint": "/bundle/",
  "network_timeout": 2000,
  "log_level": "results"
};

function log(...data) {
  if (CONFIG.log_level === 'none') return;
  if (CONFIG.log_level === 'results' && 
      !data.map(x => `${x}`).join(' ').startsWith('RESULT')) return;
  console.log('SW', ...data);
}

function getContentType(filename) {
  if (filename.endsWith('.js')) return 'application/javascript';
  if (filename.endsWith('.css')) return 'text/css';
  if (filename.endsWith('.json')) return 'application/json';
  if (filename.endsWith('.png')) return 'image/png';
  if (filename.endsWith('.ico')) return 'image/x-icon';
  return 'text/plain';
}

function shouldBypass(request) {
  const url = request.url;
  return CONFIG.bypass_patterns.some(pattern => {
    if (typeof pattern === 'string') return url.includes(pattern);
    if (pattern instanceof RegExp) return pattern.test(url);
    return false;
  });
}

function urlToFilePath(url) {
  const asset = CONFIG.assets.find(a => url.endsWith(a));
  return asset || INDEX_PATH;
}

async function fillCache() {
  const keys = await caches.keys();
  for (const key of keys) {
    if (key !== CONFIG.cache_name) await caches.delete(key);
  }

  const cache = await caches.open(CONFIG.cache_name);

  try {
    await cache.add(INDEX_PATH);
    log('CACHED', INDEX_PATH);
  } catch (e) {
    log('failed to cache', INDEX_PATH, e.message);
  }

  if (CONFIG.assets.length === 0) return;

  try {
    const response = await fetch(CONFIG.bundle_endpoint + CONFIG.assets.join('+'));
    if (!response.ok) throw new Error(`Bundle fetch failed: ${response.status}`);
    
    const bundle = await response.json();
    for (const [asset, obj] of Object.entries(bundle)) {
      const headers = { 'Content-Type': getContentType(asset) };
      if (obj.hash) headers['x-hash'] = obj.hash;
      
      // Decode content (base64 or plain text)
      let content = obj.content;
      if (obj.encoding === 'base64') {
        content = Uint8Array.from(atob(obj.content), c => c.charCodeAt(0));
      }
      
      await cache.put(asset, new Response(content, { headers }));
    }
  } catch (e) {
    log('bundle failed', e.message);
  }
}

async function getAssetHash(filepath, cache) {
  try {
    const baseResponse = await cache.match(INDEX_PATH);
    if (!baseResponse) return null;
    
    const html = await baseResponse.text();
    const match = html.match(/<!-- VERSIONS: (.*) -->/);
    if (!match) return null;
    
    const hashes = JSON.parse(match[1]);
    return hashes[filepath];
  } catch (e) {
    return null;
  }
}

async function networkFirst(request, cache, cacheKey) {
  try {
    const response = await fetch(request, { 
      signal: AbortSignal.timeout(CONFIG.network_timeout) 
    });
    if (response.ok) {
      cache.put(cacheKey, response.clone());
      log('RESULT fetch succeeded!', request.url);
      return response;
    }
    throw new Error(`HTTP ${response.status}`);
  } catch (e) {
    const cached = await cache.match(cacheKey);
    if (cached) {
      log('RESULT network failed, cache hit', request.url);
      return cached;
    }
    throw new Error(`Cache miss after network failure: ${request.url}`);
  }
}

async function cacheFirstWithValidation(request, cache, filepath) {
  const expectedHash = await getAssetHash(filepath, cache);
  const cached = await cache.match(request.url);

  if (cached && expectedHash) {
    const cachedHash = cached.headers.get('x-hash');
    if (cachedHash === expectedHash) {
      log('RESULT cache hit', request.url);
      return cached;
    }
    log('hash mismatch, fetching:', filepath);
  }

  return networkFirst(request, cache, request.url);
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    fillCache().then(() => self.skipWaiting())
  );
});

self.addEventListener('fetch', (event) => {
  if (shouldBypass(event.request)) return;

  event.respondWith((async () => {
    try {
      const cache = await caches.open(CONFIG.cache_name);
      const filepath = urlToFilePath(event.request.url);

      if (filepath === INDEX_PATH) {
        return await networkFirst(event.request, cache, INDEX_PATH);
      }

      return await cacheFirstWithValidation(event.request, cache, filepath);
    } catch (e) {
      log('Unhandled error in fetch handler:', e.message);
      return new Response('Service Worker Error: ' + e.message, { 
        status: 503, 
        statusText: 'Service Unavailable' 
      });
    }
  })());
});
