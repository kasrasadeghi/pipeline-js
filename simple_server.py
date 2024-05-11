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
import sys

from kazhttp import HTTP_OK, HTTP_NOT_FOUND, HTTP_OK_JSON, allow_cors_for_localhost, receive_headers_and_content, create_server_socket

NOTES_ROOT = os.path.join(os.path.expanduser('~'), "notes")
HOST, PORT = '', int(sys.argv[1])

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


listen_socket = create_server_socket(HOST, PORT)
while True:
    try:
        print('----------------------------------------')
        client_connection, client_address = listen_socket.accept()
        print(datetime.now(), client_address) # (address: string, port: int)
        request = receive_headers_and_content(client_connection)
        if request is None:
            continue

        method = request['method']
        path = request['path']
        headers = request['headers']
        body = request['body']

        # Handle paths for frontend pages

        mimetype_table = {
            ".html": b"text/html",
            ".css": b"text/css",
            ".js": b"text/javascript",
            ".png": b"image/png",
            ".ico": b"image/x-icon"
        }

        assets = [
            "style.css", "indexed-fs.js", "service-worker.js", 
            "favicon.ico", "icon512.png", "icon192.png", "maskable_icon.png", "maskable_icon_x192.png"
        ]

        if path == '/sw-index.html':
            path = 'index.html'
            mimetype = b"text/html"
        elif path == "/manifest.json":
            path = "manifest.json"
            mimetype = b"application/manifest+json"
        elif path.removeprefix("/") in assets:
            path = path.removeprefix("/")
            mimetype = mimetype_table[os.path.splitext(path)[1]]
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
