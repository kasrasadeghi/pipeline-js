# Visual Regression Testing Makefile

.PHONY: help install update test clean

help:
	@echo "Visual Regression Testing for Pipeline Notes"
	@echo "============================================="
	@echo ""
	@echo "Available targets:"
	@echo "  install     - Install visual testing dependencies"
	@echo "  update      - Update baseline images (run after UI changes)"
	@echo "  test        - Run visual regression tests"
	@echo "  clean       - Clean up test artifacts"
	@echo ""
	@echo "Usage examples:"
	@echo "  make install     # First time setup"
	@echo "  make update      # After making UI changes"
	@echo "  make test        # Regular testing"

# Use uv if available, otherwise fall back to python/pip
UV := $(shell command -v uv 2> /dev/null)
PYTHON := $(if $(UV),uv run python,python)
PIP := $(if $(UV),uv pip,pip)

install:
	@echo "Installing visual testing dependencies..."
	@if [ -n "$(UV)" ]; then \
		echo "Using uv..."; \
		cd ../.. && uv sync --extra visual; \
	else \
		echo "Using pip..."; \
		$(PIP) install -r requirements.txt; \
	fi
	@echo "Dependencies installed successfully!"

update:
	@echo "Updating baseline images..."
	$(PYTHON) visual_tests.py --update-baselines --headless
	@echo "Baseline images updated!"

test:
	@echo "Running visual regression tests..."
	$(PYTHON) visual_tests.py --headless

clean:
	@echo "Cleaning up test artifacts..."
	@if [ -d "visual_tests" ]; then \
		rm -rf visual_tests/current/* visual_tests/diffs/*; \
		echo "Cleaned current and diff images"; \
	fi
	@echo "Cleanup completed!"