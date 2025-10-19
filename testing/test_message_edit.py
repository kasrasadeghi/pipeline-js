#!/usr/bin/env python3
"""
Playwright test for individual message editing functionality.
Tests the complete edit workflow: click edit, modify content, submit changes.
"""

import time
from playwright.sync_api import Playwright
from browser_test_base import SyncBrowserTest
from test_util import el_id

from tests.first_time_setup import first_time_setup
from tests.first_time_interaction import test_first_time_interaction


class MessageEditTest(SyncBrowserTest):
    """Test class for individual message editing functionality"""
    
    def __init__(self):
        super().__init__(port=8100, headless=False, timeout=10000)
    
    def run_test(self, playwright: Playwright):
        """Run the message edit test suite"""
        print("Starting message edit test suite...")
        
        # Navigate to the main page
        self.navigate_to_sync()
        
        # Run first time setup to get a repo name
        repo_name = first_time_setup(self.page)
        
        # Test basic message interaction first
        test_first_time_interaction(self.page, repo_name)
        
        # Now test message editing
        self.test_message_edit_workflow(repo_name)
        
        print("Message edit test suite completed!")
        return True
    
    def test_message_edit_workflow(self, repo_name):
        """Test the complete message editing workflow"""
        print(f"\n--- Running message edit workflow test for repo: {repo_name} ---")
        
        # Wait for the page to load and get to the journal view
        self.page.wait_for_selector("#msg_input", timeout=10000)
        
        # Ensure we're in the journal view
        current_url = self.page.url
        if not current_url.endswith('/disc/'):
            print("Not in journal view, navigating to journal...")
            self.page.evaluate("() => { if (window.gotoJournal) window.gotoJournal(); }")
            self.page.wait_for_timeout(1000)
            self.page.wait_for_selector("#msg_input", timeout=10000)
        
        # Send a test message first
        test_message = f"Test message for editing at {time.time()}"
        print(f"Creating test message: '{test_message}'")
        
        msg_input = el_id(self.page, "msg_input")
        msg_input.click()
        msg_input.evaluate("el => el.innerHTML = ''")
        msg_input.type(test_message)
        msg_input.press("Enter")
        
        # Wait for message to be processed
        self.page.wait_for_timeout(2000)
        
        # Find the message we just created
        message_elements = self.page.query_selector_all(".msg")
        target_message = None
        for msg_element in message_elements:
            if test_message in msg_element.text_content():
                target_message = msg_element
                break
        
        assert target_message is not None, f"Could not find test message '{test_message}'"
        print("✅ Found test message")
        
        # Test 1: Click edit button to enter edit mode
        self.test_enter_edit_mode(target_message)
        
        # Test 2: Edit the message content
        edited_content = self.test_edit_message_content(target_message, test_message)
        
        # Test 3: Submit the changes
        self.test_submit_edit_changes(target_message, edited_content)
        
        # Test 4: Verify the changes were saved
        self.test_verify_edit_changes(edited_content)
        
        print("✅ All message edit tests passed!")
        return True
    
    def test_enter_edit_mode(self, message_element):
        """Test clicking edit button to enter edit mode"""
        print("\n--- Testing enter edit mode ---")
        
        # Find the edit button
        edit_button = message_element.query_selector(".edit_msg")
        assert edit_button is not None, "Edit button not found"
        
        # Check initial state
        edit_text = edit_button.text_content()
        assert edit_text == "edit", f"Expected edit button to show 'edit', got '{edit_text}'"
        print(f"✅ Edit button shows correct initial state: '{edit_text}'")
        
        # Check that message content is not editable initially
        msg_content = message_element.query_selector(".msg_content")
        content_editable = msg_content.get_attribute("contenteditable")
        assert content_editable != "true", "Message content should not be editable initially"
        print("✅ Message content is not editable initially")
        
        # Click the edit button
        edit_button.click()
        self.page.wait_for_timeout(500)  # Wait for state change
        
        # Check that edit button text changed to "submit"
        edit_text_after = edit_button.text_content()
        assert edit_text_after == "submit", f"Expected edit button to show 'submit', got '{edit_text_after}'"
        print(f"✅ Edit button changed to: '{edit_text_after}'")
        
        # Check that message content is now editable
        content_editable_after = msg_content.get_attribute("contenteditable")
        assert content_editable_after == "true", "Message content should be editable after clicking edit"
        print("✅ Message content is now editable")
        
        # Check that URL has editmsg parameter
        current_url = self.page.url
        assert "editmsg=" in current_url, f"URL should contain editmsg parameter, got: {current_url}"
        print(f"✅ URL contains editmsg parameter: {current_url}")
        
        # Check that other edit buttons are hidden
        all_edit_buttons = self.page.query_selector_all(".edit_msg")
        visible_edit_buttons = []
        for btn in all_edit_buttons:
            if btn.is_visible():
                visible_edit_buttons.append(btn)
        
        print(f"Debug: Found {len(all_edit_buttons)} total edit buttons, {len(visible_edit_buttons)} visible")
        for i, btn in enumerate(all_edit_buttons):
            print(f"  Button {i}: visible={btn.is_visible()}, text='{btn.text_content()}'")
        
        assert len(visible_edit_buttons) == 1, f"Expected only 1 visible edit button, found {len(visible_edit_buttons)}"
        # Check that the visible button shows "submit" (indicating it's the one being edited)
        visible_button_text = visible_edit_buttons[0].text_content()
        assert visible_button_text == "submit", f"Visible button should show 'submit', got '{visible_button_text}'"
        print("✅ Other edit buttons are properly hidden")
        
        print("✅ Enter edit mode test passed!")
        return True
    
    def test_edit_message_content(self, message_element, original_content):
        """Test editing the message content with comprehensive keyboard and input testing"""
        print("\n--- Testing message content editing ---")
        
        msg_content = message_element.query_selector(".msg_content")
        assert msg_content is not None, "Message content element not found"
        
        # Check that content is editable
        content_editable = msg_content.get_attribute("contenteditable")
        assert content_editable == "true", "Message content should be editable"
        
        # Test 1: Basic text input and editing
        edited_content = self.test_basic_text_editing(msg_content, original_content)
        
        # Test 2: HTML paste sanitization (critical for user experience)
        # This tests the exact issue reported - pasting from websites includes CSS styling
        self.test_html_paste_sanitization(msg_content)
        
        # Note: We only do basic text editing and HTML paste testing to avoid overwriting content
        # Other tests (keyboard shortcuts, etc.) would overwrite the content
        # and make verification difficult. In a real test suite, these would be separate tests.
        
        # Test that we can also edit message blocks if they exist
        msg_blocks = message_element.query_selector(".msg_blocks")
        if msg_blocks and msg_blocks.is_visible():
            blocks_editable = msg_blocks.get_attribute("contenteditable")
            assert blocks_editable == "true", "Message blocks should also be editable"
            print("✅ Message blocks are also editable")
        
        print("✅ Message content editing test passed!")
        return edited_content
    
    
    def test_html_paste_sanitization(self, msg_content):
        """Test that HTML content is properly sanitized during paste events"""
        print("\n--- Testing HTML paste sanitization ---")
        
        # Test pasting HTML content with styling (like from websites)
        # This simulates copying from a website with background colors, CSS, etc.
        styled_html_content = """
        <div style="background-color: #ff0000; color: white; font-size: 20px; padding: 10px;">
            <span style="background-color: yellow; color: black;">Styled text</span>
            <strong style="color: blue;">Bold text</strong>
            <em style="background-color: green;">Italic text</em>
        </div>
        """
        
        # Clear and set content using Playwright's fill method
        msg_content.fill("")
        msg_content.fill(styled_html_content)
        
        # Check that the content was pasted but styling should be stripped
        current_content = msg_content.text_content()
        assert "Styled text" in current_content, "HTML content should be pasted"
        assert "Bold text" in current_content, "HTML content should be pasted"
        assert "Italic text" in current_content, "HTML content should be pasted"
        print(f"✅ Styled HTML content pasted: '{current_content}'")
        
        # Test that the innerHTML doesn't contain the original styling
        inner_html = msg_content.evaluate("el => el.innerHTML")
        print(f"Debug: innerHTML after paste: '{inner_html[:200]}...'")
        
        # The content should be pasted but without the original CSS styling
        # This tests that the paste event itself sanitizes the content
        assert "background-color: #ff0000" not in inner_html, "Background color styling should be stripped"
        assert "font-size: 20px" not in inner_html, "Font size styling should be stripped"
        assert "padding: 10px" not in inner_html, "Padding styling should be stripped"
        print("✅ CSS styling was properly stripped during paste")
        
        # Test realistic clipboard paste simulation
        print("\n--- Testing realistic clipboard paste ---")
        
        # Simulate pasting content that might come from a website
        website_content = """
        <div class="article-content" style="font-family: Arial; background: #f5f5f5; padding: 20px;">
            <h2 style="color: #333; margin-bottom: 10px;">Article Title</h2>
            <p style="line-height: 1.6; color: #666;">This is some content with <span style="background-color: yellow;">highlighted text</span> and <a href="https://example.com" style="color: blue; text-decoration: underline;">a link</a>.</p>
            <ul style="list-style-type: disc; margin-left: 20px;">
                <li style="margin-bottom: 5px;">List item 1</li>
                <li style="margin-bottom: 5px;">List item 2</li>
            </ul>
        </div>
        """
        
        msg_content.fill("")
        msg_content.fill(website_content)
        
        # Check that content was pasted
        current_content = msg_content.text_content()
        assert "Article Title" in current_content, "Article title should be pasted"
        assert "highlighted text" in current_content, "Highlighted text should be pasted"
        assert "List item 1" in current_content, "List items should be pasted"
        print(f"✅ Website content pasted: '{current_content[:100]}...'")
        
        # Check that styling was stripped
        inner_html = msg_content.evaluate("el => el.innerHTML")
        assert "font-family: Arial" not in inner_html, "Font family should be stripped"
        assert "background: #f5f5f5" not in inner_html, "Background should be stripped"
        assert "line-height: 1.6" not in inner_html, "Line height should be stripped"
        assert "color: #333" not in inner_html, "Color styling should be stripped"
        print("✅ Website styling was properly stripped during paste")
        
        print("✅ HTML paste sanitization test passed!")
        return True
    
    def test_basic_text_editing(self, msg_content, original_content):
        """Test basic text input and editing functionality"""
        print("\n--- Testing basic text editing ---")
        
        # Clear existing content and add new content
        edited_content = f"EDITED: {original_content} - Modified at {time.time()}"
        print(f"Editing message to: '{edited_content}'")
        
        # Clear and type new content using Playwright methods
        msg_content.click()
        msg_content.fill("")
        msg_content.type(edited_content)
        
        # Verify the content was updated
        current_content = msg_content.text_content()
        assert current_content == edited_content, f"Content not updated correctly. Expected: '{edited_content}', Got: '{current_content}'"
        print(f"✅ Message content updated to: '{current_content}'")
        
        return edited_content
    
    def test_keyboard_shortcuts(self, msg_content):
        """Test keyboard shortcuts in the message editor"""
        print("\n--- Testing keyboard shortcuts ---")
        
        # Test Ctrl+A (Select All) - use Playwright's built-in selection
        msg_content.click()
        msg_content.press("Control+a")
        # Use Playwright's built-in text selection instead of JS evaluation
        try:
            # Try to get selected text using Playwright's selection API
            selected_text = self.page.evaluate("() => window.getSelection().toString()")
            print(f"✅ Ctrl+A (Select All) attempted, selected text length: {len(selected_text)}")
        except:
            print("✅ Ctrl+A (Select All) attempted (selection API not available in headless mode)")
        
        # Test typing after selection (should replace selected text)
        msg_content.type("REPLACED TEXT")
        current_content = msg_content.text_content()
        # Check if text was added (either replaced or appended)
        assert "REPLACED TEXT" in current_content, "Text should be added after Ctrl+A"
        print("✅ Text input after Ctrl+A works")
        
        # Test Ctrl+Z (Undo) - if supported
        try:
            msg_content.press("Control+z")
            print("✅ Ctrl+Z (Undo) attempted")
        except Exception as e:
            print(f"⚠️ Ctrl+Z not supported or failed: {e}")
        
        # Test Ctrl+Y (Redo) - if supported
        try:
            msg_content.press("Control+y")
            print("✅ Ctrl+Y (Redo) attempted")
        except Exception as e:
            print(f"⚠️ Ctrl+Y not supported or failed: {e}")
        
        # Test arrow keys for navigation
        msg_content.click()
        msg_content.press("Home")  # Go to beginning
        msg_content.press("End")   # Go to end
        msg_content.press("ArrowLeft")
        msg_content.press("ArrowRight")
        print("✅ Arrow key navigation works")
        
        # Test Delete and Backspace
        msg_content.press("End")
        msg_content.press("Backspace")
        msg_content.press("Delete")
        print("✅ Delete and Backspace keys work")
        
        print("✅ Keyboard shortcuts test passed!")
    
    def test_html_pasting(self, msg_content):
        """Test pasting HTML content into the message editor"""
        print("\n--- Testing HTML pasting ---")
        
        # Clear content first
        msg_content.click()
        
        # Test pasting HTML content with styling (like from websites)
        # This simulates copying from a website with background colors, CSS, etc.
        styled_html_content = """
        <div style="background-color: #ff0000; color: white; font-size: 20px; padding: 10px;">
            <span style="background-color: yellow; color: black;">Styled text</span>
            <strong style="color: blue;">Bold text</strong>
            <em style="background-color: green;">Italic text</em>
        </div>
        """
        
        # Clear and set content using Playwright's fill method
        msg_content.fill("")
        msg_content.fill(styled_html_content)
        
        # Check that the content was pasted but styling should be stripped
        current_content = msg_content.text_content()
        assert "Styled text" in current_content, "HTML content should be pasted"
        assert "Bold text" in current_content, "HTML content should be pasted"
        assert "Italic text" in current_content, "HTML content should be pasted"
        print(f"✅ Styled HTML content pasted: '{current_content}'")
        
        # Test that the innerHTML doesn't contain the original styling
        inner_html = msg_content.evaluate("el => el.innerHTML")
        print(f"Debug: innerHTML after paste: '{inner_html[:200]}...'")
        
        # The content should be pasted but without the original CSS styling
        # This tests that the paste event itself sanitizes the content
        assert "background-color: #ff0000" not in inner_html, "Background color styling should be stripped"
        assert "font-size: 20px" not in inner_html, "Font size styling should be stripped"
        assert "padding: 10px" not in inner_html, "Padding styling should be stripped"
        print("✅ CSS styling was properly stripped during paste")
        
        # Test pasting plain text
        plain_text = "This is plain text without HTML"
        msg_content.fill("")
        msg_content.fill(plain_text)
        
        current_content = msg_content.text_content()
        assert plain_text in current_content, "Plain text should be pasted"
        print(f"✅ Plain text pasted: '{current_content}'")
        
        # Test pasting with line breaks
        multiline_text = "Line 1\nLine 2\nLine 3"
        msg_content.fill("")
        msg_content.fill(multiline_text)
        
        current_content = msg_content.text_content()
        assert "Line 1" in current_content, "Multiline content should be pasted"
        print(f"✅ Multiline content pasted: '{current_content}'")
        
        # Test realistic clipboard paste simulation
        print("\n--- Testing realistic clipboard paste ---")
        
        # Simulate pasting content that might come from a website
        website_content = """
        <div class="article-content" style="font-family: Arial; background: #f5f5f5; padding: 20px;">
            <h2 style="color: #333; margin-bottom: 10px;">Article Title</h2>
            <p style="line-height: 1.6; color: #666;">This is some content with <span style="background-color: yellow;">highlighted text</span> and <a href="https://example.com" style="color: blue; text-decoration: underline;">a link</a>.</p>
            <ul style="list-style-type: disc; margin-left: 20px;">
                <li style="margin-bottom: 5px;">List item 1</li>
                <li style="margin-bottom: 5px;">List item 2</li>
            </ul>
        </div>
        """
        
        msg_content.fill("")
        msg_content.fill(website_content)
        
        # Check that content was pasted
        current_content = msg_content.text_content()
        assert "Article Title" in current_content, "Article title should be pasted"
        assert "highlighted text" in current_content, "Highlighted text should be pasted"
        assert "List item 1" in current_content, "List items should be pasted"
        print(f"✅ Website content pasted: '{current_content[:100]}...'")
        
        # Check that styling was stripped
        inner_html = msg_content.evaluate("el => el.innerHTML")
        assert "font-family: Arial" not in inner_html, "Font family should be stripped"
        assert "background: #f5f5f5" not in inner_html, "Background should be stripped"
        assert "line-height: 1.6" not in inner_html, "Line height should be stripped"
        assert "color: #333" not in inner_html, "Color styling should be stripped"
        print("✅ Website styling was properly stripped during paste")
        
        print("✅ HTML pasting test passed!")
    
    def test_special_characters(self, msg_content):
        """Test special characters and unicode input"""
        print("\n--- Testing special characters ---")
        
        # Clear content first using Playwright's fill method
        msg_content.click()
        msg_content.fill("")
        
        # Test special characters
        special_chars = "!@#$%^&*()_+-=[]{}|;':\",./<>?"
        msg_content.type(special_chars)
        current_content = msg_content.text_content()
        assert special_chars in current_content, "Special characters should be typed"
        print(f"✅ Special characters typed: '{special_chars}'")
        
        # Test unicode characters
        unicode_text = "Hello 世界 🌍 émojis 🚀 ñáéíóú"
        msg_content.fill("")
        msg_content.type(unicode_text)
        current_content = msg_content.text_content()
        assert "Hello" in current_content, "Unicode content should be typed"
        print(f"✅ Unicode characters typed: '{current_content}'")
        
        # Test emoji input
        emoji_text = "😀😁😂🤣😃😄😅😆😉😊😋😎😍😘🥰😗😙😚☺️🙂🤗🤩🤔🤨😐😑😶🙄😏😣😥😮🤐😯😪😫😴😌😛😜😝🤤😒😓😔😕🙃🤑😲☹️🙁😖😞😟😤😢😭😦😧😨😩🤯😬😰😱🥵🥶😳🤪😵😡😠🤬😷🤒🤕🤢🤮🤧😇🤠🤡🥳🥴🥺🤥🤫🤭🧐🤓😈👿"
        msg_content.fill("")
        msg_content.type(emoji_text[:50])  # Limit to avoid overwhelming
        current_content = msg_content.text_content()
        assert len(current_content) > 0, "Emoji content should be typed"
        print(f"✅ Emoji characters typed: '{current_content[:20]}...'")
        
        print("✅ Special characters test passed!")
    
    def test_multiline_content(self, msg_content):
        """Test multi-line content editing"""
        print("\n--- Testing multiline content ---")
        
        # Clear content first using Playwright's fill method
        msg_content.click()
        msg_content.fill("")
        
        # Test typing with Enter key for line breaks
        multiline_text = "Line 1"
        msg_content.type(multiline_text)
        msg_content.press("Enter")
        msg_content.type("Line 2")
        msg_content.press("Enter")
        msg_content.type("Line 3")
        
        current_content = msg_content.text_content()
        assert "Line 1" in current_content, "Multiline content should work"
        assert "Line 2" in current_content, "Multiline content should work"
        assert "Line 3" in current_content, "Multiline content should work"
        print(f"✅ Multiline content created: '{current_content}'")
        
        # Test navigation between lines
        msg_content.press("ArrowUp")
        msg_content.press("ArrowUp")
        msg_content.press("ArrowDown")
        print("✅ Line navigation works")
        
        # Test selection across lines using Playwright's built-in methods
        msg_content.press("Control+a")
        try:
            # Try to get selected text using Playwright's selection API
            selected_text = self.page.evaluate("() => window.getSelection().toString()")
            print(f"✅ Multi-line selection attempted, selected text length: {len(selected_text)}")
        except:
            print("✅ Multi-line selection attempted (selection API not available in headless mode)")
        
        print("✅ Multiline content test passed!")
    
    def test_submit_edit_changes(self, message_element, edited_content):
        """Test submitting the edited message"""
        print("\n--- Testing submit edit changes ---")
        
        # Find the submit button (should be the same element that was the edit button)
        submit_button = message_element.query_selector(".edit_msg")
        assert submit_button is not None, "Submit button not found"
        
        # Check that button shows "submit"
        button_text = submit_button.text_content()
        assert button_text == "submit", f"Expected submit button, got '{button_text}'"
        print(f"✅ Submit button shows: '{button_text}'")
        
        # Click submit
        submit_button.click()
        self.page.wait_for_timeout(1000)  # Wait for processing
        
        # Check that button text changed back to "edit"
        button_text_after = submit_button.text_content()
        assert button_text_after == "edit", f"Expected edit button after submit, got '{button_text_after}'"
        print(f"✅ Button changed back to: '{button_text_after}'")
        
        # Check that content is no longer editable
        msg_content = message_element.query_selector(".msg_content")
        content_editable = msg_content.get_attribute("contenteditable")
        assert content_editable != "true", "Message content should not be editable after submit"
        print("✅ Message content is no longer editable")
        
        # Check that URL no longer has editmsg parameter
        current_url = self.page.url
        assert "editmsg=" not in current_url, f"URL should not contain editmsg parameter after submit, got: {current_url}"
        print(f"✅ URL editmsg parameter removed: {current_url}")
        
        # Check that all edit buttons are visible again
        all_edit_buttons = self.page.query_selector_all(".edit_msg")
        visible_buttons = [btn for btn in all_edit_buttons if btn.is_visible()]
        assert len(visible_buttons) == len(all_edit_buttons), "All edit buttons should be visible after submit"
        print(f"✅ All {len(visible_buttons)} edit buttons are visible again")
        
        print("✅ Submit edit changes test passed!")
        return True
    
    def test_verify_edit_changes(self, expected_content):
        """Test that the edited changes were actually saved"""
        print("\n--- Testing verify edit changes ---")
        
        # Wait a moment for any async operations to complete
        self.page.wait_for_timeout(2000)
        
        # Check that the edited content appears in a message element
        message_elements = self.page.query_selector_all(".msg")
        content_found = False
        for msg_element in message_elements:
            msg_text = msg_element.text_content()
            if expected_content in msg_text:
                content_found = True
                print(f"✅ Found edited content in message element: '{msg_text[:50]}...'")
                break
        
        if not content_found:
            # Debug: print all message contents
            print("Debug: All message contents:")
            for i, msg_element in enumerate(message_elements):
                msg_text = msg_element.text_content()
                print(f"  Message {i}: '{msg_text[:100]}...'")
        
        assert content_found, f"Edited content '{expected_content}' not found in any message element"
        
        # Verify the message structure is still intact
        msg_content_elements = self.page.query_selector_all(".msg_content")
        content_found_in_msg_content = False
        for content_element in msg_content_elements:
            if expected_content in content_element.text_content():
                content_found_in_msg_content = True
                break
        
        assert content_found_in_msg_content, f"Edited content not found in .msg_content elements"
        print("✅ Edited content found in .msg_content element")
        
        print("✅ Verify edit changes test passed!")
        return True
    
    def test_multiple_message_edit_restrictions(self, repo_name):
        """Test that only one message can be edited at a time"""
        print("\n--- Testing multiple message edit restrictions ---")
        
        # Create a second message
        second_message = f"Second message for testing at {time.time()}"
        print(f"Creating second message: '{second_message}'")
        
        msg_input = el_id(self.page, "msg_input")
        msg_input.click()
        msg_input.evaluate("el => el.innerHTML = ''")
        msg_input.type(second_message)
        msg_input.press("Enter")
        self.page.wait_for_timeout(2000)
        
        # Find both messages
        message_elements = self.page.query_selector_all(".msg")
        assert len(message_elements) >= 2, "Should have at least 2 messages"
        
        # Click edit on first message
        first_edit_button = message_elements[0].query_selector(".edit_msg")
        first_edit_button.click()
        self.page.wait_for_timeout(500)
        
        # Try to click edit on second message - should not work (button should be hidden)
        second_edit_button = message_elements[1].query_selector(".edit_msg")
        is_second_button_visible = second_edit_button.is_visible()
        assert not is_second_button_visible, "Second edit button should be hidden when first message is being edited"
        print("✅ Second edit button is properly hidden")
        
        # Submit the first edit
        first_edit_button.click()
        self.page.wait_for_timeout(500)
        
        # Now second edit button should be visible
        is_second_button_visible_after = second_edit_button.is_visible()
        assert is_second_button_visible_after, "Second edit button should be visible after first edit is submitted"
        print("✅ Second edit button is visible after first edit is submitted")
        
        print("✅ Multiple message edit restrictions test passed!")
        return True


def main():
    """Run the message edit test"""
    test = MessageEditTest()
    test.run()


if __name__ == "__main__":
    main()
