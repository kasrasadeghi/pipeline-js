#!/usr/bin/env python3
"""
Test script specifically for the search timing bug.
This test reproduces the issue where adding a message and immediately searching for it doesn't work.
"""

import asyncio
import argparse
import sys
from browser_test_base import AsyncBrowserTest

class SearchTimingBugTest(AsyncBrowserTest):
    """Test class specifically for the search timing bug"""
    
    async def setup_test_data(self):
        """Set up test data by creating some notes and messages"""
        print("Setting up test data...")
        
        # Navigate to setup page first
        await self.navigate_to('/setup')
        
        # Set up local repo name if not already set
        repo_input = await self.page.query_selector('#local_repo_name')
        if repo_input:
            current_value = await repo_input.input_value()
            print(f"Current repo value: '{current_value}'")
            if not current_value:
                print("Setting repo name to 'search_timing_test'")
                await repo_input.fill('search_timing_test')
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
        
        print("Test data setup complete")
    
    
    async def test_manual_reproduction(self):
        """Test that reproduces the exact bug scenario: type message, click search button"""
        print("\n" + "="*60)
        print("MANUAL REPRODUCTION TEST")
        print("="*60)
        
        # Navigate to journal page
        await self.navigate_to('/today')
        
        # Type the message "what"
        test_message = "what"
        print(f"Typing message: '{test_message}'")
        
        # Find the message input and add the message
        msg_input = await self.page.query_selector('#msg_input')
        if not msg_input:
            print("❌ No message input found")
            return False
            
        await msg_input.fill(test_message)
        await msg_input.press('Enter')
        
        # Click the search button (not navigate to search)
        print("Clicking search button...")
        search_button = await self.page.query_selector('button[onclick*="gotoSearch"]')
        if not search_button:
            print("❌ No search button found")
            return False
            
        await search_button.click()
        
        # Check if message appears and is at the bottom
        search_results = await self.page.query_selector_all('.msglist .msg')
        print(f"Found {len(search_results)} search results")
        
        found_message = False
        is_bottom = False
        message_position = -1
        
        for i, result in enumerate(search_results):
            content = await result.text_content()
            print(f"Result {i}: {content[:100]}...")  # Print first 100 chars
            if test_message in content:
                found_message = True
                is_bottom = (i == 0)  # First result should be most recent
                message_position = i
                print(f"✅ Found our message at position {i}")
                break
        
        print(f"\n--- Results ---")
        print(f"Message found: {found_message}")
        print(f"At bottom (position 0): {is_bottom}")
        print(f"Position: {message_position}")
        
        if not found_message:
            print("✅ BUG CONFIRMED: Message not found in search")
            return True
        elif not is_bottom:
            print("✅ BUG CONFIRMED: Message found but not at bottom")
            return True
        else:
            print("❌ BUG NOT REPRODUCED: Message found and at bottom")
            return False
    
    
    async def run(self):
        """Run the search persistent bug test"""
        try:
            # Don't start a new server, use the existing one
            await self.setup_browser_async()
            await self.setup_test_data()
            success = await self.test_manual_reproduction()
            return self.print_test_summary("search persistent bug", 1 if success else 0, 1)
        except Exception as e:
            print(f"❌ Test failed with exception: {e}")
            return False
        finally:
            await self.teardown_browser_async()

async def main_async():
    parser = argparse.ArgumentParser(description='Test search timing bug')
    parser.add_argument('--visible', action='store_true', help='Run with visible browser (default is headless)')
    parser.add_argument('--timeout', type=int, default=15000, help='Timeout in milliseconds')
    
    args = parser.parse_args()
    
    # Default to headless unless --visible is specified
    headless = not args.visible
    
    test = SearchTimingBugTest(port=8101, headless=headless, timeout=args.timeout)
    result = await test.run()
    
    if result:
        print('\n✅ Search timing bug test completed successfully')
    else:
        print('\n❌ Search timing bug test failed')
        sys.exit(1)

def main():
    asyncio.run(main_async())

if __name__ == '__main__':
    main()
