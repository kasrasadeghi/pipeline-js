from kazhttp import HTTP_OK, run

import sys

def handle_request(request):
    return HTTP_OK(b'Hello World!', mimetype=b"text/plain")

HOST, PORT = '', int(sys.argv[1])
run(host=HOST, port=PORT, handle_request=handle_request)

