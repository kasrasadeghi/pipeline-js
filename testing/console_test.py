#!/usr/bin/env python3
"""
Console test utility for debugging JavaScript errors in the pipeline app.
"""

import sys
import os
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from test_util import get_pipeline_url
from playwright.sync_api import sync_playwright
import argparse

def test_page_console(url, headless=True, timeout=10000):
    """
    Test a page and capture all console output and errors.
    
    Args:
        url: The URL to test (e.g., '/setup', '/today', '/search')
        headless: Whether to run browser in headless mode
        timeout: Timeout in milliseconds
    """
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=headless)
        context = browser.new_context(ignore_https_errors=True)
        page = context.new_page()
        
        # Store all console messages
        console_messages = []
        page_errors = []
        
        # Listen to console messages
        def handle_console(msg):
            console_messages.append({
                'type': msg.type,
                'text': msg.text,
                'location': msg.location
            })
            print(f'CONSOLE: {msg.type}: {msg.text}')
            if msg.location:
                print(f'  Location: {msg.location["url"]}:{msg.location["lineNumber"]}:{msg.location["columnNumber"]}')
        
        page.on('console', handle_console)
        
        # Listen to page errors
        def handle_page_error(error):
            page_errors.append(str(error))
            print(f'PAGE ERROR: {error}')
        
        page.on('pageerror', handle_page_error)
        
        try:
            full_url = f"{get_pipeline_url()}{url}"
            print(f'Navigating to: {full_url}')
            page.goto(full_url, wait_until='networkidle', timeout=timeout)
            print('Page loaded successfully')
            
            # Wait a bit for JavaScript to execute
            page.wait_for_timeout(3000)
            
            print(f'\n=== CONSOLE SUMMARY ===')
            print(f'Total console messages: {len(console_messages)}')
            print(f'Total page errors: {len(page_errors)}')
            
            # Group messages by type
            by_type = {}
            for msg in console_messages:
                msg_type = msg['type']
                if msg_type not in by_type:
                    by_type[msg_type] = []
                by_type[msg_type].append(msg)
            
            for msg_type, messages in by_type.items():
                print(f'\n{msg_type.upper()} messages ({len(messages)}):')
                for msg in messages:
                    print(f'  - {msg["text"]}')
                    if msg["location"]:
                        print(f'    at {msg["location"]["url"]}:{msg["location"]["lineNumber"]}:{msg["location"]["columnNumber"]}')
            
            if page_errors:
                print(f'\nPAGE ERRORS ({len(page_errors)}):')
                for error in page_errors:
                    print(f'  - {error}')
            
            return {
                'success': True,
                'console_messages': console_messages,
                'page_errors': page_errors
            }
            
        except Exception as e:
            print(f'Error: {e}')
            return {
                'success': False,
                'error': str(e),
                'console_messages': console_messages,
                'page_errors': page_errors
            }
        finally:
            browser.close()

def main():
    parser = argparse.ArgumentParser(description='Test page console output')
    parser.add_argument('url', help='URL to test (e.g., /setup, /today, /search)')
    parser.add_argument('--visible', action='store_true', help='Run with visible browser (default is headless)')
    parser.add_argument('--timeout', type=int, default=10000, help='Timeout in milliseconds')
    
    args = parser.parse_args()
    
    # Default to headless unless --visible is specified
    headless = not args.visible
    
    result = test_page_console(args.url, headless=headless, timeout=args.timeout)
    
    if result['success']:
        print('\n✅ Test completed successfully')
    else:
        print('\n❌ Test failed')
        sys.exit(1)

if __name__ == '__main__':
    main()
