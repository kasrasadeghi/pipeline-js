FROM python:3.9-slim

# Install wget, gnupg, and other dependencies
RUN apt-get update && apt-get install -y wget gnupg curl unzip

# Install Google Chrome
RUN wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | apt-key add - \
    && echo "deb http://dl.google.com/linux/chrome/deb/ stable main" >> /etc/apt/sources.list.d/google.list \
    && apt-get update && apt-get install -y google-chrome-stable

# Install ChromeDriver
# RUN CHROME_VERSION=$(google-chrome --version | awk '{ print $3 }' | cut -d'.' -f1) \
#     && CHROMEDRIVER_VERSION=$(curl -s "https://chromedriver.storage.googleapis.com/LATEST_RELEASE_$CHROME_VERSION") \
#     && wget -N "http://chromedriver.storage.googleapis.com/$CHROMEDRIVER_VERSION/chromedriver_linux64.zip" -P ~/ \
#     && unzip ~/chromedriver_linux64.zip -d ~/ \
#     && rm ~/chromedriver_linux64.zip \
#     && mv -f ~/chromedriver /usr/local/bin/chromedriver \
#     && chown root:root /usr/local/bin/chromedriver \
#     && chmod 0755 /usr/local/bin/chromedriver

RUN pip install --no-cache-dir chromedriver-py>=126

WORKDIR /app

COPY requirements_selenium.txt .
RUN pip install --no-cache-dir -r requirements_selenium.txt

CMD ["python", "test.py"]