#!/usr/bin/env python3
"""
Unified Service Worker Test Runner

Run all service worker tests:
    python test_service_worker_runner.py

Run specific test suite:
    python test_service_worker_runner.py basic
    python test_service_worker_runner.py advanced
"""

import sys
import subprocess
from pathlib import Path


def run_test_file(filename):
    """Run a test file and return success status"""
    test_path = Path(__file__).parent / filename
    
    print(f"\n{'='*70}")
    print(f"Running: {filename}")
    print('='*70)
    
    result = subprocess.run(
        [sys.executable, str(test_path)],
        capture_output=False,
        text=True
    )
    
    return result.returncode == 0


def main():
    """Main test runner"""
    args = sys.argv[1:]
    
    print("\n" + "="*70)
    print("SERVICE WORKER TEST SUITE RUNNER")
    print("="*70)
    
    # Change to testing directory
    testing_dir = Path(__file__).parent
    import os
    os.chdir(testing_dir)
    
    # Activate virtual environment
    venv_python = testing_dir.parent / '.venv' / 'bin' / 'python'
    if not venv_python.exists():
        venv_python = testing_dir.parent / '.venv' / 'Scripts' / 'python.exe'
    
    if venv_python.exists():
        sys.executable = str(venv_python)
    
    all_passed = True
    
    # Determine which tests to run
    run_basic = not args or 'basic' in args or 'all' in args
    run_advanced = not args or 'advanced' in args or 'all' in args
    
    # Run basic tests
    if run_basic:
        if not run_test_file('test_service_worker.py'):
            all_passed = False
    
    # Run advanced tests
    if run_advanced:
        if not run_test_file('test_service_worker_advanced.py'):
            all_passed = False
    
    # Final summary
    print("\n" + "="*70)
    if all_passed:
        print("✅ ALL TEST SUITES PASSED")
    else:
        print("❌ SOME TESTS FAILED")
    print("="*70 + "\n")
    
    return 0 if all_passed else 1


if __name__ == "__main__":
    sys.exit(main())
