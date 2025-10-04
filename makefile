restart:
	sudo systemctl restart pipeline-notes

simple:
	#python -m http.server
	python simple_server.py --port 8000

non_api:
	python simple_server.py --port 8000 --no-api

curltime:
	curl -w "@curl-format.txt" -o /dev/null -s "http://localhost:8000/api/status/core"

deploy:
	scp favicon.ico indexed-fs.js style.css index.html \
		icon512.png icon192.png maskable_icon.png maskable_icon_x192.png \
		manifest.json \
		pubpipe:/web

systemd:
	-[ -f /etc/systemd/system/pipeline-notes.service ] && sudo rm /etc/systemd/system/pipeline-notes.service
	python -c 'import sys; import os; print(open(sys.argv[1]).read().replace("^USER", os.getenv("USER")).replace("^PIPELINE_DIR", os.getcwd()), end="")' \
		pipeline-notes.service | sudo tee /etc/systemd/system/pipeline-notes.service
	sudo systemctl daemon-reload
	sudo systemctl enable pipeline-notes
	-sudo systemctl restart pipeline-notes
	sudo systemctl status pipeline-notes

unsystemd:
	sudo systemctl disable pipeline-notes
	sudo systemctl stop pipeline-notes

.PHONY: logs
logs:
	journalctl -u pipeline-notes -f

llogs:
	journalctl -u pipeline-notes -e

status:
	systemctl status pipeline-notes

certs:
	python gen-certs.py --server-ip 10.50.50.2

.PHONY: proxy
proxy: proxy.cpp
	-killall pipeline-proxy
	g++ -std=c++20 -o pipeline-proxy proxy.cpp -lssl -lcrypto -g
	#nohup ./pipeline-proxy < /dev/null 2>&1 > logs/date.log &
	# ./pipeline-proxy

pl:
	less logs/`ls -Art logs | tail -n 1`

tm:
	bash tmux-debug.sh

sup:
	python supervisor.py &

docker:
	docker-compose up --build --force-recreate

test:
	cd testing && python test_manual.py

test-render:
	cd testing && python test_render.py

test-render-visible:
	cd testing && python test_render.py --visible

server-test:
	python simple_server.py --port 8100 --cert-folder testing/cert --notes-root testing/notes

visual-test:
	cd testing/visual && make test

visual-update:
	cd testing/visual && make update

visual-clean:
	cd testing/visual && make clean

test-all:
	cd testing && python test_manual.py
	cd testing && python test_render.py
	cd testing/visual && make test

clean_test:
	rm -r testing/logs/*.log
	cd testing/visual && make clean

test_client_db:
	python -m pdb -c c test_client.py 10.50.50.2 8000

test_client:
	python test_client.py 10.50.50.2 8000