#!/usr/bin/env python3
"""
Test script specifically for the search timing bug.
This test reproduces the issue where adding a message and immediately searching for it doesn't work.
"""

import argparse
import sys
from browser_test_base import AsyncBrowserTest

class TestSearchImmediate(AsyncBrowserTest):
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
        
        # Navigate to journal page after setup
        print("Navigating to journal page...")
        await self.page.evaluate("() => { if (window.gotoJournal) window.gotoJournal(); }")
        await self.page.wait_for_timeout(1000)
        
        # Wait for the message input to be available
        try:
            await self.page.wait_for_selector('#msg_input', timeout=10000)
            print("✅ Journal page loaded with message input")
        except Exception as e:
            print(f"❌ Failed to load journal page: {e}")
            raise
        
        print("Test data setup complete")
    
    
    async def run_test(self):
        """Test that reproduces the exact bug scenario: type message, click search button"""
        print("\n" + "="*60)
        print("SEARCH TIMING BUG TEST")
        print("="*60)
        
        # Set up console log capture
        console_logs = []
        self.page.on("console", lambda msg: console_logs.append(f"{msg.type}: {msg.text}"))
        
        # Set up test data first
        await self.setup_test_data()
        
        # We should now be on the journal page from setup
        current_url = self.page.url
        print(f"Current URL: {current_url}")
        
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
        
        # Add a small delay to see if we can reproduce the timing issue
        # print("Waiting 100ms before clicking search...")
        # await self.page.wait_for_timeout(100)
        
        # Click the search button (not navigate to search)
        print("Clicking search button...")
        search_button = await self.page.query_selector('button[onclick*="gotoSearch"]')
        if not search_button:
            print("❌ No search button found")
            return False
            
        await search_button.click()
        
        # Wait a bit to see console logs and let search process
        print("Waiting 2 seconds to see console logs...")
        await self.page.wait_for_timeout(2000)
        
        # Print console logs
        print("\n--- CONSOLE LOGS ---")
        for log in console_logs:
            if "WORKER" in log or "SEARCH" in log:
                print(log)
        print("--- END CONSOLE LOGS ---\n")
        
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
                # Due to reverse() in renderSearchMain, the most recent message is at the END of the list
                is_bottom = (i == len(search_results) - 1)  # Last result should be most recent
                message_position = i
                print(f"✅ Found our message at position {i}")
                break
        
        print(f"\n--- Results ---")
        print(f"Message found: {found_message}")
        print(f"At bottom (last position): {is_bottom}")
        print(f"Position: {message_position}")
        
        if not found_message:
            print("❌ BUG STILL EXISTS: Message not found in search")
            return False
        elif not is_bottom:
            print("❌ BUG STILL EXISTS: Message found but not at bottom")
            return False
        else:
            print("✅ BUG FIXED: Message found and at bottom - search works correctly!")
            return True
    
    

def main():
    parser = argparse.ArgumentParser(description='Test search timing bug')
    parser.add_argument('--visible', action='store_true', help='Run with visible browser (default is headless)')
    parser.add_argument('--timeout', type=int, default=15000, help='Timeout in milliseconds')
    
    args = parser.parse_args()
    
    # Default to headless unless --visible is specified
    headless = not args.visible
    
    from browser_test_base import create_async_test_runner
    result = create_async_test_runner(TestSearchImmediate, headless=headless, timeout=args.timeout)
    
    if result:
        print('\n✅ Search timing bug test completed successfully')
    else:
        print('\n❌ Search timing bug test failed')
        sys.exit(1)

if __name__ == '__main__':
    main()
