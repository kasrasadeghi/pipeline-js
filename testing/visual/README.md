# Visual Regression Testing

Streamlined visual testing for Pipeline Notes that reuses existing test infrastructure.

## Quick Start

```bash
# Install dependencies
make install

# Update baseline images (first time or after UI changes)
make update

# Run visual tests
make test

# Clean up artifacts
make clean
```

## How It Works

1. **Takes screenshots** of key pages (setup, journal, search, list)
2. **Compares** against stored baseline images
3. **Reports** differences with pixel-perfect accuracy
4. **Reuses** existing Server class from test_util.py

## Test Scenarios

- `setup_page` - Initial setup page
- `setup_with_repo` - Setup page with repo name filled
- `journal_page` - Main journal interface
- `search_page` - Note search functionality  
- `list_page` - All notes listing

## Usage

```bash
# Test specific page
python visual_tests.py --scenario journal_page

# Update baselines after UI changes
python visual_tests.py --update-baselines

# Use different browser
python visual_tests.py --browser firefox
```

## Files

- `visual_tests.py` - Main testing framework
- `requirements.txt` - Dependencies (Pillow, numpy)
- `Makefile` - Convenient commands
- `visual_tests/` - Generated test artifacts
  - `baselines/` - Reference images
  - `current/` - Current screenshots
  - `diffs/` - Difference images

