from typing import Any, Dict, Tuple, Callable
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
        self.extra_headers = extra_headers
    
    def to_bytes(self):
        return (
            b"HTTP/1.1 " + self.status + b"\r\n"
            + (b"Connection: keep-alive\n" if self.keep_alive else b"Connection: close\r\n")
            + b"Content-Type: " + self.mimetype + b"; charset=utf-8\r\n"
            + self.extra_headers
            + b"Content-Length: " + str(len(self.body)).encode() + b"\r\n"
            + b"\r\n"
            + self.body)

    def write_to(self, connection: socket.socket):
        response_bytes = self.to_bytes()
        log("sending", len(response_bytes), "bytes")
        connection.sendall(response_bytes)
    
class KazHttpRequest:
    def __init__(self, method: str, path: str, headers: Dict[str, str], body: bytes):
        self.method = method
        self.path = path
        self.headers = headers
        self.body = body


def HTTP_OK(body: bytes, mimetype: bytes, keep_alive: bool = False, extra_headers=b"") -> bytes:
    return KazHttpResponse(b"200 OK", body, keep_alive=keep_alive, mimetype=mimetype, extra_headers=extra_headers)

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
    try:
        request_data = client_connection.recv(PACKET_READ_SIZE)
        log("received", len(request_data), "bytes")
    except socket.timeout:
        log('timeout before receiving data')
        return None
    
    if len(request_data) == 0:
        log('no data received')
        return None

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


def run(host: str, port: int, handle_request: Callable[[dict], KazHttpResponse]) -> None:
    import select
    listen_socket, context = create_server_socket(host, port)
    listen_socket.setblocking(False)
    inputs = [listen_socket]
    
    while True:
        try:
            readable, _, _ = select.select(inputs, [], [], 1.0)
            for sock in readable:
                log(f'-----------------------')
                if sock is listen_socket:
                    log('accepting new connection')
                    try:
                        sock.settimeout(1)
                        client_connection, client_address = sock.accept()
                    except socket.timeout:
                        log('listen_socket timeout')
                        continue
                    log(client_address)
                    
                    if context:
                        try:
                            client_connection = context.wrap_socket(client_connection, server_side=True, do_handshake_on_connect=False)
                            client_connection.do_handshake()
                            log(f"SSL handshake successful with {client_address}")
                        except ssl.SSLError as ssl_err:
                            log(f"SSL handshake failed with {client_address}: {ssl_err}")
                            client_connection.close()
                            continue
                        except ConnectionResetError as conn_err:
                            log(f"SSL handshake failed with {client_address}: {conn_err}")
                            client_connection.close()
                            continue
                        except Exception as e:
                            log(f"SSL handshake failed with {client_address}, general error: {e}")
                            client_connection.close()
                            continue
                    
                    inputs.append(client_connection)
                    log('added new input, inputs now:', len(inputs))
                else:
                    try:
                        log('reading new data on', sock.getpeername())
                    except OSError as e:
                        log('ERROR:', e)
                        inputs.remove(sock)
                        sock.close()
                        continue
                    try:
                        request = receive_headers_and_content(sock)
                        if request is None:
                            log('closing connection', sock.getpeername(), len(inputs), "(no request received)")
                            inputs.remove(sock)
                            sock.close()
                            continue
                        
                        http_response = handle_request(request)

                        if request['connection'] == 'keep-alive':
                            http_response.keep_alive = True

                        http_response.write_to(sock)
                        
                        if not http_response.keep_alive:
                            log('closing connection', sock.getpeername(), len(inputs), "(no keep-alive)")
                            inputs.remove(sock)
                            sock.close()
                        else:
                            log('keep-alive, reusing connection', sock.getpeername())
                        
                    except Exception as e:
                        log(f"Error handling request: {str(e)}")
                        log("".join(traceback.format_exception(e)))
                        try:
                            inputs.remove(sock)
                            sock.close()
                        except Exception as e:
                            log(f"Error closing socket: {str(e)}")
        
        except Exception as e:
            log("Error in main loop")
            log("".join(traceback.format_exception(e)))
            break