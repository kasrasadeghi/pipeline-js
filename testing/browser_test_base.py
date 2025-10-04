#!/usr/bin/env python3
"""
Base class for browser-based testing with common functionality.
Provides shared utilities for Playwright-based tests.
"""

import asyncio
import argparse
import sys
from playwright.async_api import async_playwright
from playwright.sync_api import sync_playwright, Playwright
from test_util import get_pipeline_url, Server

class BrowserTestBase:
    """Base class for browser-based tests with common functionality"""
    
    def __init__(self, port=8100, headless=True, timeout=10000):
        self.port = port
        self.headless = headless
        self.timeout = timeout
        self.server = None
        self.browser = None
        self.context = None
        self.page = None
    
    def setup_server(self):
        """Set up and start the test server"""
        self.server = Server(self.port)
        self.server.create_folders()
        self.server.run()
        
        if not self.server.check():
            raise RuntimeError("Server failed to start or is not responding")
        
        return self.server
    
    def teardown_server(self):
        """Stop the test server"""
        if self.server:
            self.server.terminate()
            self.server = None
    
    def get_browser_context_config(self):
        """Get common browser context configuration"""
        return {
            'ignore_https_errors': True,
            'bypass_csp': True,
            'extra_http_headers': {
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5',
                'Accept-Encoding': 'gzip, deflate',
                'Connection': 'keep-alive',
            }
        }
    
    def get_page_init_script(self):
        """Get common page initialization script"""
        return """
            Object.defineProperty(navigator, 'serviceWorker', {
                get: () => undefined
            });
        """
    
    async def setup_browser_async(self):
        """Set up browser for async testing"""
        self.playwright = await async_playwright().start()
        self.browser = await self.playwright.chromium.launch(headless=self.headless)
        
        context_config = self.get_browser_context_config()
        self.context = await self.browser.new_context(**context_config)
        
        self.page = await self.context.new_page()
        self.page.set_default_timeout(self.timeout)
        
        # Add initialization script
        init_script = self.get_page_init_script()
        await self.page.add_init_script(init_script)
        
        return self.browser, self.page
    
    def setup_browser_sync(self, playwright: Playwright):
        """Set up browser for sync testing"""
        self.browser = playwright.chromium.launch(headless=self.headless)
        
        context_config = self.get_browser_context_config()
        self.context = self.browser.new_context(**context_config)
        
        self.page = self.context.new_page()
        self.page.set_default_timeout(self.timeout)
        
        # Add initialization script
        init_script = self.get_page_init_script()
        self.page.add_init_script(init_script)
        
        return self.browser, self.page
    
    async def teardown_browser_async(self):
        """Clean up browser for async testing"""
        if self.browser:
            await self.browser.close()
        if self.playwright:
            await self.playwright.stop()
        self.browser = None
        self.context = None
        self.page = None
        self.playwright = None
    
    def teardown_browser_sync(self):
        """Clean up browser for sync testing"""
        if self.browser:
            self.browser.close()
        self.browser = None
        self.context = None
        self.page = None
    
    async def navigate_to(self, path="/", wait_until="networkidle"):
        """Navigate to a specific path on the test server"""
        url = f"{get_pipeline_url()}{path}"
        await self.page.goto(url, wait_until=wait_until)
        return self.page
    
    def navigate_to_sync(self, path="/", wait_until="networkidle"):
        """Navigate to a specific path on the test server (sync version)"""
        url = f"{get_pipeline_url()}{path}"
        self.page.goto(url, wait_until=wait_until)
        return self.page
    
    async def wait_for_element(self, selector, timeout=None):
        """Wait for an element to appear"""
        timeout = timeout or self.timeout
        await self.page.wait_for_selector(selector, timeout=timeout)
    
    def wait_for_element_sync(self, selector, timeout=None):
        """Wait for an element to appear (sync version)"""
        timeout = timeout or self.timeout
        self.page.wait_for_selector(selector, timeout=timeout)
    
    async def get_console_messages(self):
        """Get console messages from the page"""
        messages = []
        
        def handle_console(msg):
            messages.append({
                'type': msg.type,
                'text': msg.text,
                'location': str(msg.location) if msg.location else None
            })
        
        self.page.on("console", handle_console)
        return messages
    
    async def get_page_errors(self):
        """Get page errors"""
        errors = []
        
        def handle_page_error(error):
            errors.append({
                'error': str(error),
                'location': str(error.location) if hasattr(error, 'location') else None
            })
        
        self.page.on("pageerror", handle_page_error)
        return errors
    
    def print_test_summary(self, test_name, passed, total):
        """Print a standardized test summary"""
        print(f"\n=== {test_name.upper()} TEST SUMMARY ===")
        print(f"Total tests: {total}")
        print(f"Passed: {passed}")
        print(f"Failed: {total - passed}")
        
        if passed == total:
            print(f"✅ All {test_name} tests passed!")
            return True
        else:
            print(f"❌ Some {test_name} tests failed!")
            return False

class AsyncBrowserTest(BrowserTestBase):
    """Async version of browser test base"""
    
    async def run_test(self):
        """Override this method to implement your test logic"""
        raise NotImplementedError("Subclasses must implement run_test method")
    
    async def run(self):
        """Run the async test with proper setup and teardown"""
        try:
            self.setup_server()
            await self.setup_browser_async()
            return await self.run_test()
        except Exception as e:
            print(f"❌ Test failed with error: {e}")
            return False
        finally:
            await self.teardown_browser_async()
            self.teardown_server()

class SyncBrowserTest(BrowserTestBase):
    """Sync version of browser test base"""
    
    def run_test(self, playwright: Playwright):
        """Override this method to implement your test logic"""
        raise NotImplementedError("Subclasses must implement run_test method")
    
    def run(self):
        """Run the sync test with proper setup and teardown"""
        try:
            self.setup_server()
            with sync_playwright() as playwright:
                self.setup_browser_sync(playwright)
                return self.run_test(playwright)
        except Exception as e:
            print(f"❌ Test failed with error: {e}")
            return False
        finally:
            self.teardown_server()

def create_async_test_runner(test_class, headless=True, timeout=10000):
    """Create and run an async test"""
    async def run_async_test():
        test = test_class(headless=headless, timeout=timeout)
        return await test.run()
    
    return asyncio.run(run_async_test())

def create_sync_test_runner(test_class, headless=True, timeout=10000):
    """Create and run a sync test"""
    test = test_class(headless=headless, timeout=timeout)
    return test.run()

