import os
import time
from test_util import el_id

def test_message_rendering(page, repo_name):
    """Test that sending a message actually renders it in the discussion view"""
    print(f"\n--- Running test_message_rendering for local repo: {repo_name} ---")
    
    # Wait for the page to load and get to the journal view
    page.wait_for_selector("#msg_input", timeout=10000)
    
    # Ensure we're in the journal view by checking the URL
    current_url = page.url
    print(f"Current URL: {current_url}")
    
    # If we're not in the journal view, navigate there
    if not current_url.endswith('/disc/'):
        print("Not in journal view, navigating to journal...")
        page.evaluate("() => { if (window.gotoJournal) window.gotoJournal(); }")
        page.wait_for_timeout(1000)
        page.wait_for_selector("#msg_input", timeout=10000)
    
    # Get the initial message count
    initial_messages = page.query_selector_all(".msg")
    initial_count = len(initial_messages)
    print(f"Initial message count: {initial_count}")
    
    # Send a test message
    test_message = f"Test message from {repo_name} at {time.time()}"
    print(f"Sending test message: '{test_message}'")
    
    msg_input_locator = el_id(page, "msg_input")
    
    # Debug: Check if the input is visible and enabled
    print(f"Message input visible: {msg_input_locator.is_visible()}")
    print(f"Message input enabled: {msg_input_locator.is_enabled()}")
    
    # Clear any existing content and fill the message
    # For contenteditable divs, we need to use different methods
    msg_input_locator.click()  # Focus the element
    msg_input_locator.evaluate("el => el.innerHTML = ''")  # Clear content
    msg_input_locator.type(test_message)  # Type the message
    
    # Debug: Check the input value
    input_value = msg_input_locator.evaluate("el => el.textContent")
    print(f"Input value after filling: '{input_value}'")
    
    # Press Enter to send
    msg_input_locator.press("Enter")
    
    # Wait a moment for the message to be processed and rendered
    page.wait_for_timeout(2000)
    
    # Debug: Check for any console errors after sending
    console_messages = page.evaluate("() => { return window.consoleMessages || []; }")
    if console_messages:
        print(f"Console messages after sending: {console_messages}")
    
    # Check that the message count increased
    new_messages = page.query_selector_all(".msg")
    new_count = len(new_messages)
    print(f"New message count: {new_count}")
    
    assert new_count > initial_count, f"Message count did not increase. Initial: {initial_count}, New: {new_count}"
    
    # Check that our specific message text appears in the page content
    page_content = page.content()
    assert test_message in page_content, f"Test message '{test_message}' not found in page content"
    
    # Check that the message appears in a .msg element
    message_elements = page.query_selector_all(".msg")
    message_found = False
    for msg_element in message_elements:
        if test_message in msg_element.text_content():
            message_found = True
            print(f"Found message in .msg element: {msg_element.text_content()[:100]}...")
            break
    
    assert message_found, f"Test message '{test_message}' not found in any .msg element"
    
    # Check that the message has the expected structure (timestamp, content, etc.)
    msg_content_elements = page.query_selector_all(".msg_content")
    content_found = False
    for content_element in msg_content_elements:
        if test_message in content_element.text_content():
            content_found = True
            print(f"Found message content in .msg_content element: {content_element.text_content()}")
            break
    
    assert content_found, f"Test message '{test_message}' not found in any .msg_content element"
    
    # Verify the message has a timestamp (should be in .msg_menu)
    msg_menu_elements = page.query_selector_all(".msg_menu")
    assert len(msg_menu_elements) > 0, "No .msg_menu elements found (expected timestamp links)"
    
    # Check that the message is properly formatted with the repo name
    repo_found = False
    for msg_element in message_elements:
        if repo_name in msg_element.text_content():
            repo_found = True
            break
    
    assert repo_found, f"Repository name '{repo_name}' not found in any message element"
    
    print("✅ Message rendering test passed!")
    print("--- test_message_rendering completed ---")
    return True
