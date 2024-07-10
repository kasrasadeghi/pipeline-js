# current TODO for compatibility with pipeline python impl
# GET /api/get/<note> - returns raw text of note
# GET /api/list/<repo> - returns a json of all note uuids

# PUT /api/put/<note> - stores the body into the note file

# Python3.7+
import os
import hashlib
import time
import argparse
from datetime import datetime

from kazhttp import HTTP_OK, HTTP_NOT_FOUND, HTTP_OK_JSON, allow_cors_for_localhost, log, run

argparser = argparse.ArgumentParser(description="Run a simple pipeline replication/sync server")
argparser.add_argument("--port", type=int, required=True, help="Port to host the server on")
argparser.add_argument("--notes-root", type=str, help="Root directory for notes", default=os.path.join(os.path.expanduser('~'), "notes"))
argparser.add_argument("--host", type=str, help="Host to bind to", default="")
args = argparser.parse_args()

NOTES_ROOT = args.notes_root
HOST, PORT = args.host, args.port

# provide .removeprefix if it doesn't have it (e.g. python 3.8 on ubuntu 20.04)
if not hasattr(str, 'removeprefix'):
    def removeprefix(self, prefix):
        if self.startswith(prefix):
            return self[len(prefix):]
        return self
    str.removeprefix = removeprefix

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


def handle_api_request(request):
    method = request['method']
    headers = request['headers']
    body = request['body']
    path = request['path']

    assert path.startswith('/api')
    path = path.removeprefix('/api')

    cors_header = allow_cors_for_localhost(headers)

    if path.startswith('/list/') and method == 'GET':
        log(datetime.now(), 'listing notes')
        repo = path.removeprefix('/list/')
        repo_path = get_repo_path(repo)
        return HTTP_OK_JSON(os.listdir(repo_path), extra_header=cors_header)
    elif path.startswith('/get/') and method == 'GET':
        note = path.removeprefix('/get/')

        # consider making this a POST request and putting the uuids in the body as a json.
        # - within the spirit of http, we're "getting" the notes.  we _should_ use a 'GET' request.
        repo_notes = path.removeprefix('/get/')
        # <repo>/<note>(,<note>)*
        repo, notes = repo_notes.split('/', 1)
        notes = notes.split(',')
        repo_path = get_repo_path(repo)
        def read_file(path):
            with open(path) as f:
                return f.read()
        read_notes = {repo + '/' + note: read_file(os.path.join(repo_path, note)) for note in notes}
        return HTTP_OK_JSON(read_notes, extra_header=cors_header)
    elif path.startswith('/put/') and method == 'PUT':
        note = path.removeprefix('/put/')
        log(datetime.now(), note)

        # the note is of format <repo>/<uuid>.note
        if '/' not in note:
            return HTTP_NOT_FOUND(b"bad note: " + note.encode())

        # make folder if repo doesn't exist
        repo, uuid = note.split('/')
        if not os.path.isdir(os.path.join(NOTES_ROOT, repo)):
            os.mkdir(os.path.join(NOTES_ROOT, repo))

        with open(os.path.join(NOTES_ROOT, note), 'wb+') as f:
            f.write(body)
        log(datetime.now(), "wrote notes/" + note)
        return HTTP_OK(b"wrote notes/" + note.encode(), mimetype=b"text/plain")
    
    elif path.startswith('/status/') and method == 'GET':
        repos = path.removeprefix('/status/')
        return compute_status(repos.split(','), headers)
    else:
        return HTTP_NOT_FOUND(b"api not found: " + path.encode() + b" method: " + method.encode())

def handle_request(request):
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
        "style.css",
        "indexed-fs.js",
        "service-worker.js",
    ]

    icons = [
        "favicon.ico",
        "icon512.png",
        "icon192.png",
        "maskable_icon.png",
        "maskable_icon_x192.png"
    ]

    if path == '/sw-index.html':
        path = 'index.html'
        mimetype = b"text/html"
    elif path == "/manifest.json":
        path = "manifest.json"
        mimetype = b"application/manifest+json"
    elif path == "/pipeline-cert.pem":
        path = "cert/cert.pem"
        mimetype = b"application/x-x509-ca-cert"
    elif path.removeprefix("/") in icons:
        path = "icons/" + path.removeprefix("/")
        mimetype = mimetype_table[os.path.splitext(path)[1]]
    elif path.removeprefix("/") in assets:
        path = path.removeprefix("/")
        mimetype = mimetype_table[os.path.splitext(path)[1]]
    elif not path.startswith('/api'):
        path = 'index.html'
        mimetype = b"text/html"

    # Handle API paths

    if path.startswith('/api'):
        return handle_api_request(request)

    # Handle Static paths

    path = path.removeprefix('/')
    if not os.path.exists(path):
        http_response = HTTP_NOT_FOUND(b"could not handle path: " + path.encode())
        return http_response

    with open(path, 'rb') as f:
        content = f.read()
        log(datetime.now(), f"read {path} ({len(content)})")

    http_response = HTTP_OK(content, mimetype)
    # log("RESPONSE:", http_response)
    return http_response


def main():
    print(f"hosting pipeline server on host '{HOST}' and port '{PORT}'")
    print(f"notes root '{NOTES_ROOT}' in home folder '{os.path.expanduser('~')}'")
    run(host=HOST, port=PORT, handle_request=handle_request)


if __name__ == '__main__':
    main()
