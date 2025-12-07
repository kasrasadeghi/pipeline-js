#!/bin/bash
# Helper script to run tests with uv from project root

cd "$(dirname "$0")"

# Install dependencies if needed
if [ ! -d ".venv" ] || [ ! -f ".venv/bin/python" ]; then
    echo "Installing dependencies..."
    uv pip install pytest-playwright "playwright==1.42.0"
fi

# Run the test from the testing directory with proper PYTHONPATH
cd testing
PYTHONPATH=.. ../.venv/bin/python "$@"
