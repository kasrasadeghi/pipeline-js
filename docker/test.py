import os
import shutil
import time
import argparse

from selenium import webdriver
from selenium.common.exceptions import WebDriverException, TimeoutException, NoSuchElementException

from selenium.webdriver.chrome.options import Options as ChromeOptions
from selenium.webdriver.firefox.options import Options as FirefoxOptions

from selenium.webdriver.common.by import By
from selenium.webdriver.common.desired_capabilities import DesiredCapabilities
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import WebDriverWait

parser = argparse.ArgumentParser()
parser.add_argument("--no-docker", default=False, action="store_true", help="Disable Docker")
parser.add_argument("--browser", default="chrome", choices=["chrome", "firefox"], help="Browser to use")
args = parser.parse_args()

if args.no_docker:
    print("Docker option disabled")
else:
    print("Docker option enabled")


print("Starting test script...")


# --- UTILS ------------------------------------------------------------------

def get_pipeline_url():
    if args.no_docker:
        return "https://localhost:8100"
    else:
        return "https://server:5000"

def create_driver():
    print("Setting up WebDriver...")

    if args.browser == 'chrome':
        # Set up Chrome options
        options = ChromeOptions()
        options.add_argument("--no-sandbox")
        options.add_argument("--disable-dev-shm-usage")
        options.add_argument("--ignore-certificate-errors")
        options.add_argument("--ignore-ssl-errors")

        if args.no_docker:
            options.add_argument("--ssl-cert-path=cert/cert.pem")
        else:
            options.add_argument("--ssl-cert-path=/opt/selenium/cert/cert.pem")
    elif args.browser == 'firefox':
        # Set up Firefox options
        options = FirefoxOptions()
        options.add_argument("--ignore-certificate-errors")
        options.add_argument("--ignore-ssl-errors")

    # Set up Selenium WebDriver
    if args.no_docker:
        if args.browser == 'chrome':
            from selenium.webdriver.chrome.service import Service as ChromeService
            from webdriver_manager.chrome import ChromeDriverManager

            driver = webdriver.Chrome(service=ChromeService(ChromeDriverManager().install()), options=options)
        elif args.browser == 'firefox':
            from selenium.webdriver.firefox.service import Service as FirefoxService
            from webdriver_manager.firefox import GeckoDriverManager

            driver = webdriver.Firefox(service=FirefoxService(GeckoDriverManager().install()), options=options)
    else:
        driver = webdriver.Remote(
            command_executor='http://selenium:4444/wd/hub',
            options=options
        )
    print("WebDriver set up successfully.")
    print(f"Browser version: {driver.capabilities['browserVersion']}")
    if args.browser == 'chrome':
        print(f"ChromeDriver version: {driver.capabilities['chrome']['chromedriverVersion'].split(' ')[0]}")
    elif args.browser == 'firefox':
        print(f"GeckoDriver version: {driver.capabilities['moz:geckodriverVersion']}")
    return driver

def browser_wrapper(close = True):
    def decorator(func):
        def wrapper(*args, **kwargs):
            try:
                return func(*args, **kwargs)
            except TimeoutException:
                print("ERROR: Timeout waiting for page to load")
            except WebDriverException as e:
                print(f"WebDriver exception: {str(e)}")
            except AssertionError as e:
                print(f"Test failed: {str(e)}")
            except Exception as e:
                print(f"Test failed: {str(e)}")
        return wrapper
    return decorator

ENTER_KEY = u'\ue007'

def el_id(driver, id):
    try:
        result = driver.find_element(By.ID, id)
        return result
    except NoSuchElementException as e:
        print(f"Element with ID {id} not found")
        result = None
        breakpoint()
        return result

# --- TESTS ------------------------------------------------------------------

