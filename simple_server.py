# current TODO for compatibility with pipeline python impl
# GET /api/get/<note> - returns raw text of note
# GET /api/list/<repo> - returns a json of all note uuids

# PUT /api/put/<note> - stores the body into the note file

# Python3.7+
import socket
import os
import hashlib
import json
import time
import ssl
import traceback
from datetime import datetime

NOTES_ROOT = os.path.join(os.path.expanduser('~'), "notes")

HOST, PORT = '', 8000

redirect = """
 <html xmlns="http://www.w3.org/1999/xhtml">    
  <head>      
    <title>The Tudors</title>      
    <meta http-equiv="refresh" content="0;URL='http://thetudors.example.com/'" />    
  </head>    
  <body> 
    <p>This page has moved to a <a href="http://thetudors.example.com/">
      theTudors.example.com</a>.</p> 
  </body>  
</html>   
"""

def HTTP_OK(body: bytes, mimetype: bytes) -> bytes:
    return (b"HTTP/1.1 200 OK\n"
          + b"Content-Type: " + mimetype + b"; charset=utf-8\n"
          + b"\n"
          + body)

def HTTP_OK_JSON(obj, extra_header=b"") -> bytes:
    return (b"HTTP/1.1 200 OK\n"
        + b"Content-Type: application/json; charset=utf-8\n"
        + extra_header
        + b"\n"
        + json.dumps(obj).encode('utf-8') + b"\n")

def HTTP_NOT_FOUND(msg):
    return b"HTTP/1.1 400 NOT_FOUND\n\n HTTP 400:" + msg

def get_repo_path(repo):
    return os.path.join(NOTES_ROOT, repo)

def compute_status(repos, headers) -> "http_response":
    def hash(note_path):
        with open(note_path, "rb") as f:
            return hashlib.sha256(f.read()).hexdigest()
    
    def hash_repo(repo):
        repo_path = get_repo_path(repo)
        if not os.path.isdir(repo_path):
            return {}
        else:
            return {os.path.join(repo, uuid): hash(os.path.join(repo_path, uuid)) for uuid in os.listdir(repo_path)}

    for repo in repos:
        if '/' in repo or '..' in repo:
            return HTTP_NOT_FOUND(b"bad repo: " + repo.encode())
    
    cors_header = allow_cors_for_localhost(headers)
    if len(repos) == 1:
        status = hash_repo(repo)
        return HTTP_OK_JSON(status, extra_header=cors_header)
    else:
        status = {repo: hash_repo(repo) for repo in repos}
        return HTTP_OK_JSON(status, extra_header=cors_header)


def allow_cors_for_localhost(headers):
    if 'Origin' in headers:
        from urllib.parse import urlparse
        print(headers['Origin'])
        if 'localhost' == headers['Origin'].split("//", 1)[1].split(":", 1)[0]:
            return b"Access-Control-Allow-Origin: " + headers['Origin'].encode() + b"\n"
    return b""

def receive_headers_and_content(client_connection):
    request_data = client_connection.recv(1024)  # TODO receive more?
    if len(request_data) == 1024 and request_data.startswith(b"GET "):  # only support long 'GET's for now
        print('requesting more')
        while True:  # TODO make this a generator and only get more when we actually need it
            more = client_connection.recv(1024)
            if request_data.startswith(b"GET ") and more.endswith(b"\r\n\r\n"):
                request_data += more
                break
            if len(more) == 0:
                break
            print(f'receiving more, {len(more)} bytes')
            print("MORE:\n", more)
            request_data += more
    first_line, rest = request_data.split(b'\n', 1)

    print(first_line)
    first_line = first_line.decode("utf-8")
    parts = first_line.split()

    # this almost never happens
    if len(parts) == 2: # GET /disc/bigmac-js/24b1bb0d-3148-4d3d-addb-3b44e4259a8e
        method, path = parts
        httpver = "HTTP/1.1"

    # usually this one happens
    elif len(parts) == 3: # GET /disc/bigmac-js/24b1bb0d-3148-4d3d-addb-3b44e4259a8e HTTP/1.1
        method, path, httpver = parts
    else:
        method, path, httpver = None, None, None

    if method == None:
        http_response = HTTP_OK(b"Hello, World!\n", mimetype=b"text/plain")
        client_connection.sendall(http_response)
        client_connection.close()
        return
    
    # TODO keep getting more until it's empty?

    # parse headers, newline, then body
    if b'\r\n\r\n' in rest:
        headers, body = rest.split(b'\r\n\r\n', 1)
    elif b'\n\n' in rest:
        headers, body = rest.split(b'\n\n', 1)
    else:
        print('ERROR: empty line before body not found')
        http_response = HTTP_NOT_FOUND(b"empty line between body and headers not found")
        client_connection.sendall(http_response)
        client_connection.close()    
        return

    headers = [line.split(': ', 1) for line in headers.decode().splitlines()]
    headers = {key: value for key, value in headers}
    print(headers)
    if 'Content-Length' in headers:
        content_length = int(headers['Content-Length'])
        while content_length - len(body) > 0:
            print(f'{len(body)=} {content_length=}')
            body += client_connection.recv(content_length - len(body))
        print(f'{len(body)=} {content_length=}')
    return {'method': method, 'path': path, 'httpver': httpver, 'headers': headers, 'body': body}


