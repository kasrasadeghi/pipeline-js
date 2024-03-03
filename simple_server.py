# current TODO for compatibility with pipeline python impl
# GET /api/get/<note> - returns raw text of note
# GET /api/list/<repo> - returns a json of all note uuids

# PUT /api/put/<note> - stores the body into the note file

# Python3.7+
import socket
import os

HOST, PORT = '', 8000

listen_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
listen_socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
listen_socket.bind((HOST, PORT))
listen_socket.listen(1)
print(f'Serving HTTP on port {PORT} ...')
while True:
    client_connection, client_address = listen_socket.accept()
    request_data = client_connection.recv(1024)  # TODO receive more?
    first_line, rest = request_data.decode('utf-8').split('\n', 1)

    print(first_line)
    parts = first_line.split()

    # this almost never happens
    if len(parts) == 2: # GET /disc/bigmac-js/24b1bb0d-3148-4d3d-addb-3b44e4259a8e
        method, path = parts
        httpver = "HTTP/1.1"

    # usually this one happens
    elif len(parts) == 3: # GET /disc/bigmac-js/24b1bb0d-3148-4d3d-addb-3b44e4259a8e HTTP/1.1
        method, path, httpver = parts
    else:
        print('huh')
        method, path, httpver = None, None, None

    if method == None:
        http_response = b"""\
HTTP/1.1 200 OK

Hello, World!
"""
        client_connection.sendall(http_response)
        client_connection.close()
        continue

    # Handle MPA paths

    if path.startswith('/disc') or path.startswith('edit') or path.startswith("/list") or path == '/' or path == '':
        path = 'index.html'

    # Handle API paths

    if path.startswith('/api'):
        path = path.removeprefix('/api')
        http_response = b"""\
HTTP/1.1 200 OK

The Pipeline API listing:
GET /api/list/<repo>
GET /api/get/<note>
PUT /api/put/<note>
"""

        if path.startswith('/list/') and method == 'GET':
            repo = path.removeprefix('/list/')
            print(repo)
            print(rest)
        elif path.startswith('/get/') and method == 'GET':
            note = path.removeprefix('/get/')
            print(note)
            print(rest)
        elif path.startswith('/put/') and method == 'PUT':
            note = path.removeprefix('/put/')
            print(note)
            print(rest)
        
        client_connection.sendall(http_response)
        client_connection.close()
        continue

    # Handle Static paths
    
    path = path.removeprefix('/')
    if not os.path.exists(path):
        http_response = b"""\
HTTP/1.1 400 NOT_FOUND 

HTTP 400: could not handle path: """ + path.encode()
        client_connection.sendall(http_response)
        client_connection.close()    
        continue

    with open(path, 'rb') as f:
        print('reading', path)
        content = f.read()
    
    http_response = b"""\
HTTP/1.1 200 OK

""" + content
    client_connection.sendall(http_response)
    client_connection.close()
