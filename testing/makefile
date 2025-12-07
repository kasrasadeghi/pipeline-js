# Testing Makefile

.PHONY: help clean install sync

# Use uv if available, otherwise fall back to python/pip
UV := $(shell command -v uv 2> /dev/null)
PYTHON := $(if $(UV),uv run python,python)
PIP := $(if $(UV),uv pip,pip)

help:
	@echo "Testing Makefile for Pipeline Notes"
	@echo "==================================="
	@echo ""
	@echo "Available targets:"
	@echo "  install     - Install dependencies using uv (or pip)"
	@echo "  sync        - Sync dependencies with pyproject.toml"
	@echo "  clean       - Clean up test artifacts and temporary files"
	@echo ""
	@echo "Usage examples:"
	@echo "  make install  # Install dependencies"
	@echo "  make clean    # Clean up test logs, cache files, and temporary data"
	@if [ -z "$(UV)" ]; then \
		echo ""; \
		echo "Note: uv not found. Install it with: curl -LsSf https://astral.sh/uv/install.sh | sh"; \
	fi

install:
	@echo "Installing dependencies..."
	@if [ -n "$(UV)" ]; then \
		echo "Using uv..."; \
		cd .. && uv pip install pytest-playwright "playwright==1.42.0"; \
	else \
		echo "Using pip..."; \
		$(PIP) install -r requirements.txt; \
	fi
	@echo "Dependencies installed!"

sync:
	@if [ -n "$(UV)" ]; then \
		echo "Syncing dependencies with uv..."; \
		cd .. && uv pip install pytest-playwright "playwright==1.42.0"; \
	else \
		echo "uv not found. Install it with: curl -LsSf https://astral.sh/uv/install.sh | sh"; \
		exit 1; \
	fi

message_edit:
	$(PYTHON) test_message_edit.py

manual:
	$(PYTHON) test_manual.py

message:
	$(PYTHON) test_message_rendering.py

visual:
	cd visual && make test

search:
	$(PYTHON) test_search_immediate.py

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
