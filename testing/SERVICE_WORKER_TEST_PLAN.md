# Service Worker Test Plan for Pipeline Notes

## Overview

This document provides a comprehensive test plan for the Pipeline Notes service worker (`/assets/service-worker.js`). The service worker implements an offline-first caching strategy with hash-based cache validation.

---

## Service Worker Behavior Analysis

### Architecture

| Component | Description |
|-----------|-------------|
| **Cache Version** | `pipeline-notes-v2` - Hardcoded cache name |
| **Base File** | `sw-index.html` - Main HTML entry point containing version hashes |
| **Icons** | 5 PWA icons (favicon.ico, icon512.png, icon192.png, maskable_icon.png, maskable_icon_x192.png) |
| **Cacheable Assets** | 21 JS/CSS/JSON files loaded via `/bundle/` endpoint |

### Key Behaviors

1. **Install Phase**: Clears all existing caches, then populates new cache
2. **Fetch Interception**: Handles all non-API requests with custom logic
3. **Hash-based Validation**: Compares `x-hash` headers against expected hashes from sw-index.html
4. **Network Timeout**: All network requests have a 2-second timeout
5. **SPA Routing**: Unmatched URLs serve `sw-index.html` (Single Page App pattern)

---

## Test Categories

### Category A: Installation & Activation

#### A1. Fresh Install
**Purpose**: Verify service worker installs correctly on first visit

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Clear all browser data (cache, SW, etc.) | Clean state |
| 2 | Navigate to app | Page loads successfully |
| 3 | Check DevTools > Application > Service Workers | SW shows as "activated" |
| 4 | Check DevTools > Application > Cache Storage | `pipeline-notes-v2` cache exists |
| 5 | Inspect cache contents | Contains: sw-index.html, 5 icons, 21 assets |

**Edge Cases**:
- A1.1: **Slow network during install** - Verify install completes even with high latency
- A1.2: **Bundle endpoint failure** - If `/bundle/` fails, icons should still be cached individually
- A1.3: **Partial bundle failure** - Some assets in bundle succeed, others fail

#### A2. Cache Version Update
**Purpose**: Verify old caches are cleared when new SW installs

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Install current SW version | Cache `pipeline-notes-v2` created |
| 2 | Manually create cache `pipeline-notes-v1` via DevTools | Old cache exists |
| 3 | Trigger SW update (or modify SW file) | New install event fires |
| 4 | Check Cache Storage | Only `pipeline-notes-v2` exists, `v1` deleted |

**Edge Cases**:
- A2.1: **Multiple old caches** - Create `v0`, `v1`, `test-cache` - all should be deleted
- A2.2: **Cache deletion failure** - Simulate read-only cache scenario

#### A3. Skip Waiting Behavior
**Purpose**: Verify SW activates immediately without waiting

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Open app in two tabs | Both tabs active |
| 2 | Update SW file to trigger new version | New SW in "waiting" state briefly |
| 3 | Observe activation | SW should immediately activate (skipWaiting) |

---

### Category B: Fetch Handling - API Requests

#### B1. API Request Bypass
**Purpose**: Verify `/api/` requests are not intercepted

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Load app with network tab open | App loads |
| 2 | Trigger API call (e.g., sync, get notes) | Request appears in network tab |
| 3 | Check request headers | No SW modification to request |
| 4 | Verify response | Live server response returned |

**Test API Endpoints**:
- `GET /api/status`
- `GET /api/list/<repo>`
- `GET /api/get/<repo>/<note>`
- `PUT /api/put/<repo>/<note>`

**Edge Cases**:
- B1.1: **API request during offline mode** - Should fail naturally (no SW interception)
- B1.2: **API request with query params** - `/api/status?repo=test` - should bypass
- B1.3: **API request with hash** - `/api/status#fragment` - should bypass

#### B2. Chrome Extension Bypass
**Purpose**: Verify `chrome-extension://` requests are ignored

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Install Chrome extension that injects content scripts | Extension active |
| 2 | Load app | No errors in console from SW |
| 3 | Verify extension functionality | Extension works normally |

---

### Category C: Fetch Handling - Base File (sw-index.html)

#### C1. Network-First Strategy for Base File
**Purpose**: Verify sw-index.html uses network-first with cache fallback

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Load app with good network | Page loads from network |
| 2 | Check cache | sw-index.html stored in cache |
| 3 | Go offline | Network disconnected |
| 4 | Refresh page | Page loads from cache |

