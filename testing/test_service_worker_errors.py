#!/usr/bin/env python3
"""
Test Service Worker error handling and exception propagation
"""

import sys
import time
from playwright.sync_api import sync_playwright, Playwright
from browser_test_base import SyncBrowserTest
from test_util import get_pipeline_url


class ErrorHandlingTest(SyncBrowserTest):
    """Test error handling in Service Worker"""
    
    def __init__(self):
        super().__init__(port=8100, headless=True, timeout=15000)
        self.errors = []
    
    def get_page_init_script(self):
        return ""
    
    def setup_browser_sync(self, playwright: Playwright):
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
        
        # Capture console and errors
        self.page.on("console", lambda msg: self._handle_console(msg))
        self.page.on("pageerror", lambda err: self._handle_error(err))
        
        return self.browser, self.page
    
    def _handle_console(self, msg):
        if msg.type == 'error':
            self.errors.append(msg.text)
    
    def _handle_error(self, err):
        self.errors.append(str(err))
    
    def clear_cache_and_reload(self):
        """Clear cache and reload page"""
        self.page.evaluate("""
            async () => {
                const keys = await caches.keys();
                for (const key of keys) await caches.delete(key);
            }
        """)
        self.page.reload(wait_until="networkidle")
        time.sleep(2)
    
    def run_test(self, playwright: Playwright):
        print("\n" + "="*60)
        print("TEST SUITE: Error Handling & Exception Propagation")
        print("="*60)
        
        tests_passed = 0
        tests_total = 0
        
        # Setup
        self.page.goto(get_pipeline_url(), wait_until="networkidle")
        time.sleep(3)
        
        # Test 1: Page loads even when cache is empty (network fetch)
        tests_total += 1
        print("\n[Test 1] Page loads with empty cache (network fetch)")
        try:
            self.clear_cache_and_reload()
            
            # Page should still load via network
            content = self.page.content()
            assert len(content) > 500, "Page should have content"
            print("   ✅ Page loaded from network when cache empty")
            tests_passed += 1
        except Exception as e:
            print(f"   ❌ Failed: {e}")
        
        # Test 2: Page loads from cache after network failure
        tests_total += 1
        print("\n[Test 2] Page loads from cache after network failure")
        try:
            # First populate cache
            self.page.reload(wait_until="networkidle")
            time.sleep(2)
            
            # Go offline
            self.context.set_offline(True)
            
            # Clear errors
            self.errors.clear()
            
            # Reload - should use cache
            self.page.reload(wait_until="domcontentloaded")
            time.sleep(1)
            
            content = self.page.content()
            assert len(content) > 500, "Page should have content from cache"
            
            # Check no unhandled errors
            sw_errors = [e for e in self.errors if 'service worker' in e.lower()]
            if sw_errors:
                print(f"   ⚠️  SW errors: {sw_errors}")
            
            print("   ✅ Page loaded from cache when offline")
            tests_passed += 1
            
        except Exception as e:
            print(f"   ❌ Failed: {e}")
        finally:
            self.context.set_offline(False)
        
        # Test 3: SW doesn't crash on invalid asset requests
        tests_total += 1
        print("\n[Test 3] SW handles invalid asset requests gracefully")
        try:
            self.errors.clear()
            
            # Try to fetch a non-existent asset
            result = self.page.evaluate("""
                async () => {
                    try {
                        const response = await fetch('/non-existent-asset.js');
                        return { status: response.status, ok: response.ok };
                    } catch (e) {
                        return { error: e.message };
                    }
                }
            """)
            
            # Should either return 404 or an error (not crash)
            print(f"   Response: {result}")
            
            # Check no SW crash errors in console
            sw_crash = [e for e in self.errors if 'uncaught' in e.lower() or 'unhandled' in e.lower()]
            if sw_crash:
                print(f"   ❌ SW crash detected: {sw_crash}")
            else:
                print("   ✅ No SW crash errors")
                tests_passed += 1
                
        except Exception as e:
            print(f"   ❌ Failed: {e}")
        
        print("\n" + "-"*60)
        print(f"Results: {tests_passed}/{tests_total} tests passed")
        print("-"*60)
        
        return tests_passed == tests_total


def main():
    test = ErrorHandlingTest()
    success = test.run()
    return 0 if success else 1


if __name__ == "__main__":
    import sys
    sys.exit(main())