raw_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)

if os.path.exists('../pipeline/cert/cert.pem'):
    context = ssl.create_default_context(ssl.Purpose.CLIENT_AUTH)
    context.load_cert_chain(certfile="../pipeline/cert/cert.pem", keyfile="../pipeline/cert/key.pem")
    listen_socket = context.wrap_socket(raw_socket, server_side=True)
else:
    listen_socket = raw_socket

listen_socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
listen_socket.bind((HOST, PORT))
listen_socket.listen(1)
print(f'Serving HTTP on port {PORT} ...')
while True:
    try:
        client_connection, client_address = listen_socket.accept()
        print('----------------------------------------')
        print(datetime.now(), client_address) # (address: string, port: int)
        request = receive_headers_and_content(client_connection)
        if request is None:
            continue

        method = request['method']
        path = request['path']
        headers = request['headers']
        body = request['body']

        # Handle paths for frontend pages

        if path == "/style.css":
            path = "style.css"
            mimetype = b"text/css"
        elif path == "/indexed-fs.js":
            path = "indexed-fs.js"
            mimetype = b"text/javascript"
        elif path == '/service-worker.js':
            path = "service-worker.js"
            mimetype = b"text/javascript"
        elif path == '/sw-index.html':
            path = 'index.html'
            mimetype = b"text/html"
        elif path == '/manifest.json':
            path = 'manifest.json'
            mimetype = b"application/manifest+json"
        elif path == '/favicon.ico':
            path = 'favicon.ico'
            mimetype = b"image/x-icon"
        elif path == '/icon512.png':
            path = 'icon512.png'
            mimetype = b"image/png"
        elif not path.startswith('/api'):
            path = 'index.html'
            mimetype = b"text/html"

        # Handle API paths

        if path.startswith('/api'):
            path = path.removeprefix('/api')
            if path.startswith('/list/') and method == 'GET':
                print('listing notes')
                repo = path.removeprefix('/list/')
                repo_path = get_repo_path(repo)
                cors_header = allow_cors_for_localhost(headers)
                http_response = HTTP_OK_JSON(os.listdir(repo_path), extra_header=cors_header)
                client_connection.sendall(http_response)
                client_connection.close()
                continue
            elif path.startswith('/get/') and method == 'GET':
                note = path.removeprefix('/get/')

                # consider making this a POST request and putting the uuids in the body as a json.
                # - maybe not, though.  i like not parsing the content of the body here, but i might just be being lazy.
                # - also like, within the spirit of http, we're "getting" the notes.  we _should_ use a 'GET' request.
                repo_notes = path.removeprefix('/get/')
                # <repo>/<note>(,<note>)*
                repo, notes = repo_notes.split('/', 1)
                notes = notes.split(',')
                repo_path = get_repo_path(repo)
                def read_file(path):
                    with open(path) as f:
                        return f.read()
                read_notes = {repo + '/' + note: read_file(os.path.join(repo_path, note)) for note in notes}
                cors_header = allow_cors_for_localhost(headers)
                http_response = HTTP_OK_JSON(read_notes, extra_header=cors_header)
                client_connection.sendall(http_response)
                client_connection.close()
                continue
            elif path.startswith('/put/') and method == 'PUT':
                note = path.removeprefix('/put/')
                print(note)

                # the note is of format <repo>/<uuid>.note
                if '/' not in note:
                    http_response = HTTP_NOT_FOUND(b"bad note: " + note.encode())
                    client_connection.sendall(http_response)
                    client_connection.close()
                    continue

                # make folder if repo doesn't exist
                repo, uuid = note.split('/')
                if not os.path.isdir(os.path.join(NOTES_ROOT, repo)):
                    os.mkdir(os.path.join(NOTES_ROOT, repo))

                with open(os.path.join(NOTES_ROOT, note), 'wb+') as f:
                    f.write(body)
                http_response = HTTP_OK(b"wrote notes/" + note.encode(), mimetype=b"text/plain")
                print("wrote notes/" + note, time.time())
                client_connection.sendall(http_response)
                client_connection.close()
                continue
            elif path.startswith('/status/') and method == 'GET':
                repos = path.removeprefix('/status/')
                http_response = compute_status(repos.split(','), headers)
                client_connection.sendall(http_response)
                client_connection.close()
                continue
            else:
                http_response = HTTP_NOT_FOUND(b"api not found: " + path.encode())
                client_connection.sendall(http_response)
                client_connection.close()
                continue


        # Handle Static paths

        path = path.removeprefix('/')
        if not os.path.exists(path):
            http_response = HTTP_NOT_FOUND(b"could not handle path: " + path.encode())
            client_connection.sendall(http_response)
            client_connection.close()    
            continue

        with open(path, 'rb') as f:
            content = f.read()
            print(f"read {path} ({len(content)})")

        http_response = HTTP_OK(content, mimetype)
        # print("RESPONSE:", http_response)
        client_connection.sendall(http_response)
        client_connection.close()
    except Exception as e:
        traceback.print_exc()