#### C2. Network Timeout Handling
**Purpose**: Verify 2-second timeout triggers cache fallback

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Enable network throttling (3G or slower) | Slow network active |
| 2 | Clear cache | Fresh state |
| 3 | Load app | Request may timeout |
| 4 | Verify fallback | If network times out (>2s), serve from cache |

**Edge Cases**:
- C2.1: **Exactly 2-second delay** - Test boundary condition
- C2.2: **Network hangs indefinitely** - Should timeout and fallback
- C2.3: **Intermittent network** - Request starts but drops before completion

#### C3. Network Failure with Cache Miss
**Purpose**: Verify behavior when network fails and no cache exists

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Clear all caches | No cached sw-index.html |
| 2 | Go offline | Network unavailable |
| 3 | Attempt to load app | Error thrown (app fails to load) |
| 4 | Check console | Error message: "cache miss '<url>' for file '...' after network failure" |

**Note**: There's a bug in the error message - references `file_to_find` instead of `filepath`.

#### C4. Successful Network Response Updates Cache
**Purpose**: Verify fresh sw-index.html updates cache

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Load app | sw-index.html cached |
| 2 | Modify server to return different content | New version available |
| 3 | Refresh page (online) | New content served from network |
| 4 | Check cache | Cache contains new content |

---

### Category D: Fetch Handling - Static Assets

#### D1. Asset URL Matching
**Purpose**: Verify `urlToCachedFilePath` correctly identifies assets

| Test Case | URL | Expected Mapped File |
|-----------|-----|---------------------|
| D1.1 | `/style.css` | `style.css` |
| D1.2 | `/indexed-fs.js` | `indexed-fs.js` |
| D1.3 | `/icon192.png` | `icon192.png` |
| D1.4 | `/unknown-file.js` | `sw-index.html` (fallback) |
| D1.5 | `/nested/path/style.css` | `style.css` (matches by suffix) |
| D1.6 | `/my-style.css` | `sw-index.html` (no match) |

#### D2. Hash-based Cache Validation
**Purpose**: Verify assets are validated against version hashes

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Load app normally | Assets cached with x-hash headers |
| 2 | Note current hash of `style.css` | Record hash value |
| 3 | Modify `style.css` on server | New version deployed |
| 4 | Update sw-index.html with new hash | Hash comment updated |
| 5 | Refresh page | New style.css fetched (hash mismatch detected) |
| 6 | Verify cache updated | New content and hash stored |

**Edge Cases**:
- D2.1: **Hash comment parsing failure** - Malformed `<!-- VERSIONS: ... -->` comment
- D2.2: **Asset not in hash list** - Asset requested but no hash defined
- D2.3: **Empty hash list** - VERSIONS comment exists but is empty
- D2.4: **Invalid JSON in comment** - VERSIONS contains invalid JSON

#### D3. Cache Hit with Matching Hash
**Purpose**: Verify cached asset served when hash matches

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Load app | Assets cached |
| 2 | Verify sw-index.html hashes match cached x-hash headers | Hashes identical |
| 3 | Refresh page | Assets served from cache (no network request) |
| 4 | Check network tab | No requests for cached assets |

#### D4. Network Fallback on Hash Mismatch
**Purpose**: Verify network fetch when hash differs

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Load app | Assets cached |
| 2 | Modify asset on server without updating sw-index.html hash | Hash now mismatched |
| 3 | Clear browser cache but NOT SW cache | SW has stale asset |
| 4 | Refresh page | SW detects hash mismatch, fetches fresh asset |

#### D5. Offline Asset Serving
**Purpose**: Verify cached assets served when offline

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Load app completely | All assets cached |
| 2 | Go offline | Network disconnected |
| 3 | Hard refresh (Ctrl+F5/Cmd+Shift+R) | App loads from cache |
| 4 | Verify functionality | App works normally (no 404s for assets) |

#### D6. Partial Offline - Some Assets Missing
**Purpose**: Verify behavior when some assets not in cache

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Load app | Full cache populated |
| 2 | Manually delete one asset from cache | e.g., remove `calendar.js` |
| 3 | Go offline | Network disconnected |
| 4 | Refresh page | App attempts to load, fails on missing asset |
| 5 | Check console | Error for cache miss on specific asset |

---

### Category E: Bundle Endpoint Behavior

#### E1. Bundle Fetch During Install
**Purpose**: Verify `/bundle/` endpoint is used correctly

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Monitor network during SW install | Single request to `/bundle/` made |
| 2 | Check URL format | `/bundle/style.css+boolean-state.js+calendar.js+...` |
| 3 | Verify response handling | Each asset stored separately in cache |
| 4 | Check headers | Each cached response has correct `Content-Type` and `x-hash` |

