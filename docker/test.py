from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from chromedriver_py import binary_path
import time

print("Starting test script...")

# Set up Chrome options
chrome_options = Options()
chrome_options.add_argument("--headless")
chrome_options.add_argument("--no-sandbox")
chrome_options.add_argument("--disable-dev-shm-usage")

print("Setting up WebDriver...")

# Set up Selenium WebDriver
service = Service(executable_path=binary_path)
driver = webdriver.Chrome(service=service, options=chrome_options)

print("WebDriver set up successfully.")
print(f"Chrome version: {driver.capabilities['browserVersion']}")
print(f"ChromeDriver version: {driver.capabilities['chrome']['chromedriverVersion'].split(' ')[0]}")

# Wait for the server to be ready
print("Waiting for server to be ready...")
time.sleep(10)

try:
    # Navigate to the Flask app
    print("Navigating to Flask app...")
    driver.get("http://server:5000")

    # Wait for the page to load and check if "Hello, World!" is in the page content
    print("Waiting for 'Hello, World!' text...")
    element = WebDriverWait(driver, 10).until(
        EC.text_to_be_present_in_element((By.TAG_NAME, "body"), "Hello, World!")
    )

    if "Hello, World!" in driver.page_source:
        print("Test passed successfully!")
    else:
        print("Test failed: 'Hello, World!' not found in page source.")

except Exception as e:
    print(f"Test failed: {str(e)}")

finally:
    # Close the browser
    print("Closing browser...")
    driver.quit()

print("Test script completed.")