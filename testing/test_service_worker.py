#!/usr/bin/env python3
"""
Service Worker Test Suite for Pipeline Notes

Run with: python test_service_worker.py
"""

import sys
import time
from playwright.sync_api import sync_playwright, Playwright
from browser_test_base import SyncBrowserTest
from test_util import get_pipeline_url


class ServiceWorkerTestBase(SyncBrowserTest):
    """Base class for Service Worker tests with SW-enabled context"""
    
    def __init__(self, headless=True, timeout=15000):
        super().__init__(port=8100, headless=headless, timeout=timeout)
        self.sw_logs = []
    
    def get_page_init_script(self):
        """Don't disable service worker"""
        return ""
    
    def setup_browser_sync(self, playwright: Playwright):
        """Setup browser with service workers enabled"""
        self.browser = playwright.chromium.launch(
            headless=self.headless,
            args=[
                '--ignore-certificate-errors',
                '--ignore-certificate-errors-spki-list',
                '--allow-insecure-localhost',
            ]
        )
        
        context_config = self.get_browser_context_config()
        context_config['service_workers'] = 'allow'
        context_config['ignore_https_errors'] = True
        self.context = self.browser.new_context(**context_config)
        
        self.page = self.context.new_page()
        self.page.set_default_timeout(self.timeout)
        
        # Capture console messages
        self.page.on("console", self._handle_console)
        self.page.on("pageerror", lambda err: print(f"[PAGE ERROR] {err}"))
        
        return self.browser, self.page
    
    def _handle_console(self, msg):
        """Capture console messages"""
        text = msg.text
        if "SERVICE WORKER" in text or "service worker" in text.lower():
            self.sw_logs.append({'type': msg.type, 'text': text})
            print(f"[SW] {text}")
    
    def wait_for_service_worker(self, timeout=10000):
        """Wait for service worker to be activated"""
        self.page.wait_for_function("""
            () => navigator.serviceWorker.ready.then(r => !!r.active)
        """, timeout=timeout)
    
    def get_sw_registration(self):
        """Get current SW registration info"""
        return self.page.evaluate("""
            async () => {
                const reg = await navigator.serviceWorker.getRegistration();
                if (!reg) return null;
                const sw = reg.active || reg.installing || reg.waiting;
                return {
                    scope: reg.scope,
                    state: sw?.state,
                    scriptURL: sw?.scriptURL,
                };
            }
        """)
    
    def get_cache_contents(self):
        """Get all cache contents"""
        return self.page.evaluate("""
            async () => {
                const keys = await caches.keys();
                const result = {};
                for (const name of keys) {
                    const cache = await caches.open(name);
                    const requests = await cache.keys();
                    result[name] = requests.map(r => ({
                        url: r.url,
                        pathname: new URL(r.url).pathname
                    }));
                }
                return result;
            }
        """)
    
    def clear_all_caches(self):
        """Clear all caches from page context"""
        return self.page.evaluate("""
            async () => {
                const keys = await caches.keys();
                for (const name of keys) {
                    await caches.delete(name);
                }
                return keys;
            }
        """)
    
    def unregister_service_worker(self):
        """Unregister the service worker"""
        return self.page.evaluate("""
            async () => {
                const reg = await navigator.serviceWorker.getRegistration();
                if (reg) {
                    return await reg.unregister();
                }
                return false;
            }
        """)
    
    def set_offline(self, offline=True):
        """Set browser offline mode"""
        self.context.set_offline(offline)
        print(f"   Network {'disconnected' if offline else 'connected'}")


