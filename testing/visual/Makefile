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

install:
	@echo "Installing visual testing dependencies..."
	pip install -r requirements.txt
	@echo "Dependencies installed successfully!"

update:
	@echo "Updating baseline images..."
	python visual_tests.py --update-baselines --headless
	@echo "Baseline images updated!"

test:
	@echo "Running visual regression tests..."
	python visual_tests.py --headless

clean:
	@echo "Cleaning up test artifacts..."
	@if [ -d "visual_tests" ]; then \
		rm -rf visual_tests/current/* visual_tests/diffs/*; \
		echo "Cleaned current and diff images"; \
	fi
	@echo "Cleanup completed!"