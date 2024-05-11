from typing import Any, Dict
import socket
import os
import ssl
import json

def HTTP_OK(body: bytes, mimetype: bytes) -> bytes:
    return (b"HTTP/1.1 200 OK\n"
          + b"Content-Type: " + mimetype + b"; charset=utf-8\n"
          + b"\n"
          + body)

def HTTP_OK_JSON(obj: Any, extra_header=b"") -> bytes:
    return (b"HTTP/1.1 200 OK\n"
        + b"Content-Type: application/json; charset=utf-8\n"
        + extra_header
        + b"\n"
        + json.dumps(obj).encode('utf-8') + b"\n")

def HTTP_NOT_FOUND(msg):
    return b"HTTP/1.1 400 NOT_FOUND\n\n HTTP 400:" + msg


def allow_cors_for_localhost(headers: Dict[str, str]):
    if 'Origin' in headers:
        from urllib.parse import urlparse
        print(headers['Origin'])
        if 'localhost' == headers['Origin'].split("//", 1)[1].split(":", 1)[0]:
            return b"Access-Control-Allow-Origin: " + headers['Origin'].encode() + b"\n"
    return b""

def receive_headers_and_content(client_connection: socket.socket) -> Dict[str, Any]:
    print("receiving data from client connection")
    try:
        request_data = client_connection.recv(1024)  # TODO receive more?
    except socket.timeout:
        print('timeout')
        return None
    
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
        return None
    
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
        return None

    headers = [line.split(': ', 1) for line in headers.decode().splitlines()]
    headers = {key: value for key, value in headers}

    for key, value in headers.items():
        print("-", key, ":", value)
    
    if 'Content-Length' in headers:
        content_length = int(headers['Content-Length'])
        while content_length - len(body) > 0:
            print(f'{len(body)=} {content_length=}')
            body += client_connection.recv(content_length - len(body))
        print(f'{len(body)=} {content_length=}')
    return {'method': method, 'path': path, 'httpver': httpver, 'headers': headers, 'body': body}

def create_server_socket(host, port) -> socket.socket:
    # socket.setdefaulttimeout(5)  # 5 second timeouts by default
    raw_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)

    https = False
    if os.path.exists('cert/cert.pem'):
        https = True
        context = ssl.create_default_context(ssl.Purpose.CLIENT_AUTH)
        context.load_cert_chain(certfile="cert/cert.pem", keyfile="cert/key.pem")
        listen_socket = context.wrap_socket(raw_socket, server_side=True)
    else:
        listen_socket = raw_socket

    listen_socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    listen_socket.bind((host, port))
    listen_socket.listen(1)
    print(f"Serving HTTP{'S' if https else ''} on port {port} ...")
    return listen_socket