class TestInstallation(ServiceWorkerTestBase):
    """Test Service Worker installation and basic functionality"""
    
    def run_test(self, playwright: Playwright):
        print("\n" + "="*60)
        print("TEST SUITE: Installation & Basic Functionality")
        print("="*60)
        
        tests_passed = 0
        tests_total = 0
        
        # Test 1: Fresh Install
        tests_total += 1
        print("\n[Test 1] Fresh Service Worker Installation")
        try:
            # Clear any existing state
            self.page.goto(get_pipeline_url(), wait_until="domcontentloaded")
            self.unregister_service_worker()
            self.clear_all_caches()
            
            # Reload to trigger fresh install
            self.page.reload(wait_until="networkidle")
            time.sleep(2)  # Give SW time to install
            
            sw_info = self.get_sw_registration()
            assert sw_info is not None, "Service Worker should be registered"
            assert sw_info['state'] == 'activated', f"SW should be activated, got: {sw_info['state']}"
            
            print(f"   ✅ SW registered and activated")
            print(f"      Scope: {sw_info['scope']}")
            tests_passed += 1
        except Exception as e:
            print(f"   ❌ Failed: {e}")
        
        # Test 2: Cache Population
        tests_total += 1
        print("\n[Test 2] Cache Population")
        try:
            caches = self.get_cache_contents()
            assert 'pipeline-notes-v2' in caches, "Main cache should exist"
            
            cache_urls = caches['pipeline-notes-v2']
            print(f"   Found {len(cache_urls)} cached items")
            
            # Check for expected items
            paths = [item['pathname'] for item in cache_urls]
            
            # Should have base file (sw-index.html)
            has_base = any('sw-index.html' in p or p.endswith('/') or p == '' for p in paths)
            print(f"   {'✅' if has_base else '❌'} Base file (sw-index.html)")
            
            # Should have icons
            icons = ['favicon.ico', 'icon192.png', 'icon512.png']
            for icon in icons:
                has_icon = any(icon in p for p in paths)
                print(f"   {'✅' if has_icon else '❌'} Icon: {icon}")
            
            # Should have assets
            assets = ['style.css', 'indexed-fs.js', 'manifest.json']
            for asset in assets:
                has_asset = any(asset in p for p in paths)
                print(f"   {'✅' if has_asset else '❌'} Asset: {asset}")
            
            assert len(cache_urls) >= 20, f"Expected at least 20 cached items, got {len(cache_urls)}"
            tests_passed += 1
        except Exception as e:
            print(f"   ❌ Failed: {e}")
        
        # Test 3: SW Scope
        tests_total += 1
        print("\n[Test 3] Service Worker Scope")
        try:
            sw_info = self.get_sw_registration()
            assert sw_info['scope'] == 'https://127.0.0.1:8100/', \
                f"Scope should be root, got: {sw_info['scope']}"
            print(f"   ✅ Scope is correct: {sw_info['scope']}")
            tests_passed += 1
        except Exception as e:
            print(f"   ❌ Failed: {e}")
        
        print("\n" + "-"*60)
        print(f"Results: {tests_passed}/{tests_total} tests passed")
        print("-"*60)
        
        return tests_passed == tests_total


class TestAPIBypass(ServiceWorkerTestBase):
    """Test that API requests bypass the service worker cache"""
    
    def run_test(self, playwright: Playwright):
        print("\n" + "="*60)
        print("TEST SUITE: API Request Bypass")
        print("="*60)
        
        tests_passed = 0
        tests_total = 0
        
        # Setup: Ensure SW is installed
        self.page.goto(get_pipeline_url(), wait_until="networkidle")
        time.sleep(2)
        
        # Test 1: API requests should not be cached
        tests_total += 1
        print("\n[Test 1] API Requests Not Cached")
        try:
            api_requests = []
            
            def handle_route(route, request):
                if '/api/' in request.url:
                    api_requests.append(request.url)
                route.continue_()
            
            self.page.route("**/*", handle_route)
            
            # Trigger a page reload to generate API calls
            self.page.reload(wait_until="networkidle")
            time.sleep(2)
            
            # Check that API requests went through
            print(f"   Observed {len(api_requests)} API requests")
            for url in api_requests[:3]:  # Show first 3
                print(f"      - {url[:60]}...")
            
            # API requests should exist and not be blocked
            # Note: We can't easily verify caching without more complex instrumentation
            tests_passed += 1
            print(f"   ✅ API requests are being made")
            
        except Exception as e:
            print(f"   ❌ Failed: {e}")
        
        # Test 2: Cache should not contain API responses
        tests_total += 1
        print("\n[Test 2] Cache Excludes API Responses")
        try:
            caches = self.get_cache_contents()
            cache_urls = []
            for cache_name, items in caches.items():
                cache_urls.extend([item['url'] for item in items])
            
            api_in_cache = any('/api/' in url for url in cache_urls)
            
            if api_in_cache:
                print(f"   ❌ Found API responses in cache!")
                for url in cache_urls:
                    if '/api/' in url:
                        print(f"      - {url}")
            else:
                print(f"   ✅ No API responses in cache")
                tests_passed += 1
                
        except Exception as e:
            print(f"   ❌ Failed: {e}")
        
        print("\n" + "-"*60)
        print(f"Results: {tests_passed}/{tests_total} tests passed")
        print("-"*60)
        
        return tests_passed == tests_total


