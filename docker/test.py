import os
import shutil
import time
import argparse

from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.common.desired_capabilities import DesiredCapabilities
from selenium.common.exceptions import WebDriverException, TimeoutException, NoSuchElementException

parser = argparse.ArgumentParser()
parser.add_argument("--no-docker", default=False, action="store_true", help="Disable Docker")
args = parser.parse_args()

if args.no_docker:
    print("Docker option disabled")
else:
    print("Docker option enabled")


print("Starting test script...")

# Set up Chrome options
chrome_options = Options()
chrome_options.add_argument("--no-sandbox")
chrome_options.add_argument("--disable-dev-shm-usage")
chrome_options.add_argument("--ignore-certificate-errors")
chrome_options.add_argument("--ignore-ssl-errors")

if args.no_docker:
    chrome_options.add_argument("--ssl-cert-path=cert/cert.pem")
else:
    chrome_options.add_argument("--ssl-cert-path=/opt/selenium/cert/cert.pem")

print("Setting up WebDriver...")

# Set up Selenium WebDriver
if args.no_docker:
    driver = webdriver.Chrome(options=chrome_options)
else:
    driver = webdriver.Remote(
        command_executor='http://selenium:4444/wd/hub',
        options=chrome_options
    )
print("WebDriver set up successfully.")
print(f"Chrome version: {driver.capabilities['browserVersion']}")
print(f"ChromeDriver version: {driver.capabilities['chrome']['chromedriverVersion'].split(' ')[0]}")

# --- UTILS ------------------------------------------------------------------

def get_pipeline_url():
    if args.no_docker:
        return "https://localhost:8100"
    else:
        return "https://server:5000"

def browser_wrapper(func):
    def wrapper(*args, **kwargs):
        try:
            return func(*args, **kwargs)
        except TimeoutException:
            print("ERROR: Timeout waiting for page to load")
        except WebDriverException as e:
            print(f"WebDriver exception: {str(e)}")
        except Exception as e:
            print(f"Test failed: {str(e)}")
        finally:
            # Close the browser
            print("Closing browser...")
            driver.quit()
    return wrapper

ENTER_KEY = u'\ue007'

# --- TESTS ------------------------------------------------------------------

@browser_wrapper
def test_first_time_setup():

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

    time.sleep(2)

    print('Test creating a new repo, sending a message, syncing the note')

    repo_name = "selenium_test"
    # remove folder if it exists
    if os.path.exists('notes/' + repo_name):
        shutil.rmtree('notes/' + repo_name)

    def el_id(id):
        try:
            result = driver.find_element(By.ID, id)
            return result
        except NoSuchElementException as e:
            print(f"Element with ID {id} not found")
            result = None
            breakpoint()
            return result

    # type in "selenium_test"
    el_id("local_repo_name").send_keys("selenium_test")
    el_id("local_repo_name_button").click()

    # click journal button
    el_id("journal_button").click()

    # check that page loads
    element = WebDriverWait(driver, 10).until(
        EC.presence_of_element_located((By.TAG_NAME, "body"))
    )

    time.sleep(2)

    # click message input box
    el_id("msg_input").send_keys("selenium test message")
    el_id("msg_input").send_keys(ENTER_KEY)

    time.sleep(1)

    # press enter on empty to sync
    el_id("msg_input").send_keys(ENTER_KEY)

    # get current uuid using javascript
    current_uuid = driver.execute_script("return getCurrentNoteUuid()")

    assert os.path.exists('notes/' + repo_name)
    assert os.path.exists('notes/' + current_uuid)

    time.sleep(2)

    print('Test successful')
    print('Test creating a new message on a new day')
    driver.execute_script("global.mock_now = new Date(); global.mock_now.setDate(global.mock_now.getDate() + 1);")

    el_id("msg_input").send_keys("selenium testing on a new day")
    el_id("msg_input").send_keys(ENTER_KEY)

    # Keep the browser open for a while to allow viewing
    time.sleep(30)

@browser_wrapper
def test_new_day_double_journal():
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

    # open another tab and set the day one more day in the future
    driver.execute_script("window.open('https://server:5000');")
    driver.switch_to.window(driver.window_handles[1])
    driver.execute_script("global.mock_now = new Date(); global.mock_now.setDate(global.mock_now.getDate() + 2);")


def main():
    test_first_time_setup()
    input()
    test_new_day_double_journal()
    print("Test script completed.")