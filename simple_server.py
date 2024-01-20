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
    request_data = client_connection.recv(1024)
    first_line, rest = request_data.decode('utf-8').split('\n', 1)

    print(first_line)
    parts = first_line.split()
    if len(parts) == 2:
        method, path = parts
        httpver = "HTTP/1.1"
    elif len(parts) == 3:
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

    path = path.removeprefix("/")
    if path in ('', 'disc', 'edit'):
        path = 'index.html'
    
    if not os.path.exists(path):
        http_response = b"""\
HTTP/1.1 400 NOT_FOUND

"""
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
