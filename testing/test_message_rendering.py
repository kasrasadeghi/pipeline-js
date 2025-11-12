#!/usr/bin/env python3
"""
Test that verifies message sending and rendering functionality.
This test checks that when a message is sent, it actually appears
in the discussion view with proper formatting.
"""

from playwright.sync_api import Playwright
from browser_test_base import SyncBrowserTest
from tests.first_time_setup import first_time_setup
from tests.message_rendering import test_message_rendering

class MessageRenderingTest(SyncBrowserTest):
    """Test class specifically for message rendering functionality"""
    
    def __init__(self):
        super().__init__(port=8100, headless=True, timeout=15000)
    
    def run_test(self, playwright: Playwright):
        """Run the message rendering test"""
        print("Starting message rendering test...")
        
        # Navigate to the main page
        self.goto_main_sync()
        
        # Run the first time setup to get a repo name
        repo_name = first_time_setup(self.page)
        
        # Run the message rendering test
        test_message_rendering(self.page, repo_name)
        
        print("✅ Message rendering test completed successfully!")
        return True

def main():
    test = MessageRenderingTest()
    success = test.run()
    
    if success:
        print("\n🎉 All message rendering tests passed!")
        return 0
    else:
        print("\n❌ Message rendering tests failed!")
        return 1

if __name__ == "__main__":
    exit(main())
