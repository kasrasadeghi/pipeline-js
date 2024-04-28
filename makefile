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
	scp 404.html indexed-fs.js style.css index.html pubpipe:/web

systemd:
	sudo cp pipeline-notes.service /etc/systemd/system/
	sudo systemctl daemon-reload
	sudo systemctl enable pipeline-notes
	sudo systemctl restart pipeline-notes
	sudo systemctl status pipeline-notes

logs:
	journalctl -u pipeline-notes -f
