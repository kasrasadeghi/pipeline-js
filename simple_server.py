# current TODO for compatibility with pipeline python impl
# GET /api/get/<note> - returns raw text of note
# GET /api/list/<repo> - returns a json of all note uuids

# PUT /api/put/<note> - stores the body into the note file

# Python3.7+
import socket
import os

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

def HTTP_OK(body):
    return b"HTTP/1.1 200 OK\n\n" + body

def HTTP_NOT_FOUND(msg):
    return b"HTTP/1.1 400 NOT_FOUND\n\n HTTP 400:" + msg

listen_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
listen_socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
listen_socket.bind((HOST, PORT))
listen_socket.listen(1)
print(f'Serving HTTP on port {PORT} ...')
while True:
    client_connection, client_address = listen_socket.accept()
    request_data = client_connection.recv(1024)  # TODO receive more?
    first_line, rest = request_data.split(b'\n', 1)

    first_line = first_line.decode("utf-8")
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
        http_response = HTTP_OK(b"Hello, World!\n")
        client_connection.sendall(http_response)
        client_connection.close()
        continue

    # Handle MPA paths

    js_paths = ['disc', 'edit', 'list', 'sync']
    is_js_path = any(path.startswith('/' + js_path) for js_path in js_paths)
    if is_js_path or path == '/' or path == '':
        path = 'index.html'

    # Handle API paths

    if path.startswith('/api'):
        path = path.removeprefix('/api')
        http_response = HTTP_OK(b"""\
The Pipeline API listing:
GET /api/list/<repo>
GET /api/get/<note>
PUT /api/put/<note>
GET /api/status/<repo>
""")

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
            # TODO skip the headers in rest and write the body content to disk
            print(repr(rest))
            if b'\r\n\r\n' in rest:
                headers, body = rest.split(b'\r\n\r\n', 1)
            elif b'\n\n' in rest:
                headers, body = rest.split(b'\n\n', 1)
            else:
                print('empty line before body not found')
                http_response = HTTP_NOT_FOUND(b"empty line between body and headers not found")
                client_connection.sendall(http_response)
                client_connection.close()    
                continue

            content_length_header_line = next(line for line in headers.splitlines() if line.startswith(b'Content-Length'))
            print(content_length_header_line)
            content_length = int(content_length_header_line.removeprefix(b"Content-Length: "))
            body += client_connection.recv(content_length - len(body))
            
            print('body!:', body)
            with open(os.path.join(os.path.expanduser('~'), "notes", note), 'wb+') as f:
                f.write(body)
            http_response = HTTP_OK(b"wrote notes/" + note.encode())
        elif path.startswith('/status/') and method == 'GET':
            repo = path.removeprefix('/status/')
            

        
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
        print('reading', path)
        content = f.read()
    
    http_response = HTTP_OK(content)
    client_connection.sendall(http_response)
    client_connection.close()
