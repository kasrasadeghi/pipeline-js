
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
