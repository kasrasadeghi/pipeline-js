import os
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.common.desired_capabilities import DesiredCapabilities
import time
from selenium.common.exceptions import WebDriverException, TimeoutException

print("Starting test script...")

# Set up Chrome options
chrome_options = Options()
chrome_options.add_argument("--no-sandbox")
chrome_options.add_argument("--disable-dev-shm-usage")
chrome_options.add_argument("--ignore-certificate-errors")
chrome_options.add_argument("--ignore-ssl-errors")
chrome_options.add_argument("--ssl-cert-path=/opt/selenium/cert/cert.pem")

print('does cert folder exist?', os.listdir("cert"))

print("Setting up WebDriver...")

# Set up Selenium WebDriver
driver = webdriver.Remote(
    command_executor='http://selenium:4444/wd/hub',
    options=chrome_options
)
print("WebDriver set up successfully.")
print(f"Chrome version: {driver.capabilities['browserVersion']}")
print(f"ChromeDriver version: {driver.capabilities['chrome']['chromedriverVersion'].split(' ')[0]}")

# Wait for the server to be ready
print("Waiting for server to be ready...")
time.sleep(10)

try:
    # Navigate to the Flask app
    print("Navigating to Flask app...")
    driver.get("https://server:5000")

    # check that page loads
    element = WebDriverWait(driver, 10).until(
        EC.presence_of_element_located((By.TAG_NAME, "body"))
    )

    # check page source for <title>
    assert "Pipeline" in driver.title

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