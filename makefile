restart:
	sudo systemctl restart pipeline-notes

default:
	#python -m http.server
	python simple_server.py

style:
	curl https://10.50.50.2:5000/api/style.css > style.css

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

logs:
	journalctl -u pipeline-notes -f

llogs:
	journalctl -u pipeline-notes

status:
	systemctl status pipeline-notes
