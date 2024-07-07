FROM python:3.12-slim

WORKDIR /app

CMD ["python", "simple_server.py", "--port", "8100"]