import shutil
import os
from test_util import get_pipeline_url, el_id
import time

def first_time_setup(page, repo_name="playwright_test_local"):
    """
    Performs the initial setup steps for the application locally.
    (Context is passed for potential CDP usage, though not essential if not using CDP).
    """
    print(f"\nNavigating to application for repo: {repo_name}...")
    
    # Set up error listeners before navigation
    all_messages = []

    def handle_console(msg):
        all_messages.append(f"[{msg.type}] {msg.text}")
        if msg.type in ['error', 'warning']:
            print(f"CONSOLE [{msg.type}]: {msg.text}")
    
    def handle_page_error(error):
        all_messages.append(f"[PAGE_ERROR] {error}")
        print(f"PAGE ERROR: {error}")
    
    page.on("console", handle_console)
    page.on("pageerror", handle_page_error)
    
    page.goto(get_pipeline_url(), wait_until="domcontentloaded")

    title = page.title()
    assert "Pipeline" in title, f"Expected 'Pipeline' in title, but got '{title}'"
    print(f"Page title is: {title}")
    
    # Wait a bit for JavaScript to load and initialize
    time.sleep(2)

    print(f"Test: Creating new repo '{repo_name}' locally.")
    
    notes_dir = os.path.join('notes', repo_name)
    if os.path.exists(notes_dir):
        print(f"Removing existing local directory: {notes_dir}")
        shutil.rmtree(notes_dir)

    print(f'Typing in repo name "{repo_name}"...')
    el_id(page, "local_repo_name").fill(repo_name)
    el_id(page, "local_repo_name_button").click()

    # Wait for kazglobal to be initialized before proceeding
    print("Waiting for kazglobal to be ready...")
    time.sleep(2)
    
    # Debug: Check what's available on window
    kazglobal_status = page.evaluate("() => ({ kazglobal: !!window.kazglobal, kazglobalReady: !!window.kazglobalReady, kazglobalNotes: !!(window.kazglobal && window.kazglobal.notes) })")
    print(f"Debug - kazglobal status: {kazglobal_status}")
    
    print("Clicking journal button...")

    # Optional: Local CDP debugging for Chromium
    # if page.context.browser.browser_type.name == "chromium":
    #     try:
    #         cdp_session = page.context.new_cdp_session(page) # Use page's context
    #         cdp_session.send("Debugger.enable")
    #         cdp_session.send("Debugger.setPauseOnExceptions", {"state": "all"})
    #         print("Local CDP Debugger enabled (Chromium only).")
    #     except Exception as e:
    #         print(f"Local CDP setup failed: {e}")
    
    # Click the journal button
    el_id(page, "journal_button").click()
    page.wait_for_load_state("domcontentloaded")
    print("Journal page loaded.")

    # Check for errors that occurred
    errors = [msg for msg in all_messages if 'error' in msg.lower()]
    if errors:
        print(f"JavaScript errors found: {errors}")
        # Don't fail the test, just log the errors for debugging
    else:
        print("No JavaScript errors detected.")
    
    # At the end, print the full console log
    print("=== Browser Console Log ===")
    for line in all_messages:
        print(line)

    return repo_name
    

