from playwright.sync_api import sync_playwright, Playwright
import os
import subprocess
from datetime import datetime
import time
import sys
from test_util import get_pipeline_url, Server

from tests.first_time_setup import first_time_setup
from tests.first_time_interaction import test_first_time_interaction
from tests.sync_on_network_failure import test_sync_on_network_failure

PORT = 8100


def run(playwright: Playwright):
    chromium = playwright.chromium # or "firefox" or "webkit".
    browser = chromium.launch(headless=False)
    context = browser.new_context(
        ignore_https_errors=True,  # Ignore HTTPS errors since we're using a self-signed cert
        bypass_csp=True,  # Bypass Content Security Policy
        extra_http_headers={
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Accept-Encoding': 'gzip, deflate',
            'Connection': 'keep-alive',
        }
    )
    page = context.new_page()
    
    # Disable service worker for testing
    page.add_init_script("""
        Object.defineProperty(navigator, 'serviceWorker', {
            get: () => undefined
        });
    """)
    
    page.goto(get_pipeline_url(), wait_until="domcontentloaded")

    # open playwright browser and bring to front
    page.bring_to_front()

    return browser, page


def main():
    server = Server(PORT)
    server.create_folders()
    server.run()
    try:
        if not server.check():
            print("Exiting due to server unavailability")
            return
            
        with sync_playwright() as playwright:
            browser, page = run(playwright)
            repo_name = first_time_setup(page)
            # test_first_time_interaction(page, repo_name)
            test_sync_on_network_failure(server, page, repo_name)
            browser.close()
    finally:
        server.terminate()

if __name__ == "__main__":
    main()