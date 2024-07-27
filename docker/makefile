SHELL := /bin/bash

default:
	docker-compose up --build --force-recreate

certs:
	python ../gen-certs.py --server-name server

venv:
	python3 -m venv venv

pip_install: venv
	-source venv/bin/activate && pip install -r requirements_selenium.txt

test: venv
	-source venv/bin/activate && python test.py --no-docker

firefox: venv
	-source venv/bin/activate && python test.py --no-docker --browser firefox

server:
	docker-compose up --build --force-recreate server

raw_server:
	cd .. && python simple_server.py --port 8100 --host 127.0.0.1 --notes-root docker/notes