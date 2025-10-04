#!/usr/bin/env python3
"""
Test script that sets up test data and then runs render function tests.
This ensures we have content to test with.
"""

import asyncio
import argparse
import sys
from browser_test_base import AsyncBrowserTest

class RenderFunctionTestWithData(AsyncBrowserTest):
    """Test class for render.js functions with test data setup"""
    
    async def setup_test_data(self):
        """Set up test data by creating some notes and messages"""
        print("Setting up test data...")
        
        # Navigate to setup page first
        await self.navigate_to('/setup')
        await self.page.wait_for_timeout(1000)
        
        # Set up local repo name if not already set
        repo_input = await self.page.query_selector('#local_repo_name')
        if repo_input:
            current_value = await repo_input.input_value()
            if not current_value:
                await repo_input.fill('test_user')
                set_button = await self.page.query_selector('#local_repo_name_button')
                if set_button:
                    await set_button.click()
                    await self.page.wait_for_timeout(1000)
        
        # Navigate to journal page
        await self.navigate_to('/today')
        await self.page.wait_for_timeout(2000)
        
        # Add some test messages if the page is empty
        msg_input = await self.page.query_selector('#msg_input')
        if msg_input:
            # Check if there are any existing messages
            messages = await self.page.query_selector_all('.msg')
            if len(messages) == 0:
                print("Adding test messages...")
                
                # Add a few test messages
                test_messages = [
                    "This is a test message with a reference to another message",
                    "This is another test message with a #tag",
                    "This message references the first message: #test_user/2024-01-01T12:00:00Z"
                ]
                
                for msg in test_messages:
                    await msg_input.click()
                    await msg_input.fill(msg)
                    await msg_input.press('Enter')
                    await self.page.wait_for_timeout(500)
        
        print("Test data setup complete!")
    
    async def test_expand_ref(self):
        """Test the expandRef function"""
        print("Testing expandRef function...")
        
        # Look for any reference links in the messages
        ref_links = await self.page.query_selector_all('a[href*="#"]')
        if not ref_links:
            print("❌ No reference links found to test expandRef")
            return False
        
        print(f"Found {len(ref_links)} reference links")
        
        # Test clicking on a reference link
        first_ref = ref_links[0]
        href = await first_ref.get_attribute('href')
        print(f"Testing reference link: {href}")
        
        # Count quotes before clicking
        quotes_before = await self.page.query_selector_all('.quotes')
        print(f"Quotes before: {len(quotes_before)}")
        
        # Click the reference link
        await first_ref.click()
        
        # Wait a bit for the expansion to happen
        await self.page.wait_for_timeout(1000)
        
        # Count quotes after clicking
        quotes_after = await self.page.query_selector_all('.quotes')
        print(f"Quotes after: {len(quotes_after)}")
        
        if len(quotes_after) > len(quotes_before):
            print("✅ expandRef successfully created quotes")
            return True
        else:
            print("❌ expandRef did not create quotes")
            return False

    async def test_expand_search(self):
        """Test the expandSearch function"""
        print("Testing expandSearch function...")
        
        # Navigate to search page
        await self.navigate_to('/search')
        await self.page.wait_for_timeout(2000)
        
        # Perform a search first
        search_input = await self.page.query_selector('#search_query')
        if search_input:
            await search_input.fill('test')
            await search_input.press('Enter')
            await self.page.wait_for_timeout(2000)
        
        # Look for search result links
        search_links = await self.page.query_selector_all('a[href*="search"]')
        if not search_links:
            print("❌ No search links found to test expandSearch")
            return False
        
        print(f"Found {len(search_links)} search links")
        
        # Test clicking on a search link
        first_search = search_links[0]
        href = await first_search.get_attribute('href')
        print(f"Testing search link: {href}")
        
        # Count quotes before clicking
        quotes_before = await self.page.query_selector_all('.quotes')
        print(f"Quotes before: {len(quotes_before)}")
        
        # Click the search link
        await first_search.click()
        
        # Wait a bit for the expansion to happen
        await self.page.wait_for_timeout(1000)
        
        # Count quotes after clicking
        quotes_after = await self.page.query_selector_all('.quotes')
        print(f"Quotes after: {len(quotes_after)}")
        
        if len(quotes_after) > len(quotes_before):
            print("✅ expandSearch successfully created quotes")
            return True
        else:
            print("❌ expandSearch did not create quotes")
            return False

    async def test_insert_html_before_message(self):
        """Test the insertHtmlBeforeMessage function indirectly"""
        print("Testing insertHtmlBeforeMessage function...")
        
        # Navigate back to journal page
        await self.navigate_to('/today')
        await self.page.wait_for_timeout(2000)
        
        # Look for any expandable content
        expand_buttons = await self.page.query_selector_all('button[onclick*="expand"]')
        if not expand_buttons:
            print("❌ No expand buttons found to test insertHtmlBeforeMessage")
            return False
        
        print(f"Found {len(expand_buttons)} expand buttons")
        
        # Test clicking an expand button
        first_button = expand_buttons[0]
        onclick = await first_button.get_attribute('onclick')
        print(f"Testing button: {onclick}")
        
        # Count quotes before
        quotes_before = await self.page.query_selector_all('.quotes')
        print(f"Quotes before: {len(quotes_before)}")
        
        # Click the button
        await first_button.click()
        
        # Wait for expansion
        await self.page.wait_for_timeout(1000)
        
        # Count quotes after
        quotes_after = await self.page.query_selector_all('.quotes')
        print(f"Quotes after: {len(quotes_after)}")
        
        if len(quotes_after) > len(quotes_before):
            print("✅ insertHtmlBeforeMessage successfully inserted content")
            return True
        else:
            print("❌ insertHtmlBeforeMessage did not insert content")
            return False

    async def run_test(self):
        """Run all render function tests with data setup"""
        print("Starting render function tests with data setup...")
        
        # Set up test data first
        await self.setup_test_data()
        
        # Test expandRef
        expand_ref_success = await self.test_expand_ref()
        
        # Test expandSearch
        expand_search_success = await self.test_expand_search()
        
        # Test insertHtmlBeforeMessage
        insert_html_success = await self.test_insert_html_before_message()
        
        # Summary
        total_tests = 3
        passed_tests = sum([expand_ref_success, expand_search_success, insert_html_success])
        
        return self.print_test_summary("render function with data", passed_tests, total_tests)

async def main_async():
    parser = argparse.ArgumentParser(description='Test render.js functions with test data')
    parser.add_argument('--visible', action='store_true', help='Run with visible browser (default is headless)')
    parser.add_argument('--timeout', type=int, default=10000, help='Timeout in milliseconds')
    
    args = parser.parse_args()
    
    # Default to headless unless --visible is specified
    headless = not args.visible
    
    test = RenderFunctionTestWithData(headless=headless, timeout=args.timeout)
    result = await test.run()
    
    if result:
        print('\n✅ All tests completed successfully')
    else:
        print('\n❌ Some tests failed')
        sys.exit(1)

def main():
    asyncio.run(main_async())

if __name__ == '__main__':
    main()

