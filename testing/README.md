# Testing Directory

This directory contains all testing infrastructure for Pipeline Notes.

## Structure

- **`test_manual.py`** - Main functional tests using Playwright
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
# Run functional tests
python test_manual.py

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

## Documentation

- **Functional Tests**: See `test_manual.py` for test details
- **Visual Tests**: See `visual/README_visual_tests.md` for comprehensive documentation

