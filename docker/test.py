import os
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.common.desired_capabilities import DesiredCapabilities
import time
from selenium.common.exceptions import WebDriverException, TimeoutException
import argparse

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

try:
    # Navigate to the Flask app
    print("Navigating to Flask app...")
    if args.no_docker:
        driver.get("https://localhost:8100")
    else:
        driver.get("https://server:5000")

    # check that page loads
    element = WebDriverWait(driver, 10).until(
        EC.presence_of_element_located((By.TAG_NAME, "body"))
    )

    # check page source for <title>
    assert "Pipeline" in driver.title

    time.sleep(2)

    # type in "selenium_test"
    driver.find_element(By.ID, "local_repo_name").send_keys("selenium_test")
    driver.find_element(By.ID, "local_repo_name_button").click()

    # click journal button
    driver.find_element(By.ID, "journal_button").click()
    time.sleep(1)
    driver.find_element(By.ID, "journal_button").click()

    # check that page loads
    element = WebDriverWait(driver, 10).until(
        EC.presence_of_element_located((By.TAG_NAME, "body"))
    )

    time.sleep(2)

    # click message input box
    driver.find_element(By.ID, "msg_input").send_keys("selenium test message")
    
    # press enter
    driver.find_element(By.ID, "msg_input").send_keys(u'\ue007')

    # press enter on empty to sync
    driver.find_element(By.ID, "msg_input").send_keys(u'\ue007')

    # Keep the browser open for a while to allow viewing
    time.sleep(30)

except TimeoutException:
    print("Timeout waiting for page to load")
except WebDriverException as e:
    print(f"WebDriver exception: {str(e)}")
except Exception as e:
    print(f"Test failed: {str(e)}")

finally:
    # Close the browser
    print("Closing browser...")
    driver.quit()

print("Test script completed.")