@browser_wrapper(close=False)
def test_first_time_setup(driver):

    print("Navigating to Flask app...")
    driver.get(get_pipeline_url())

    element = WebDriverWait(driver, 10).until(
        EC.presence_of_element_located((By.TAG_NAME, "body"))
    )

    # check page source for <title>
    assert "Pipeline" in driver.title

    # pause on uncaught exceptions
    # driver.execute_cdp_cmd("Debugger.enable", {})
    # driver.execute_cdp_cmd("Debugger.setPauseOnExceptions", {"state": "all"})

    time.sleep(1)

    print('Test creating a new repo, sending a message, syncing the note')

    repo_name = "selenium_test"
    # remove folder if it exists
    if os.path.exists('notes/' + repo_name):
        shutil.rmtree('notes/' + repo_name)

    # breakpoint()

    print('type in "selenium_test"')
    el_id(driver, "local_repo_name").send_keys("selenium_test")
    el_id(driver, "local_repo_name_button").click()

    print("click journal button")
    el_id(driver, "journal_button").click()

    # check that page loads
    element = WebDriverWait(driver, 10).until(
        EC.presence_of_element_located((By.TAG_NAME, "body"))
    )

    time.sleep(1)

    # click message input box
    el_id(driver, "msg_input").send_keys("selenium test message")
    el_id(driver, "msg_input").send_keys(ENTER_KEY)

    time.sleep(1)

    # press enter on empty to sync
    el_id(driver, "msg_input").send_keys(ENTER_KEY)

    # get current uuid using javascript
    current_uuid = driver.execute_script("return getCurrentNoteUuid()")

    assert os.path.exists('notes/' + repo_name)
    assert os.path.exists('notes/' + current_uuid)

    time.sleep(1)

    print('Test successful')
    print('Test creating a new message on a new day')
    driver.execute_script("global.mock_now = new Date(); global.mock_now.setDate(global.mock_now.getDate() + 1);")

    el_id(driver, "msg_input").send_keys("selenium testing on a new day")
    el_id(driver, "msg_input").send_keys(ENTER_KEY)

    # Keep the browser open for a while to allow viewing
    time.sleep(2)


# BUG tabs don't synchronize journal creation with other tabs on the same machine
# INVARIANT each machine has a unique journal for each day
# REPRODUCE
# - open 2 tabs (tab A and tab B) on day X
# - both of them should be on the same journal entry, assuming they are opened one after another
# - BUT THEN
# - increment the day for both tabs
# - go to journal in tab A
# - go to journal in tab B
# - RESULT they will be different journal notes.  (see the uuid)
# - HYPOTHESIS this is because the notes are created in the cache and written back to IDB, 
#     but the other tab doesn't rebuild/ check its cache before making a new note.
@browser_wrapper(close=True)
def test_new_day_double_journal(driver):

    # there should already be one tab open on journal X+1 from first time setup

    # open a new tab
    driver.execute_script(f"window.open('{get_pipeline_url()}');")

    element = WebDriverWait(driver, 10).until(
        EC.presence_of_element_located((By.TAG_NAME, "body"))
    )

    # tab A to X+2
    driver.switch_to.window(driver.window_handles[0])
    driver.execute_script("global.mock_now = new Date(); global.mock_now.setDate(global.mock_now.getDate() + 2);")
    driver.execute_script("document.getElementById('journal_button').click();")

    time.sleep(2)

    # tab B to X+2
    driver.switch_to.window(driver.window_handles[1])
    driver.execute_script("global.mock_now = new Date(); global.mock_now.setDate(global.mock_now.getDate() + 2);")
    driver.execute_script("document.getElementById('journal_button').click();")
    time.sleep(1)

    # the two uuids shouldn't be different, but they are
    driver.switch_to.window(driver.window_handles[0])
    tab_a_uuid = driver.execute_script("return getCurrentNoteUuid()")
    driver.switch_to.window(driver.window_handles[1])
    tab_b_uuid = driver.execute_script("return getCurrentNoteUuid()")

    print(tab_a_uuid, tab_b_uuid)
    # assert tab_a_url == tab_b_url

    # press enter to upload
    driver.switch_to.window(driver.window_handles[0])
    el_id(driver, "msg_input").send_keys("tab A, day X+2")
    el_id(driver, "msg_input").send_keys(ENTER_KEY)
    time.sleep(1)

    driver.switch_to.window(driver.window_handles[1])
    el_id(driver, "msg_input").send_keys("tab B, day X+2")
    el_id(driver, "msg_input").send_keys(ENTER_KEY)

    # after they sync, they will converge to the same uuid, but there will be an extra one made for day X+2
    # they'll go to the one that is lexicographically first (3... < a... with hex ordering)

    # we can check the files and see that there are two that have "Title: July 6th, 2024" in them
    for l in os.listdir('notes/selenium_test'):
        count = 0
        with open(f'notes/selenium_test/{l}') as f:
            if "Title: July 6th, 2024" in f.read():
                print(l)
                count += 1
        assert count == 1

    time.sleep(100)


def main():
    driver = create_driver()
    test_first_time_setup(driver)
    test_new_day_double_journal(driver)
    input("Press Enter to continue...")
    driver.quit()
    print("Test script completed.")

if __name__ == "__main__":
    main()
    print("Test script completed.")