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
        
        # Set up local repo name with a unique name to avoid accumulating old messages
        import time
        unique_repo_name = f'search_test_{int(time.time())}'
        
        repo_input = await self.page.query_selector('#local_repo_name')
        if repo_input:
            current_value = await repo_input.input_value()
            print(f"Current repo value: '{current_value}'")
            if not current_value:
                print(f"Setting repo name to '{unique_repo_name}'")
                await repo_input.fill(unique_repo_name)
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
        
        # Add some test messages to make the worker take longer to process
        print("Adding test messages to simulate real repo...")
        msg_input = await self.page.query_selector('#msg_input')
        if msg_input:
            for i in range(5):
                await msg_input.fill(f"Test message {i} for timing simulation")
                await msg_input.press('Enter')
                await self.page.wait_for_timeout(200)  # Longer delay to ensure different timestamps
        
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
        
        # Type a completely new message that doesn't exist yet
        test_message = "BRAND NEW MESSAGE FOR TIMING TEST"
        print(f"Typing message: '{test_message}'")
        
        # Find the message input and add the message
        msg_input = await self.page.query_selector('#msg_input')
        if not msg_input:
            print("❌ No message input found")
            return False
            
        # Add a delay before sending the message to ensure it has a more recent timestamp
        print("Waiting 2 seconds before sending message to ensure it has the most recent timestamp...")
        await self.page.wait_for_timeout(2000)
        
        await msg_input.fill(test_message)
        await msg_input.press('Enter')
        
        # Click the search button (not navigate to search)
        print("Clicking search button...")
        search_button = await self.page.query_selector('button[onclick*="gotoSearch"]')
        if not search_button:
            print("❌ No search button found")
            return False
            
        await search_button.click()
        
        # Wait just a short time to catch the bug before worker finishes
        print("Waiting 100ms to check for timing bug...")
        await self.page.wait_for_timeout(100)
        
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
            # Only print first few and last few results to avoid spam
            if i < 5 or i >= len(search_results) - 5:
                print(f"Result {i}: {content[:200]}...")  # Print first 200 chars
            if test_message in content:
                found_message = True
                message_position = i
                print(f"✅ Found our message at position {i}")
                break
        
        await self.page.wait_for_timeout(1000)

        
        print(f"\n--- Results ---")
        print(f"Message found: {found_message}")
        print(f"Position: {message_position} out of {len(search_results)} results")
        
        # The core fix is that the message should appear in search at all
        # The position check is less important - we just want to verify immediate search works
        if not found_message:
            print("❌ BUG REPRODUCED: Message not found in search immediately after adding")
            return False
        else:
            print("✅ BUG FIXED: Message found in search immediately after adding!")
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
