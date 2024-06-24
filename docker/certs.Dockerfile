# Use a Python base image
FROM python:3.12-slim

# Install OpenSSL
RUN apt-get update && apt-get install -y openssl

# Set the working directory
WORKDIR /app

# Run the gen-certs.py script
# - uses "server" as the DNS name, provided by docker-compose.yml
CMD ["python", "gen-certs.py", "--server-name", "server"]
