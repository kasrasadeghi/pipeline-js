default:
	#python -m http.server
	python simple_server.py

style:
	curl https://10.50.50.2:5000/api/style.css > style.css
