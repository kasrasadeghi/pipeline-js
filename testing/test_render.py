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
        await self.goto_main_async('/setup')
        await self.page.wait_for_timeout(1000)
        
        # Set up local repo name if not already set
        repo_input = await self.page.query_selector('#local_repo_name')
        if repo_input:
            current_value = await repo_input.input_value()
            print(f"Current repo value: '{current_value}'")
            if not current_value:
                print("Setting repo name to 'test_user'")
                await repo_input.fill('test_user')
                set_button = await self.page.query_selector('#local_repo_name_button')
                if set_button:
                    await set_button.click()
                    # Wait for the global state to be initialized after setting repo name
                    await self.page.wait_for_function('window.kazglobalReady === true', timeout=10000)
                    # Check if the value was set
                    new_value = await repo_input.input_value()
                    print(f"Repo value after setting: '{new_value}'")
            else:
                print(f"Repo name already set to: '{current_value}'")
        
        # Navigate to journal page
        await self.goto_main_async('/today')
        await self.page.wait_for_timeout(2000)
        
        # Check if we're still on setup page (which would indicate repo name wasn't persisted)
        current_url = await self.page.evaluate('window.location.href')
        if '/setup' in current_url:
            print("Still on setup page, repo name not persisted. Trying again...")
            # Try to set the repo name again
            repo_input = await self.page.query_selector('#local_repo_name')
            if repo_input:
                await repo_input.fill('test_user')
                set_button = await self.page.query_selector('#local_repo_name_button')
                if set_button:
                    await set_button.click()
                    await self.page.wait_for_timeout(3000)
                    # Navigate to journal page again
                    await self.goto_main_async('/today')
                    await self.page.wait_for_timeout(2000)
        
        # Wait for global state to be initialized
        await self.page.wait_for_function('window.kazglobalReady === true', timeout=10000)
        
        # Check what page we're actually on
        current_url = await self.page.evaluate('window.location.href')
        print(f"Current URL after navigation: {current_url}")
        
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
                    "This is another test message with a #tag"
                ]
                
                for msg in test_messages:
                    await msg_input.click()
                    await msg_input.fill(msg)
                    await msg_input.press('Enter')
                    await self.page.wait_for_timeout(500)
                
                # Now add a message that references the first one
                # We need to get the actual UUID and datetime from the first message
                await self.page.wait_for_timeout(1000)  # Wait for messages to render
                
                # Get the first message's ID (which should be the full datetime)
                first_message = await self.page.query_selector('.msg')
                if first_message:
                    message_id = await first_message.get_attribute('id')
                    current_uuid = await self.page.evaluate('getCurrentNoteUuid()')
                    host = await self.page.evaluate('window.location.host')
                    
                    print(f"Message ID: {message_id}")
                    print(f"Current UUID: {current_uuid}")
                    print(f"Host: {host}")
                    
                    # Create a reference to the first message using the exact same format as gatherSelectedMessage
                    # URL-encode the datetime part since it contains spaces and special characters
                    import urllib.parse
                    encoded_datetime = urllib.parse.quote(message_id)
                    reference_url = f"https://{host}/disc/{current_uuid}#{encoded_datetime}"
                    reference_message = f"This message references the first message: {reference_url}"
                    
                    await msg_input.click()
                    await msg_input.fill(reference_message)
                    await msg_input.press('Enter')
                    await self.page.wait_for_timeout(500)
                    
                    # Also create a search link to test expandSearch
                    search_url = f"https://{host}/search/?q=test"
                    search_message = f"This message has a search link: {search_url}"
                    
                    await msg_input.click()
                    await msg_input.fill(search_message)
                    await msg_input.press('Enter')
                    await self.page.wait_for_timeout(500)
        
        print("Test data setup complete!")
    
    async def test_expand_ref(self):
        """Test the expandRef function"""
        print("Testing expandRef function...")
        
        # Look for reference buttons (not links!)
        ref_buttons = await self.page.query_selector_all('button[onclick*="expandRef"]')
        if not ref_buttons:
            print("❌ No reference buttons found to test expandRef")
            return False
        
        print(f"Found {len(ref_buttons)} reference buttons")
        
        # Test clicking on a reference button
        first_ref = ref_buttons[0]
        onclick = await first_ref.get_attribute('onclick')
        print(f"Testing reference button: {onclick}")
        
        # Count quotes before clicking
        quotes_before = await self.page.query_selector_all('.quotes')
        print(f"Quotes before: {len(quotes_before)}")
        
        # Click the reference button
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
        await self.goto_main_async('/search')
        await self.page.wait_for_timeout(2000)
        
        # Perform a search first
        search_input = await self.page.query_selector('#search_query')
        if search_input:
            await search_input.fill('test')
            await search_input.press('Enter')
            await self.page.wait_for_timeout(2000)
        else:
            print("❌ No search input found")
            return False
        
        # Check what's on the search page
        search_results = await self.page.query_selector_all('.msglist .msg')
        print(f"Found {len(search_results)} search results")
        
        # Look for search result buttons
        search_buttons = await self.page.query_selector_all('button[onclick*="expandSearch"]')
        if not search_buttons:
            print("❌ No search buttons found to test expandSearch")
            # Let's see what buttons are actually on the page
            all_buttons = await self.page.query_selector_all('button')
            print(f"Found {len(all_buttons)} total buttons on the page")
            for i, button in enumerate(all_buttons):
                onclick = await button.get_attribute('onclick')
                print(f"Button {i}: {onclick}")
            return False
        
        print(f"Found {len(search_buttons)} search buttons")
        
        # Test clicking on a search button
        first_search = search_buttons[0]
        onclick = await first_search.get_attribute('onclick')
        print(f"Testing search button: {onclick}")
        
        # Count quotes before clicking
        quotes_before = await self.page.query_selector_all('.quotes')
        print(f"Quotes before: {len(quotes_before)}")
        
        # Click the search button
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


    async def run_test(self):
        """Run all render function tests with data setup"""
        print("Starting render function tests with data setup...")
        
        # Set up test data first
        await self.setup_test_data()
        
        # Test expandRef
        expand_ref_success = await self.test_expand_ref()
        
        # Test expandSearch
        expand_search_success = await self.test_expand_search()
        
        # Summary
        total_tests = 2
        passed_tests = sum([expand_ref_success, expand_search_success])
        
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

