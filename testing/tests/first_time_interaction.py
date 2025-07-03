import os
from test_util import el_id

def test_first_time_interaction(page, repo_name):
    print(f"\n--- Running test_first_time_interaction for local repo: {repo_name} ---")

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
    print("--- test_first_time_interaction completed ---")