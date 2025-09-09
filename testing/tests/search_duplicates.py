
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
