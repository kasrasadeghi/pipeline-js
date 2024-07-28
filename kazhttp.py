from typing import Any, Dict, Optional, Tuple, Callable
import socket
import os
import ssl
import json
from datetime import datetime
import traceback

PACKET_READ_SIZE = 65536  # 2 ^ 16
LISTEN_BACKLOG = 20

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
    
class KazHttpRequest:
    def __init__(self, method: str, path: str, headers: Dict[str, str], body: bytes):
        self.method = method
        self.path = path
        self.headers = headers
        self.body = body


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
    log("awaiting recv data from client connection")
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

    if len(parts) != 3:
        return HTTP_NOT_FOUND(b"bad request line: " + first_line.encode())

    method, path, httpver = parts

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

def create_server_socket(host, port) -> Tuple[socket.socket, ssl.SSLContext]:
    listen_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)

    context = None
    if os.path.exists('cert/cert.pem'):
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.load_cert_chain(certfile="cert/cert.pem", keyfile="cert/key.pem")

    listen_socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    listen_socket.bind((host, port))
    listen_socket.listen(LISTEN_BACKLOG)
    log(f"Serving HTTP{'S' if context else ''} on port {port} ...")
    return listen_socket, context

from contextlib import contextmanager

@contextmanager
def wrap_client_connection(client_connection: socket.socket, context: Optional[ssl.SSLContext]):
    ssl_connection = None
    try:
        if context is not None:
            try:
                ssl_connection = context.wrap_socket(client_connection, server_side=True)
                log("SSL handshake successful")
                yield ssl_connection
            except ssl.SSLError as ssl_err:
                log(f"SSL handshake failed: {ssl_err}")
                raise
        else:
            yield client_connection

    # a bit weird, but these except blocks will catch exceptions thrown in the `with` block of the context manager
    except socket.timeout:
        log('keep-alive connection timed out')
    except Exception as e:
        log("Error handling request:", str(e))
        log("".join(traceback.format_exception(type(e), e, e.__traceback__)))
    finally:
        if ssl_connection:
            try:
                ssl_connection.shutdown(socket.SHUT_RDWR)
                log('shutdown and close SSL connection')
            except Exception as e:
                log("Error shutting down SSL connection:", str(e))
            finally:
                ssl_connection.close()
        client_connection.close()
        log('closed client connection')

def run(host: str, port: int, handle_request: Callable[[dict], KazHttpResponse]) -> None:
    listen_socket, context = create_server_socket(host, port)
    while True:
        try:
            client_connection, client_address = listen_socket.accept()
            log('----------------------------------------')
            log(client_address)
            
            with wrap_client_connection(client_connection, context) as conn:
                while True:
                    request = receive_headers_and_content(conn)
                    if request is None:
                        break

                    http_response = handle_request(request)
                    http_response.write_to(conn)

                    if not http_response.keep_alive:
                        break

                    log('keep-alive, reuse connection')
                    conn.settimeout(5)  # Set a timeout for the next request

        except Exception as e:
            log("Unexpected error in main loop:", str(e))
            log("".join(traceback.format_exception(type(e), e, e.__traceback__)))
