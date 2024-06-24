#!/bin/python

# openssl command
# openssl req -x509 -newkey rsa:4096 -nodes -out ${public_certificate} -keyout ${private_key} -days 365 \
# 	-subj "/C=US/ST=Washington/L=Seattle/O=kazematics/OU=PipelineSecurity/CN=Pipeline" \
# 	-addext "subjectAltName=IP:${SERVER_IP}"


import subprocess
import os

# TODO argparser for server ip

SERVER_IP = "192.73.37.1"
public_certificate = "cert/cert.pem"
private_key = "cert/key.pem"

os.makedirs("cert", exist_ok=True)

subprocess.run([
	"openssl", "req", "-x509", "-newkey", "rsa:4096", "-nodes", 
	"-out", public_certificate,
	"-keyout", private_key, "-days", "365",
	"-subj", "/C=US/ST=Washington/L=Seattle/O=kazematics/OU=PipelineSecurity/CN=Pipeline",
	"-addext", f"subjectAltName=IP:{SERVER_IP}"
])