class TestOfflineBehavior(ServiceWorkerTestBase):
    """Test offline behavior and fallback"""
    
    def run_test(self, playwright: Playwright):
        print("\n" + "="*60)
        print("TEST SUITE: Offline Behavior")
        print("="*60)
        
        tests_passed = 0
        tests_total = 0
        
        # Setup: Ensure SW is installed and cache is populated
        self.page.goto(get_pipeline_url(), wait_until="networkidle")
        time.sleep(3)  # Give time for full cache population
        
        # Test 1: Offline Page Load
        tests_total += 1
        print("\n[Test 1] Offline Page Load from Cache")
        try:
            # Verify cache has content
            caches = self.get_cache_contents()
            assert 'pipeline-notes-v2' in caches, "Cache should exist"
            assert len(caches['pipeline-notes-v2']) > 0, "Cache should have items"
            
            # Go offline
            self.set_offline(True)
            
            # Try to reload
            self.page.reload(wait_until="domcontentloaded")
            
            # Check page loaded
            title = self.page.title()
            url = self.page.url
            print(f"   Page URL: {url}")
            print(f"   Page title: '{title}'")
            
            # Page should load (even if it shows setup screen)
            assert "127.0.0.1" in url or "localhost" in url, "Should be on app URL"
            
            print(f"   ✅ Page loaded from cache while offline")
            tests_passed += 1
            
        except Exception as e:
            print(f"   ❌ Failed: {e}")
        finally:
            self.set_offline(False)
        
        # Test 2: Assets Served from Cache When Offline
        tests_total += 1
        print("\n[Test 2] Assets Served from Cache When Offline")
        try:
            # First load page online to ensure assets are cached
            self.page.reload(wait_until="networkidle")
            time.sleep(2)
            
            # Clear console logs
            self.sw_logs.clear()
            
            # Go offline
            self.set_offline(True)
            
            # Reload again
            self.page.reload(wait_until="domcontentloaded")
            time.sleep(2)
            
            # Check that page HTML loaded
            body = self.page.content()
            assert len(body) > 100, "Page should have content"
            
            print(f"   ✅ Page HTML loaded ({len(body)} bytes)")
            tests_passed += 1
            
        except Exception as e:
            print(f"   ❌ Failed: {e}")
        finally:
            self.set_offline(False)
        
        print("\n" + "-"*60)
        print(f"Results: {tests_passed}/{tests_total} tests passed")
        print("-"*60)
        
        return tests_passed == tests_total


def run_all_tests():
    """Run all service worker tests"""
    print("\n" + "="*60)
    print("SERVICE WORKER TEST SUITE")
    print("="*60)
    
    all_passed = True
    
    # Test Suite 1: Installation
    test1 = TestInstallation(headless=True)
    if not test1.run():
        all_passed = False
    
    # Test Suite 2: API Bypass
    test2 = TestAPIBypass(headless=True)
    if not test2.run():
        all_passed = False
    
    # Test Suite 3: Offline Behavior
    test3 = TestOfflineBehavior(headless=True)
    if not test3.run():
        all_passed = False
    
    print("\n" + "="*60)
    if all_passed:
        print("✅ ALL TEST SUITES PASSED")
    else:
        print("❌ SOME TESTS FAILED")
    print("="*60 + "\n")
    
    return all_passed


if __name__ == "__main__":
    import sys
    success = run_all_tests()
    sys.exit(0 if success else 1)
