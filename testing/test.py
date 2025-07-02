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

def test_first_time_setup(page, context):
    repo_name = "playwright_local_repo_1"
    print(f"\n--- Running test_first_time_setup for local repo: {repo_name} ---")
    first_time_setup(page, context, repo_name)

    msg_input_locator = el_id(page, "msg_input")
    print("Sending initial message...")
    msg_input_locator.fill(f"{repo_name} message")
    msg_input_locator.press("Enter")

    print("Syncing message (pressing Enter on empty input)...")
    msg_input_locator.clear()
    msg_input_locator.press("Enter")

    print("Getting current note UUID via JavaScript...")
    current_uuid = page.evaluate("() => window.getCurrentNoteUuid ? window.getCurrentNoteUuid() : null") # Added check for function existence
    print(f"Current note UUID: {current_uuid}")
    assert current_uuid, "getCurrentNoteUuid() did not return a UUID or is not defined."

    repo_path = os.path.join('notes', repo_name)
    # Assuming current_uuid is a filename or directory name directly under 'notes/'.
    # If it's inside 'notes/repo_name/', path should be os.path.join(repo_path, current_uuid)
    uuid_path = os.path.join('notes', current_uuid) # Or adjust as per your app's structure

    assert os.path.exists(repo_path), f"Local repository directory '{repo_path}' not found."
    assert os.path.exists(uuid_path), f"Local UUID path '{uuid_path}' not found."
    print(f"Verified local existence of '{repo_path}' and '{uuid_path}'.")

    print('Initial setup test successful.')
    print('Testing creating a new message on a new day...')
    page.evaluate("() => { if (window.setNow && window.tomorrow && window.getNow) window.setNow(window.tomorrow(window.getNow())); else console.error('Date functions not found'); }")
    print("Advanced day using JavaScript (if functions available).")

    msg_input_locator.fill(f"{repo_name} on a new day")
    msg_input_locator.press("Enter")
    print("Sent message for the new day.")
    print("--- test_first_time_setup completed ---")

