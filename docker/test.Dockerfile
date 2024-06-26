FROM python:3.12-slim

WORKDIR /app

COPY requirements_selenium.txt .
RUN pip install --no-cache-dir -r requirements_selenium.txt

CMD ["python", "test.py"]