**Edge Cases**:
- E1.1: **Bundle endpoint 404** - Install should continue with icons cached
- E1.2: **Bundle endpoint 500** - Error logged, icons remain cached
- E1.3: **Bundle returns invalid JSON** - Error handled gracefully
- E1.4: **Bundle missing some assets** - Available assets cached

#### E2. Content-Type Detection
**Purpose**: Verify `getContentType` function

| File Extension | Expected Content-Type |
|----------------|---------------------|
| `.js` | `application/javascript` |
| `.css` | `text/css` |
| `.json` | `application/json` |
| `.png` | `text/plain` (fallback) |
| `.html` | `text/plain` (fallback) |

---

### Category F: Hash Utilities

#### F1. SHA-256 Hashing
**Purpose**: Verify `sha256sum` and `hashToString` functions

| Input | Expected Output |
|-------|----------------|
| `"hello"` | Known SHA-256 hash of "hello" |
| `""` (empty) | SHA-256 of empty string |
| Unicode string | Correct UTF-8 encoding then hash |
| Long string (1MB+) | Should not overflow |

**Note**: These functions are defined but primarily used for the `x-hash` header validation flow that was partially replaced by server-side hashing.

---

### Category G: Error Handling & Edge Cases

#### G1. Cache API Failures
**Purpose**: Verify behavior when Cache API throws

| Scenario | Expected Behavior |
|----------|-------------------|
| `caches.open()` throws | Install fails, error logged |
| `cache.match()` throws | Fetch handler continues to network |
| `cache.put()` throws | Network response still returned to page |
| `caches.keys()` throws | Install phase fails |
| `caches.delete()` throws | Install may continue with warning |

#### G2. Response Cloning
**Purpose**: Verify responses are properly cloned before caching

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Load asset | Network request made |
| 2 | Check cache put operation | Uses `.clone()` on response |
| 3 | Verify page receives response | Page loads correctly |
| 4 | Verify cache receives response | Cache stores correctly |

**Failure Case**: Without clone, the response body stream would be consumed by the first consumer.

#### G3. AbortSignal.timeout Compatibility
**Purpose**: Verify timeout mechanism works across browsers

| Browser | Expected Behavior |
|---------|-------------------|
| Chrome 103+ | `AbortSignal.timeout(2000)` works natively |
| Firefox 100+ | `AbortSignal.timeout(2000)` works natively |
| Safari 16.4+ | `AbortSignal.timeout(2000)` works natively |
| Older browsers | May throw error, should fallback to no timeout |

**Note**: The SW uses modern `AbortSignal.timeout()` API without fallback.

#### G4. Logging Behavior
**Purpose**: Verify LOG function filtering

| Message Prefix | Logged? |
|----------------|---------|
| `"RESULT ..."` | ✅ Yes |
| `"handling fetch..."` | ❌ No (filtered) |
| `"CACHED ..."` | ❌ No (filtered) |
| `"failed to cache..."` | ❌ No (filtered) |

**Test**: Override LOG to capture all messages and verify filtering.

---

### Category H: Integration & Real-World Scenarios

#### H1. Full Offline-Online Cycle
**Purpose**: Verify complete offline usage workflow

| Phase | Action | Expected Result |
|-------|--------|-----------------|
| 1. Online Load | Load app with network | Full install, all assets cached |
| 2. Offline Use | Disconnect network, use app | App fully functional |
| 3. Create Content | Add notes while offline | Notes stored locally |
| 4. Reconnect | Restore network | App detects online |
| 5. Sync | Trigger sync | Notes sync to server |

#### H2. Rapid Refresh Scenario
**Purpose**: Verify stability under rapid refreshes

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Load app | Initial load complete |
| 2 | Refresh 5 times rapidly (< 2 seconds each) | No errors, consistent state |
| 3 | Check cache integrity | No duplicate entries |
| 4 | Check console | No race condition errors |

#### H3. Multiple Tabs
**Purpose**: Verify behavior with multiple tabs open

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Open Tab A | App loads |
| 2 | Open Tab B | Shares same SW and cache |
| 3 | Update asset on server | New version available |
| 4 | Refresh Tab A | Gets new version |
| 5 | Refresh Tab B | Gets new version (shared cache) |

#### H4. Service Worker Update Mid-Session
**Purpose**: Verify behavior when SW updates while app is open

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Load app | SW v1 active |
| 2 | Modify SW file (v2) | Browser detects update |
| 3 | Observe | New SW waiting then activates (skipWaiting) |
| 4 | Navigate to new page | Uses SW v2 |
| 5 | Check cache | Cache cleared and repopulated by v2 |

