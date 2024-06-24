default:
	docker-compose up --build --force-recreate

certs:
	python ../gen-certs.py --server-name server

test:
	python test.py --no-docker