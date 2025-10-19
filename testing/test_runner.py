#!/usr/bin/env python3
"""
Test runner script that can run different types of tests.
Provides a unified interface for running manual tests, render function tests, etc.
"""

import argparse
import sys
import asyncio
from browser_test_base import create_async_test_runner, create_sync_test_runner

def run_render_tests(headless=True, timeout=10000):
    """Run render function tests"""
    from test_render_functions import RenderFunctionTest
    return create_async_test_runner(RenderFunctionTest, headless, timeout)

def run_manual_tests(headless=False, timeout=10000):
    """Run manual tests"""
    from test_manual import ManualTest
    return create_sync_test_runner(ManualTest, headless, timeout)

def run_message_edit_tests(headless=False, timeout=10000):
    """Run message edit tests"""
    from test_message_edit import MessageEditTest
    return create_sync_test_runner(MessageEditTest, headless, timeout)

def main():
    parser = argparse.ArgumentParser(description='Run Pipeline Notes tests')
    parser.add_argument('test_type', choices=['render', 'manual', 'message-edit', 'all'], 
                       help='Type of test to run')
    parser.add_argument('--visible', action='store_true', 
                       help='Run with visible browser (default is headless for automated tests)')
    parser.add_argument('--timeout', type=int, default=10000, 
                       help='Timeout in milliseconds')
    
    args = parser.parse_args()
    
    # Determine headless mode based on test type
    if args.test_type == 'manual':
        headless = False  # Manual tests should always be visible
    else:
        headless = not args.visible
    
    print(f"Running {args.test_type} tests...")
    print(f"Headless mode: {headless}")
    print(f"Timeout: {args.timeout}ms")
    
    success = True
    
    if args.test_type == 'render':
        success = run_render_tests(headless, args.timeout)
    elif args.test_type == 'manual':
        success = run_manual_tests(headless, args.timeout)
    elif args.test_type == 'message-edit':
        success = run_message_edit_tests(headless, args.timeout)
    elif args.test_type == 'all':
        print("\n=== Running Render Function Tests ===")
        render_success = run_render_tests(True, args.timeout)  # Always headless for automated
        
        print("\n=== Running Manual Tests ===")
        manual_success = run_manual_tests(False, args.timeout)  # Always visible for manual
        
        print("\n=== Running Message Edit Tests ===")
        message_edit_success = run_message_edit_tests(False, args.timeout)  # Always visible for message edit
        
        success = render_success and manual_success and message_edit_success
    
    if success:
        print('\n✅ All tests completed successfully')
    else:
        print('\n❌ Some tests failed')
        sys.exit(1)

if __name__ == '__main__':
    main()