#### H5. Large File Handling
**Purpose**: Verify behavior with large assets

| Test | File Size | Expected Result |
|------|-----------|-----------------|
| Large JS bundle | 5MB+ | Cached successfully |
| Large icon | 1MB+ | Cached successfully |
| Many small files | 100+ files | Bundle endpoint handles efficiently |

---

### Category I: Security Considerations

#### I1. HTTPS Requirement
**Purpose**: Verify SW only works on secure contexts

| Protocol | Expected Behavior |
|----------|-------------------|
| `https://` | SW registers and functions |
| `http://localhost` | SW registers (secure context exception) |
| `http://` (non-localhost) | SW registration fails |

#### I2. Scope Restrictions
**Purpose**: Verify SW scope is respected

| URL Path | Handled by SW? |
|----------|----------------|
| `/` (root) | ✅ Yes |
| `/some/path` | ✅ Yes |
| `/api/...` | ✅ Request seen but bypassed |

**Note**: SW is registered with scope `"/"` covering entire origin.

---

## Known Issues & Bug Tests

### Bug B1: Undefined Variable in Error Message
**Location**: Line 165 and 238
```javascript
throw new Error(`cache miss '${event.request.url}' for file '${file_to_find}' after network failure`);
```
**Issue**: `file_to_find` is undefined (should be `filepath`)

**Test**:
1. Trigger a cache miss after network failure
2. Verify error message contains `undefined` instead of actual filename
3. **Expected**: Error message shows `undefined`
4. **Fix Required**: Change `file_to_find` to `filepath`

---

## Test Implementation Notes

### Manual Testing Tools

Use browser DevTools:
- **Application > Service Workers**: Check registration, update, skip waiting
- **Application > Cache Storage**: Inspect cached entries
- **Network**: Monitor fetch interception
- **Console**: View LOG output (filtered to RESULT only)

### Automated Testing Challenges

1. **Service Worker Registration**: Requires HTTPS or localhost
2. **Cache API Access**: Not directly accessible from page context
3. **Network Control**: Requires tools like Playwright's `context.setOffline(true)`
4. **SW Lifecycle**: `skipWaiting` makes some state transitions hard to catch

### Playwright Test Pattern

```python
# Enable service worker (normally disabled in tests)
context = browser.new_context(service_workers='allow')
page = context.new_page()

# Monitor console for SW messages
page.on("console", lambda msg: print(f"CONSOLE: {msg.text}"))

# Control network
context.set_offline(True)  # Go offline
context.set_offline(False)  # Go online

# Wait for SW to be ready
page.wait_for_function("""
    () => navigator.serviceWorker.ready.then(r => !!r.active)
""")
```

---

## Test Checklist Summary

| Category | Tests | Priority |
|----------|-------|----------|
| A. Installation | 3 + 2 edge cases | 🔴 High |
| B. API Bypass | 4 + 3 edge cases | 🔴 High |
| C. Base File Fetch | 4 + 3 edge cases | 🔴 High |
| D. Asset Fetch | 6 + 4 edge cases | 🔴 High |
| E. Bundle Endpoint | 2 + 4 edge cases | 🟡 Medium |
| F. Hash Utilities | 4 tests | 🟢 Low |
| G. Error Handling | 4 + 3 edge cases | 🔴 High |
| H. Integration | 5 scenarios | 🟡 Medium |
| I. Security | 2 tests | 🟡 Medium |
| **Bug Fixes** | 1 issue | 🔴 High |

---

## Appendix: Asset List

### Icons (5)
- favicon.ico
- icon512.png
- icon192.png
- maskable_icon.png
- maskable_icon_x192.png

### Cacheable Assets (21)
1. style.css
2. boolean-state.js
3. calendar.js
4. components.js
5. date-util.js
6. filedb.js
7. flatdb.js
8. global.js
9. indexed-fs.js
10. parse.js
11. ref.js
12. render.js
13. remote.js
14. rewrite.js
15. state.js
16. status.js
17. sync.js
18. manifest.json
19. install-service-worker.js

---

## Appendix: Version Hash Format

In `sw-index.html`, version hashes are embedded as:
```html
<!-- VERSIONS: {"style.css": "abc123...", "indexed-fs.js": "def456...", ...} -->
```

The SW extracts this via regex:
```javascript
const hashes = sw_index.match(/<!-- VERSIONS: (.*) -->/);
const asset_hashes = JSON.parse(hashes[1]);
```
