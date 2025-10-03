#!/usr/bin/env python3
"""
Streamlined visual regression testing for Pipeline Notes.
Reuses existing test infrastructure and focuses on essential functionality.
"""

import os
import shutil
import argparse
from pathlib import Path
from datetime import datetime
from typing import Dict, List, Optional

from playwright.sync_api import sync_playwright, Page, Browser, BrowserContext
from PIL import Image, ImageChops
import numpy as np

# Import existing test utilities
import sys
sys.path.append('..')
from test_util import get_pipeline_url, Server

# --- Configuration ---
VISUAL_TEST_DIR = Path(__file__).parent / "visual_tests"
BASELINE_DIR = VISUAL_TEST_DIR / "baselines"
CURRENT_DIR = VISUAL_TEST_DIR / "current"
DIFF_DIR = VISUAL_TEST_DIR / "diffs"

# Test scenarios - key pages to test
TEST_SCENARIOS = {
    "setup_page": {
        "url": "/setup",
        "description": "Setup page",
        "wait_for": "#local_repo_name",
        "viewport": {"width": 1280, "height": 720}
    },
    "setup_with_repo": {
        "url": "/setup", 
        "description": "Setup page with repo name",
        "wait_for": "#local_repo_name",
        "viewport": {"width": 1280, "height": 720},
        "setup_action": lambda page: (
            page.fill("#local_repo_name", "visual_test_repo"),
            page.click("#local_repo_name_button"),
            page.wait_for_timeout(2000)  # Wait for setup to complete
        )
    },
    "journal_page": {
        "url": "/today",
        "description": "Journal page",
        "wait_for": "#msg_input", 
        "viewport": {"width": 1280, "height": 720},
        "prerequisites": ["setup_with_repo"]
    },
    "search_page": {
        "url": "/search",
        "description": "Search page",
        "wait_for": "#search_query",
        "viewport": {"width": 1280, "height": 720},
        "prerequisites": ["setup_with_repo"]
    },
    "list_page": {
        "url": "/list",
        "description": "List page",
        "wait_for": "main",
        "viewport": {"width": 1280, "height": 720},
        "prerequisites": ["setup_with_repo"]
    }
}

