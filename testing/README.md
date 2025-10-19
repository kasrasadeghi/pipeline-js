# Testing Directory

This directory contains all testing infrastructure for Pipeline Notes.

## Structure

- **`test_manual.py`** - Main functional tests using Playwright
- **`test_message_edit.py`** - Individual message editing tests with comprehensive keyboard/input testing
- **`test_runner.py`** - Unified test runner for all test types
- **`visual/`** - Visual regression testing suite
  - `visual_tests.py` - Core visual testing framework
  - `run_visual_tests.py` - Convenience script for visual tests
  - `integrated_test.py` - Combines functional and visual tests
  - `example_usage.py` - Example usage demonstration
  - `Makefile` - Visual testing commands
  - `README_visual_tests.md` - Detailed visual testing documentation

## Quick Start

### Functional Tests
```bash
# Run all functional tests
python test_runner.py all

# Run specific test types
python test_runner.py manual        # Manual interaction tests
python test_runner.py message-edit  # Message editing tests
python test_runner.py render        # Render function tests

# Or from project root
make test
```

### Visual Tests
```bash
# Navigate to visual testing directory
cd visual

# Install dependencies and run tests
make install
make update  # First time only
make test

# Or from project root
make visual-test
```

### Combined Tests
```bash
# Run both functional and visual tests
make test-all
```

## Test Types

### Manual Tests (`test_manual.py`)
- First-time setup and interaction tests
- Network failure handling
- Basic application functionality

### Message Edit Tests (`test_message_edit.py`)
- Individual message editing workflow
- Keyboard shortcuts and text input testing
- HTML pasting and special character handling
- Multi-line content editing
- State management and restrictions

### Render Tests
- Render function validation
- Content parsing and formatting

## Documentation

- **Functional Tests**: See individual test files for specific test details
- **Visual Tests**: See `visual/README_visual_tests.md` for comprehensive documentation

