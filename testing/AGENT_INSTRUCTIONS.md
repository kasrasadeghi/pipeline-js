# Testing Agent Instructions

**BE CONCISE. Match existing styles and conventions. Focus on essential patterns only.**

## Core Requirements
- Test ALL user interactions, not just basic functionality
- Include comprehensive keyboard/input testing
- Test HTML pasting, special chars, unicode, emojis
- Verify state management (single edit restriction, button toggles, URL params)
- **Match existing code style and conventions**

## Test Structure
```python
class TestName(SyncBrowserTest):
    def __init__(self):
        super().__init__(port=8100, headless=False, timeout=10000)
    
    def run_test(self, playwright: Playwright):
        # Test orchestration
        pass
```

## Key Elements
- `.msg` - Message container
- `.msg_content` - Editable content
- `.edit_msg` - Edit/submit button
- URL param: `?editmsg=<msg_id>`

## Patterns
```python
from test_util import el_id
msg_input = el_id(page, "msg_input")
page.wait_for_selector("#msg_input", timeout=10000)
assert condition, f"Expected: {expected}, Got: {actual}"
```

## Style Requirements
- Follow existing test structure and naming conventions
- Use same print statement format: `print("✅ Test passed!")`
- Match existing docstring style
- Follow existing error handling patterns
- Use same assertion message format

**Keep it brief. Match existing style. Test comprehensively.**