class VisualTester:
    def __init__(self, headless: bool = True):
        self.headless = headless
        self.browser = None
        self.context = None
        self.page = None
        
        # Create directories
        for directory in [BASELINE_DIR, CURRENT_DIR, DIFF_DIR]:
            directory.mkdir(parents=True, exist_ok=True)
    
    def setup_browser(self, playwright_instance, browser_name: str = "chromium"):
        """Set up browser with consistent settings."""
        print(f"Setting up {browser_name} browser...")
        
        browser_options = {
            "headless": self.headless,
            "args": ["--no-sandbox", "--disable-dev-shm-usage"]
        }
        
        context_options = {
            "ignore_https_errors": True,
            "viewport": {"width": 1280, "height": 720}
        }
        
        if browser_name == "chromium":
            browser = playwright_instance.chromium.launch(**browser_options)
        elif browser_name == "firefox":
            browser = playwright_instance.firefox.launch(**browser_options)
        elif browser_name == "webkit":
            browser = playwright_instance.webkit.launch(**browser_options)
        else:
            raise ValueError(f"Unsupported browser: {browser_name}")
        
        context = browser.new_context(**context_options)
        page = context.new_page()
        
        # Disable service worker and set consistent timezone
        page.add_init_script("""
            Object.defineProperty(navigator, 'serviceWorker', {
                get: () => undefined
            });
            // Mock consistent time for reproducible screenshots
            const originalDate = Date;
            Date = class extends originalDate {
                constructor(...args) {
                    if (args.length === 0) {
                        super('2024-01-15T10:00:00.000Z');
                    } else {
                        super(...args);
                    }
                }
                static now() {
                    return new Date('2024-01-15T10:00:00.000Z').getTime();
                }
            };
        """)
        
        self.browser = browser
        self.context = context
        self.page = page
        
        return browser, context, page
    
    def navigate_to_page(self, scenario: Dict) -> bool:
        """Navigate to a page and perform setup actions."""
        try:
            url = f"{get_pipeline_url()}{scenario['url']}"
            print(f"Navigating to: {url}")
            
            # Set viewport if specified
            if 'viewport' in scenario:
                self.page.set_viewport_size(scenario['viewport'])
            
            self.page.goto(url, wait_until="networkidle")
            
            # Wait for specific element if specified
            if 'wait_for' in scenario:
                self.page.wait_for_selector(scenario['wait_for'], timeout=10000)
            
            # Perform setup action if specified
            if 'setup_action' in scenario:
                action = scenario['setup_action']
                if callable(action):
                    action(self.page)
            
            # Wait for content to settle
            self.page.wait_for_timeout(1000)
            
            return True
            
        except Exception as e:
            print(f"Error navigating to {scenario['url']}: {e}")
            return False
    
    def take_screenshot(self, scenario_name: str, scenario: Dict) -> Optional[Path]:
        """Take a screenshot of the current page."""
        try:
            if not self.navigate_to_page(scenario):
                return None
            
            screenshot_path = CURRENT_DIR / f"{scenario_name}.png"
            self.page.screenshot(
                path=str(screenshot_path),
                full_page=True,
                animations="disabled"
            )
            
            print(f"Screenshot saved: {screenshot_path}")
            return screenshot_path
            
        except Exception as e:
            print(f"Error taking screenshot for {scenario_name}: {e}")
            return None
    
    def compare_images(self, baseline_path: Path, current_path: Path, diff_path: Path) -> Dict:
        """Compare two images and generate diff if different."""
        try:
            baseline = Image.open(baseline_path).convert('RGB')
            current = Image.open(current_path).convert('RGB')
            
            # Ensure same size
            if baseline.size != current.size:
                return {
                    "match": False,
                    "error": "Size mismatch",
                    "baseline_size": baseline.size,
                    "current_size": current.size
                }
            
            # Calculate difference
            diff = ImageChops.difference(baseline, current)
            diff_array = np.array(diff)
            total_pixels = diff_array.size
            different_pixels = np.sum(diff_array > 0)
            similarity_percentage = ((total_pixels - different_pixels) / total_pixels) * 100
            
            # Check if images are identical (allowing for small differences)
            threshold = 0.1  # 0.1% difference threshold
            is_match = similarity_percentage >= (100 - threshold)
            
            result = {
                "match": is_match,
                "similarity_percentage": similarity_percentage,
                "different_pixels": int(different_pixels),
                "total_pixels": int(total_pixels)
            }
            
            # Generate diff image if not matching
            if not is_match:
                diff_visual = Image.new('RGB', baseline.size, (255, 255, 255))
                diff_visual.paste(baseline)
                diff_visual = ImageChops.blend(diff_visual, Image.new('RGB', baseline.size, (255, 0, 0)), 0.3)
                diff_visual.paste(diff, mask=diff)
                diff_visual.save(diff_path)
                result["diff_path"] = str(diff_path)
            
            return result
            
        except Exception as e:
            print(f"Error comparing images: {e}")
            return {"match": False, "error": str(e)}
    
    def resolve_dependencies(self, scenarios: Dict) -> List[str]:
        """Resolve test dependencies and return scenarios in execution order using topological sort."""
        post_order = []
        visited = set()
        visiting = set()  # For cycle detection
        
        def visit(scenario_name):
            if scenario_name in visiting:
                raise ValueError(f"Circular dependency detected involving '{scenario_name}'")
            if scenario_name in visited:
                return
            if scenario_name not in scenarios:
                return
                
            visiting.add(scenario_name)
            scenario = scenarios[scenario_name]
            
            # First visit all prerequisites
            if 'prerequisites' in scenario:
                for prereq in scenario['prerequisites']:
                    visit(prereq)
            
            visiting.remove(scenario_name)
            visited.add(scenario_name)
            # Add to post-order (after visiting all children)
            post_order.append(scenario_name)
        
        # Visit all scenarios
        for scenario_name in scenarios:
            visit(scenario_name)
            
        # A topologicla sort is the reverse of the post-order of a DFS.
        # For our use case, we want prerequisites first, so we use post-order directly
        # (not reversed, since we want dependencies before dependents)
        return post_order

    def run_tests(self, scenarios: Dict, update_baselines: bool = False) -> Dict:
        """Run visual regression tests for all scenarios."""
        results = {
            "timestamp": datetime.now().isoformat(),
            "total_tests": len(scenarios),
            "passed": 0,
            "failed": 0,
            "errors": 0,
            "tests": {}
        }
        
        # Resolve dependencies to get correct execution order
        execution_order = self.resolve_dependencies(scenarios)
        print(f"Running {len(scenarios)} visual tests in order: {execution_order}")
        
        for scenario_name in execution_order:
            scenario = scenarios[scenario_name]
            print(f"\n--- Testing {scenario_name}: {scenario['description']} ---")
            
            # Take screenshot
            screenshot_path = self.take_screenshot(scenario_name, scenario)
            
            if not screenshot_path:
                results["errors"] += 1
                results["tests"][scenario_name] = {
                    "status": "error",
                    "error": "Failed to take screenshot"
                }
                continue
            
            baseline_path = BASELINE_DIR / f"{scenario_name}.png"
            
            if update_baselines or not baseline_path.exists():
                # Update baseline
                shutil.copy2(screenshot_path, baseline_path)
                print(f"Updated baseline: {baseline_path}")
                results["tests"][scenario_name] = {
                    "status": "updated",
                    "baseline_updated": True
                }
                results["passed"] += 1
            else:
                # Compare with baseline
                diff_path = DIFF_DIR / f"{scenario_name}_diff.png"
                comparison = self.compare_images(baseline_path, screenshot_path, diff_path)
                
                if comparison["match"]:
                    print(f"✓ {scenario_name}: PASSED")
                    results["passed"] += 1
                    results["tests"][scenario_name] = {
                        "status": "passed",
                        "similarity_percentage": comparison["similarity_percentage"]
                    }
                else:
                    print(f"✗ {scenario_name}: FAILED")
                    results["failed"] += 1
                    results["tests"][scenario_name] = {
                        "status": "failed",
                        "similarity_percentage": comparison.get("similarity_percentage", 0),
                        "different_pixels": comparison.get("different_pixels", 0),
                        "diff_path": comparison.get("diff_path"),
                        "error": comparison.get("error")
                    }
        
        return results
    
    def cleanup(self):
        """Clean up browser resources."""
        if self.browser:
            self.browser.close()

