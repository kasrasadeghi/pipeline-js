import os
import shutil
import time
import argparse
import subprocess
import signal
import sys
from playwright.sync_api import sync_playwright, Error as PlaywrightError, TimeoutError as PlaywrightTimeoutError
import pdb # For debugging
from datetime import datetime

# --- Argument Parsing ---
parser = argparse.ArgumentParser()
parser.add_argument("--browser", default="chromium", choices=["chromium", "firefox", "webkit"], help="Browser to use locally (chromium, firefox, webkit)")
parser.add_argument("--server-port", type=int, default=8100, help="Port for the simple server")
args = parser.parse_args()

print("Starting Playwright test script for local execution...")

# --- UTILS ------------------------------------------------------------------

def get_pipeline_url():
    return f"https://127.0.0.1:{args.server_port}"

def launch_browser_and_context(playwright_instance, browser_name_arg):
    """
    Launches the specified browser locally and creates a new context and page.

    Args:
        playwright_instance: The Playwright instance.
        browser_name_arg: Name of the browser to launch ('chromium', 'firefox', 'webkit').

    Returns:
        A tuple (browser, context, page).
    """
    print(f"Setting up local Playwright for {browser_name_arg}...")
    
    browser_launch_options = {
        "headless": False,
        "args": []
    }
    
    context_options = {
        # For handling self-signed or problematic SSL certs on local dev servers
        "ignore_https_errors": True 
    }

    if browser_name_arg == 'chromium':
        browser_launch_options["args"].extend(["--no-sandbox", "--disable-dev-shm-usage"])
        browser_type = playwright_instance.chromium
    elif browser_name_arg == 'firefox':
        browser_type = playwright_instance.firefox
    elif browser_name_arg == 'webkit':
        browser_type = playwright_instance.webkit
    else:
        raise ValueError(f"Unsupported browser: {browser_name_arg}")

    browser = browser_type.launch(**browser_launch_options)
    context = browser.new_context(**context_options)
    page = context.new_page()

    print("Local Playwright browser, context, and page set up successfully.")
    print(f"Browser version: {browser.version}")
    return browser, context, page

def browser_action_wrapper(func):
    """
    A decorator to wrap test functions with common exception handling.
    """
    def wrapper(*args, **kwargs):
        try:
            return func(*args, **kwargs)
        except PlaywrightTimeoutError as e:
            print(f"ERROR: Playwright TimeoutError - {str(e)}")
        except PlaywrightError as e:
            print(f"ERROR: PlaywrightError - {str(e)}")
        except AssertionError as e:
            print(f"ERROR: Test assertion failed - {str(e)}")
            if hasattr(e, '__traceback__'):
                pdb.post_mortem(e.__traceback__)
            else:
                print("Could not get traceback for pdb.post_mortem().")
        except Exception as e:
            print(f"ERROR: An unexpected exception occurred - {str(e)}")
            if hasattr(e, '__traceback__'):
                pdb.post_mortem(e.__traceback__)
            else:
                print("Could not get traceback for pdb.post_mortem().")
    return wrapper

def el_id(page, element_id, timeout=10000):
    """
    Returns a Playwright Locator for the given ID, waiting for it to be attached.
    """
    locator_selector = f"#{element_id}"
    locator = page.locator(locator_selector)
    try:
        locator.wait_for(state="attached", timeout=timeout)
        return locator
    except PlaywrightTimeoutError:
        print(f"Element with ID '{element_id}' not found or not attached within {timeout}ms.")
        raise
# --- TESTS ------------------------------------------------------------------

