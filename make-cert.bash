#!/bin/bash

SERVER_IP=192.73.37.1
public_certificate=cert/cert.pem
private_key=cert/key.pem

mkdir cert/
openssl req -x509 -newkey rsa:4096 -nodes -out ${public_certificate} -keyout ${private_key} -days 365 \
	-subj "/C=US/ST=Washington/L=Seattle/O=kazematics/OU=PipelineSecurity/CN=Pipeline" \
	-addext "subjectAltName=IP:${SERVER_IP}"


