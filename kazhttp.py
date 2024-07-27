from typing import Any, Dict, Tuple, Callable
import socket
import os
import ssl
import json
from datetime import datetime
import traceback

PACKET_READ_SIZE = 65536  # 2 ^ 16

def log(*k):
    print(datetime.now(), *k, flush=True)

class KazHttpResponse:
    def __init__(self, status: bytes, body: bytes, mimetype: bytes = b"text/plain", keep_alive: bool = False, extra_headers: bytes = b""):
        self.status = status
        self.mimetype = mimetype
        self.body = body
        self.keep_alive = keep_alive
        self.extra_headers = b""

    def write_to(self, connection: socket.socket):
        connection.sendall(
            b"HTTP/1.1 " b"\n"
          + (b"Connection: keep-alive\n" if self.keep_alive else b"Connection: close\n")
          + b"Content-Type: " + self.mimetype + b"; charset=utf-8\n"
          + self.extra_headers
          + b"Content-Length: " + str(len(self.body)).encode() + b"\n"
          + b"\n"
          + self.body
        )

def HTTP_OK(body: bytes, mimetype: bytes, keep_alive: bool = False) -> bytes:
    return KazHttpResponse(b"200 OK", body, keep_alive=keep_alive, mimetype=mimetype)

def HTTP_OK_JSON(obj: Any, extra_header=b"", keep_alive: bool = False) -> bytes:
    return KazHttpResponse(b"200 OK", json.dumps(obj).encode('utf-8'), mimetype=b"application/json", keep_alive=keep_alive, extra_headers=extra_header)

def HTTP_NOT_FOUND(msg, keep_alive: bool = False) -> bytes:
    return KazHttpResponse(b"400 NOT_FOUND", "HTTP 400:" + msg + b"\n", keep_alive=keep_alive, mimetype=b"text/plain")

def allow_cors_for_localhost(headers: Dict[str, str]):
    if 'Origin' in headers:
        log(headers['Origin'])
        if 'localhost' == headers['Origin'].split("//", 1)[1].split(":", 1)[0]:
            return b"Access-Control-Allow-Origin: " + headers['Origin'].encode() + b"\n"
    return b""

def receive_headers_and_content(client_connection: socket.socket) -> Dict[str, Any]:
    log("receiving data from client connection")
    try:
        request_data = client_connection.recv(PACKET_READ_SIZE)
    except socket.timeout:
        log('timeout')
        return None
    
    if len(request_data) == 0:
        retry_count = 5
        while True:
            more = client_connection.recv(PACKET_READ_SIZE)
            request_data += more
            if len(more) == 0:
                retry_count -= 1
            if retry_count == 0:
                raise Exception("ERROR: retried 5 times, got 0 bytes every time, giving up.  didn't receive any data.")
            if len(request_data) > 0:
                break
            

    if len(request_data) == PACKET_READ_SIZE and request_data.startswith(b"GET "):  # only support long 'GET's for now
        log('MORE: requesting more')
        while True:  # TODO make this a generator and only get more when we actually need it
            more = client_connection.recv(PACKET_READ_SIZE)
            log('received', len(more), 'bytes')
            log("got MORE:\n", more)
            request_data += more
            if request_data.startswith(b"GET ") and request_data.endswith(b"\r\n\r\n"):
                log('got all the data')
                break
            if len(more) == 0:
                break
    try:
        first_line, rest = request_data.split(b'\n', 1)
    except ValueError as e:
        log("ERROR: couldn't split request_data into first_line and rest:", request_data)
        raise e

    log(first_line)
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
        log('ERROR: empty line before body not found')
        http_response = HTTP_NOT_FOUND(b"empty line between body and headers not found")
        client_connection.sendall(http_response)
        client_connection.close()    
        return None

    headers = [line.split(': ', 1) for line in headers.decode().splitlines()]
    headers = {key.lower(): value for key, value in headers}

    for header in ["user-agent", "sec-ch-ua-platform", "referer", "connection"]:
        if header in headers:
            log("-", header, ":", headers[header])
    
    connection = None
    if "connection" in headers and headers["connection"] == "keep-alive":
        client_connection.settimeout(5)
        connection = "keep-alive"

    if 'content-length' in headers:
        content_length = int(headers['content-length'])
        retry_count = 5
        while content_length - len(body) > 0:
            log(f'{len(body)=} {content_length=}')
            more = client_connection.recv(content_length - len(body))
            body += more
            if len(more) == 0:
                retry_count -= 1
            if retry_count == 0:
                raise Exception("ERROR: retried 5 times, got 0 bytes every time, giving up.  body doesn't match content-length header.")
        log(f'{len(body)=} {content_length=}')
    return {'method': method, 'path': path, 'httpver': httpver, 'headers': headers, 'body': body, "connection": connection}

def create_server_socket(host, port) -> Tuple[socket.socket, bool]:  # bool is True iff https/ ssl
    # socket.setdefaulttimeout(5)  # 5 second timeouts by default
    raw_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)

    https = False
    if os.path.exists('cert/cert.pem'):
        https = True
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.load_cert_chain(certfile="cert/cert.pem", keyfile="cert/key.pem")
        listen_socket = context.wrap_socket(raw_socket, server_side=True)
    else:
        listen_socket = raw_socket

    listen_socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    listen_socket.bind((host, port))
    listen_socket.listen(20)
    log(f"Serving HTTP{'S' if https else ''} on port {port} ...")
    return listen_socket, https


def run(host: str, port: int, handle_request: Callable[[dict], KazHttpResponse]) -> None:
    listen_socket, https = create_server_socket(host, port)
    while True:
        client_connection, client_address = listen_socket.accept()
        log('----------------------------------------')
        log(client_address) # (address: string, port: int)
        
        try:
            while True:
                request = receive_headers_and_content(client_connection)
                if request is None:
                    break

                http_response = handle_request(request)
                http_response.write_to(client_connection)

                if request.get("connection") != "keep-alive":
                    break

                log('keep-alive, re-use accepted connection')
                client_connection.settimeout(5)  # Set a timeout for the next request
        
        except socket.timeout:
            log('keep-alive connection timed out')
        except Exception as e:
            log(" ".join(traceback.format_exc().splitlines()))
        finally:
            try:
                client_connection.shutdown(socket.SHUT_RDWR)
            except Exception as e:
                pass
            log('shutdown and close connection')
            client_connection.close()