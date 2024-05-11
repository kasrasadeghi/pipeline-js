from kazhttp import HTTP_OK, HTTP_NOT_FOUND, HTTP_OK_JSON, allow_cors_for_localhost, receive_headers_and_content, create_server_socket

import sys
import traceback
from datetime import datetime

HOST, PORT = '', int(sys.argv[1])
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

        http_response = HTTP_OK(b'Hello World!', mimetype=b"text/plain")
        print("RESPONSE:", http_response)
        client_connection.sendall(http_response)
        client_connection.close()
    except Exception as e:
        traceback.print_exc()
