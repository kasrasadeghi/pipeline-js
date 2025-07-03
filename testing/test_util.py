def get_pipeline_url():
    return "https://127.0.0.1:8100"

def el_id(page, id):
    """
    Playwright-compatible function to find an element by ID.
    Returns a locator that can be used with .fill(), .click(), etc.
    """
    return page.locator(f"#{id}")