#!/bin/python

# openssl command
# openssl req -x509 -newkey rsa:4096 -nodes -out ${public_certificate} -keyout ${private_key} -days 365 \
# 	-subj "/C=US/ST=NewYork/L=NewYork/O=kazematics/OU=PipelineSecurity/CN=Pipeline" \
# 	-addext "subjectAltName=IP:${SERVER_IP}"


import subprocess
import os
import argparse

# argparser for server ip
argparser = argparse.ArgumentParser()
argparser.add_argument("--server-ip", type=str)
argparser.add_argument("--server-name", type=str)
args = argparser.parse_args()

assert args.server_ip or args.server_name, "Please provide either --server-ip or --server-name"

if args.server_ip:
	subjectAltName = f"subjectAltName=IP:{args.server_ip}"
else:
	subjectAltName = f"subjectAltName=DNS:{args.server_name}"

public_certificate = "cert/cert.pem"
private_key = "cert/key.pem"

os.makedirs("cert", exist_ok=True)

if os.path.exists(public_certificate) and os.path.exists(private_key):
	print("certificates already exist")
else:
	subprocess.run([
		"openssl", "req", "-x509", "-newkey", "rsa:4096", "-nodes", 
		"-out", public_certificate,
		"-keyout", private_key, "-days", "365",
		"-subj", "/C=US/ST=NewYork/L=NewYork/O=kazematics/OU=PipelineSecurity/CN=Pipeline",
		"-addext", subjectAltName,
	])