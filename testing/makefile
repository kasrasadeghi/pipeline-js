# Testing Makefile

.PHONY: help clean

help:
	@echo "Testing Makefile for Pipeline Notes"
	@echo "==================================="
	@echo ""
	@echo "Available targets:"
	@echo "  clean       - Clean up test artifacts and temporary files"
	@echo ""
	@echo "Usage examples:"
	@echo "  make clean  # Clean up test logs, cache files, and temporary data"

clean:
	@echo "Cleaning up test artifacts..."
	@if [ -d "logs" ]; then \
		rm -rf logs/*.log; \
		echo "Cleaned test logs"; \
	fi
	@if [ -d "__pycache__" ]; then \
		rm -rf __pycache__; \
		echo "Cleaned Python cache"; \
	fi
	@if [ -d "tests/__pycache__" ]; then \
		rm -rf tests/__pycache__; \
		echo "Cleaned tests Python cache"; \
	fi
	@if [ -d "notes" ]; then \
		find notes -type f ! -name '.gitignore' -delete; \
		find notes -type d -empty -delete; \
		echo "Cleaned all test notes (preserved .gitignore)"; \
	fi
	@echo "Cleanup completed!"
