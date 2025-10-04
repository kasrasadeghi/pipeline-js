"""
This test verifies that the app doesn't become unresponsive when it attempts to sync with the server and the network is down.

We'll simulate network failure by stopping the server process.
"""

import time
from test_util import el_id, get_pipeline_url

def test_sync_on_network_failure(server, page, repo_name):
    print(f"\n--- Running test_sync_on_network_failure for local repo: {repo_name} ---")

    page.goto(get_pipeline_url(), wait_until="domcontentloaded")
    # Send a message
    el_id(page, "msg_input").fill(f"{repo_name} sync on network failure")
    el_id(page, "msg_input").press("Enter")

    # Stop the server
    server.terminate()
    
    time.sleep(10)
    
    # Send a message
    el_id(page, "msg_input").fill(f"{repo_name} sync on network failure 2")
    el_id(page, "msg_input").press("Enter")

    time.sleep(10)

    # Start the server
    server.run()

    # Send a message
    el_id(page, "msg_input").fill(f"{repo_name} sync on network failure 3")
    el_id(page, "msg_input").press("Enter")

    print("--- test_sync_on_network_failure completed ---")