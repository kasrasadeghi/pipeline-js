from playwright.sync_api import Playwright
from browser_test_base import SyncBrowserTest

from tests.first_time_setup import first_time_setup
from tests.first_time_interaction import test_first_time_interaction
from tests.sync_on_network_failure import test_sync_on_network_failure

class ManualTest(SyncBrowserTest):
    """Manual test class for interactive testing"""
    
    def __init__(self):
        super().__init__(port=8100, headless=False, timeout=10000)
    
    def run_test(self, playwright: Playwright):
        """Run the manual test suite"""
        print("Starting manual test suite...")
        
        # Navigate to the main page
        self.navigate_to_sync()
        
        # Bring browser to front for manual interaction
        self.page.bring_to_front()
        
        # Run the first time setup
        repo_name = first_time_setup(self.page)
        
        # Run additional tests (commented out for now)
        # test_first_time_interaction(self.page, repo_name)
        test_sync_on_network_failure(self.server, self.page, repo_name)
        
        print("Manual test suite completed!")
        return True

def main():
    test = ManualTest()
    test.run()

if __name__ == "__main__":
    main()