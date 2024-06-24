default:
	docker-compose up --build --force-recreate

certs:
	python ../gen-certs.py --server-name server

venv:
	python3 -m venv venv
	source venv/bin/activate
	pip install -r selenium_requirements.txt

test: venv
	-conda deactivate
	-source venv/bin/activate
	python test.py --no-docker

server:
	docker-compose up --build --force-recreate server