def first_time_setup(page, context, repo_name="playwright_test_local"):
    """
    Performs the initial setup steps for the application locally.
    (Context is passed for potential CDP usage, though not essential if not using CDP).
    """
    print(f"\nNavigating to application for repo: {repo_name}...")
    breakpoint()
    page.goto(get_pipeline_url())
    breakpoint()
    page.locator("body").wait_for(state="visible", timeout=10000)

    title = page.title()
    assert "Pipeline" in title, f"Expected 'Pipeline' in title, but got '{title}'"
    print(f"Page title is: {title}")

    print(f"Test: Creating new repo '{repo_name}' locally.")
    
    notes_dir = os.path.join('notes', repo_name)
    if os.path.exists(notes_dir):
        print(f"Removing existing local directory: {notes_dir}")
        shutil.rmtree(notes_dir)

    print(f'Typing in repo name "{repo_name}"...')
    el_id(page, "local_repo_name").fill(repo_name)
    el_id(page, "local_repo_name_button").click()

    print("Clicking journal button...")
    el_id(page, "journal_button").click()
    page.locator("body").wait_for(state="visible", timeout=10000)
    print("Journal page loaded.")

    # Optional: Local CDP debugging for Chromium
    # if page.context.browser.browser_type.name == "chromium":
    #     try:
    #         cdp_session = context.new_cdp_session(page) # Use page's context
    #         cdp_session.send("Debugger.enable")
    #         cdp_session.send("Debugger.setPauseOnExceptions", {"state": "all"})
    #         print("Local CDP Debugger enabled (Chromium only).")
    #     except Exception as e:
    #         print(f"Local CDP setup failed: {e}")

def main():
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
    
    # Start the simple server as a subprocess
    server_process = None
    try:
        print(f"Starting simple server on port {args.server_port}...")
        print(f"Server logs will be written to: {log_file}")
        
        with open(log_file, 'w') as log:
            server_process = subprocess.Popen(
                ['python', '../simple_server.py', '--port', str(args.server_port)],
                stdout=log,
                stderr=subprocess.STDOUT,  # Redirect stderr to stdout
                text=True
            )
        
        # Give the server a moment to start
        time.sleep(2)
        
        if server_process.poll() is not None:
            print(f"Server failed to start. Exit code: {server_process.returncode}")
            print(f"Check the log file for details: {log_file}")
            sys.exit(1)

        with sync_playwright() as p:
            browser, context, page = None, None, None
            try:
                print(f"Starting main local tests with browser: {args.browser}")
                browser, context, page = launch_browser_and_context(p, args.browser)
                
                test_first_time_setup(page, context)
                # test_new_day_double_journal(page, context) 

                print("\nMain local single-browser tests completed.")

            except Exception as e:
                print(f"An error occurred during local single-browser tests: {e}")
            finally:
                if browser:
                    print("Closing main local browser instance...")
                    browser.close()
            
            # Run multi-browser test if desired
            # run_multi_browser_test = False # Set to True to run this test
            # if run_multi_browser_test:
            #     try:
            #         print("\nStarting local multi-browser test (test_search_duplicates)...")
            #         test_search_duplicates(p)
            #     except Exception as e:
            #         print(f"An error occurred during local multi-browser test: {e}")
            # else:
            #     print("\nSkipping local multi-browser test (test_search_duplicates). Set 'run_multi_browser_test = True' in main() to run it.")
            
            # print("\nAll scheduled local tests in main() have been attempted.")

    except Exception as e:
        print(f"An error occurred: {e}")
    finally:
        # Clean up the server process
        if server_process:
            print("\nShutting down simple server...")
            server_process.terminate()
            try:
                server_process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                print("Server did not terminate gracefully, forcing...")
                server_process.kill()
            print(f"Server logs are available in: {log_file}")

def ensure_certs_exist():
    # make the folder
    # run the gen-certs.py script to populate the folder if there are no certs in it
    os.makedirs("cert", exist_ok=True)
    if not os.path.exists("cert/cert.pem") or not os.path.exists("cert/key.pem"):
        subprocess.run(["python", "../gen-certs.py", "--server-ip", "127.0.0.1", "--server-name", "localhost"])
    assert os.path.exists("cert/cert.pem") and os.path.exists("cert/key.pem"), "Certs not found"

if __name__ == "__main__":
    ensure_certs_exist()
    main()
    print("\nLocal Playwright test script finished.")