def test_new_day_double_journal(page, context):
    print("\n--- Running test_new_day_double_journal (local tabs) ---")
    tab_a_page = page
    tab_a_page.bring_to_front()

    print("Opening new local tab (Tab B)...")
    with context.expect_page() as new_page_info:
        tab_a_page.evaluate(f"() => window.open('{get_pipeline_url()}', '_blank')")
    tab_b_page = new_page_info.value
    tab_b_page.wait_for_load_state("domcontentloaded")
    print("Tab B opened and loaded locally.")
    assert len(context.pages) >= 2, "Failed to open a new local tab."

    js_set_day_and_click_journal = """
    () => {
        if (window.setNow && window.tomorrow && typeof Date === 'function' && document.getElementById('journal_button')) {
            window.setNow(window.tomorrow(window.tomorrow(new Date())));
            document.getElementById('journal_button').click();
        } else {
            console.error('Required functions/elements for new day journal not found.');
            return false; // Indicate failure
        }
        return true; // Indicate success
    }
    """
    js_get_uuid = "() => window.getCurrentNoteUuid ? window.getCurrentNoteUuid() : null"

    print("In Tab A: Advancing day to X+2 and clicking journal button...")
    tab_a_page.bring_to_front()
    assert tab_a_page.evaluate(js_set_day_and_click_journal), "JS execution failed in Tab A"
    tab_a_page.wait_for_timeout(1000)

    print("In Tab B: Advancing day to X+2 and clicking journal button...")
    tab_b_page.bring_to_front()
    assert tab_b_page.evaluate(js_set_day_and_click_journal), "JS execution failed in Tab B"
    tab_b_page.wait_for_timeout(1000)

    tab_a_page.bring_to_front()
    tab_a_uuid = tab_a_page.evaluate(js_get_uuid)
    print(f"Tab A UUID (for day X+2): {tab_a_uuid}")

    tab_b_page.bring_to_front()
    tab_b_uuid = tab_b_page.evaluate(js_get_uuid)
    print(f"Tab B UUID (for day X+2): {tab_b_uuid}")

    print(f"Comparing UUIDs: Tab A='{tab_a_uuid}', Tab B='{tab_b_uuid}'")
    assert tab_a_uuid == tab_b_uuid, f"UUIDs differ: Tab A '{tab_a_uuid}', Tab B '{tab_b_uuid}'."

    print("Sending message from Tab A (day X+2)...")
    tab_a_page.bring_to_front()
    el_id(tab_a_page, "msg_input").fill("Tab A, day X+2 message")
    el_id(tab_a_page, "msg_input").press("Enter")

    print("Sending message from Tab B (day X+2)...")
    tab_b_page.bring_to_front()
    el_id(tab_b_page, "msg_input").fill("Tab B, day X+2 message")
    el_id(tab_b_page, "msg_input").press("Enter")

    repo_to_check_files = "playwright_local_repo_1" # Should match the repo used in setup
    notes_repo_path = os.path.join('notes', repo_to_check_files)
    time.sleep(2)

    if os.path.exists(notes_repo_path):
        print(f"Checking titles in local directory: {notes_repo_path}")
        titles = set()
        filenames = os.listdir(notes_repo_path)
        for l_filename in filenames:
            filepath = os.path.join(notes_repo_path, l_filename)
            try:
                with open(filepath, 'r', encoding='utf-8') as f:
                    content = f.read()
                    title_parts = content.split("Title: ")
                    if len(title_parts) > 1:
                        titles.add(title_parts[1].split('\n')[0].strip())
            except Exception as e:
                print(f"Error reading or parsing local file {l_filename}: {e}")
        print(f"Found {len(titles)} unique titles out of {len(filenames)} files in '{notes_repo_path}'.")
        assert len(titles) == len(filenames), \
            f"Number of unique titles ({len(titles)}) does not match number of files ({len(filenames)}) in '{notes_repo_path}'."
    else:
        print(f"Warning: Local notes directory '{notes_repo_path}' not found for title check.")
    print("--- test_new_day_double_journal completed ---")

def test_search_duplicates(playwright_instance):
    print("\n--- Running test_search_duplicates (local browsers) ---")
    browser1, context1, page1 = None, None, None
    browser2, context2, page2 = None, None, None

    try:
        print("Launching Local Browser 1 (Chromium)...")
        browser1, context1, page1 = launch_browser_and_context(playwright_instance, "chromium")
        repo1_name = "search_repo_local_chrome"
        first_time_setup(page1, context1, repo1_name)

        print(f"Launching Local Browser 2 ({args.browser})...")
        browser2, context2, page2 = launch_browser_and_context(playwright_instance, args.browser)
        repo2_name = f"search_repo_local_{args.browser}"
        first_time_setup(page2, context2, repo2_name)
        
        num_messages = 5 # Reduced for faster local testing
        print(f"\nSending {num_messages} messages from each local browser...")
        for i in range(num_messages):
            el_id(page1, "msg_input").fill(f"{repo1_name} message: {i}")
            el_id(page1, "msg_input").press("Enter")
            el_id(page2, "msg_input").fill(f"{repo2_name} message: {i}")
            el_id(page2, "msg_input").press("Enter")
            if (i + 1) % 2 == 0: print(f"Sent message pair {i+1}/{num_messages}")
            time.sleep(0.1)

        print(f"\nPerforming search in Local Browser 1 for '{repo1_name}'...")
        el_id(page1, "search_button").click()
        search_query_locator = el_id(page1, "search_query")
        search_query_locator.fill(repo1_name)
        print(f"Search initiated in Local Browser 1. Add assertions to verify results.")
        page1.wait_for_timeout(1000) # Observe

    finally:
        print("\nClosing local browsers for test_search_duplicates...")
        if browser1: browser1.close()
        if browser2: browser2.close()
    print("--- test_search_duplicates completed ---")

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