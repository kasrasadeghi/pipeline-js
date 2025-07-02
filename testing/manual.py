from playwright.sync_api import sync_playwright, Playwright
import os
import subprocess
from datetime import datetime
import time

PORT = 8100

def run(playwright: Playwright):
    chromium = playwright.chromium # or "firefox" or "webkit".
    browser = chromium.launch(headless=False)
    context = browser.new_context(
        ignore_https_errors=True  # Ignore HTTPS errors since we're using a self-signed cert
    )
    page = context.new_page()
    page.goto("https://127.0.0.1:8100", wait_until="domcontentloaded")
    # open playwright browser and bring to front
    page.bring_to_front()

    time.sleep(1000000)
    browser.close()

def create_folders():
    if not os.path.exists('notes'):
        os.makedirs('notes')
        print("Created local 'notes' directory.")

    # Create logs directory if it doesn't exist
    if not os.path.exists('logs'):
        os.makedirs('logs')
        print("Created 'logs' directory.")

    # Create a log file with timestamp
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    log_file = f'logs/server_{timestamp}.log'
    return open(log_file, 'w')

def run_server(log_file):
    server_process = subprocess.Popen(
        ['python', '../simple_server.py', '--port', str(PORT), '--notes-root', 'testing/notes'],
        stdout=log_file,
        stderr=subprocess.STDOUT,
        text=True,
        cwd='..'  # Set working directory to parent where assets are located
    )
    return server_process

def check_server():
    max_retries = 5
    retry_delay = 1  # seconds
    
    for i in range(max_retries):
        try:
            result = subprocess.run(
                ['curl', '-k', f'https://127.0.0.1:{PORT}'],
                capture_output=True,
                text=True,
                timeout=5
            )
            if result.returncode == 0:
                print("Server is responding")
                return True
        except subprocess.TimeoutExpired:
            pass
        
        if i < max_retries - 1:
            print(f"Server not ready, retrying in {retry_delay} seconds...")
            time.sleep(retry_delay)
    
    print("Server failed to respond after multiple attempts")
    return False

def main():
    log_file = create_folders()
    server_process = run_server(log_file)
    try:
        if not check_server():
            print("Exiting due to server unavailability")
            return
            
        with sync_playwright() as playwright:
            run(playwright)
    finally:
        server_process.terminate()

if __name__ == "__main__":
    main()