def main():
    parser = argparse.ArgumentParser(description="Visual regression testing for Pipeline Notes")
    parser.add_argument("--browser", default="chromium", choices=["chromium", "firefox", "webkit"], help="Browser to use")
    parser.add_argument("--headless", action="store_true", help="Run in headless mode")
    parser.add_argument("--update-baselines", action="store_true", help="Update baseline images")
    parser.add_argument("--scenario", help="Run specific scenario only")
    
    args = parser.parse_args()
    
    # Choose scenarios
    scenarios = TEST_SCENARIOS
    if args.scenario:
        if args.scenario in scenarios:
            scenarios = {args.scenario: scenarios[args.scenario]}
        else:
            print(f"Scenario '{args.scenario}' not found")
            return 1
    
    # Start server using existing Server class
    server = Server(8100)
    server.create_folders()
    server.run()
    
    try:
        if not server.check():
            print("Server not responding, exiting")
            return 1
        
        # Run visual tests
        with sync_playwright() as playwright:
            tester = VisualTester(args.headless)
            try:
                tester.setup_browser(playwright, args.browser)
                results = tester.run_tests(scenarios, args.update_baselines)
                
                # Print summary
                print(f"\n=== VISUAL TEST SUMMARY ===")
                print(f"Total: {results['total_tests']} | Passed: {results['passed']} | Failed: {results['failed']} | Errors: {results['errors']}")
                
                return 0 if results['failed'] == 0 and results['errors'] == 0 else 1
                
            finally:
                tester.cleanup()
    
    finally:
        server.terminate()

if __name__ == "__main__":
    import sys
    sys.exit(main())