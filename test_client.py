import socket
import ssl
import sys

def create_https_connection(host, port=443, failure_point=None):
    # Create a standard socket
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    
    # Wrap the socket with SSL
    context = ssl.create_default_context()
    context.check_hostname = False
    context.verify_mode = ssl.CERT_NONE  # Disable certificate verification (for testing only)
    
    wrapped_socket = context.wrap_socket(sock, server_hostname=host)
    
    try:
        # Connect to the server
        wrapped_socket.connect((host, port))
        print(f"Successfully connected to {host}:{port}")
        
        # Craft a minimal HTTP GET request
        request = f"GET / HTTP/1.1\r\nHost: {host}\r\nConnection: close\r\n\r\n"
        
        if failure_point == "before_send":
            return

        # Send the request
        wrapped_socket.send(request.encode())
        print("Sent HTTP GET request")

        if failure_point == "before_recv":
            return
        
        # Receive the response headers
        headers = b""
        while b"\r\n\r\n" not in headers:
            chunk = wrapped_socket.recv(1024)
            if not chunk:
                break  # Connection closed by the server
            headers += chunk
        
        # Convert headers to string and split into lines
        headers_str = headers.decode('utf-8', errors='ignore')
        header_lines = headers_str.split('\r\n')
        
        # Print the response headers
        print("Received response headers:")
        for line in header_lines:
            print(line)
        
    except ssl.SSLError as e:
        print(f"SSL error occurred: {e}")
    except socket.error as e:
        print(f"Socket error occurred: {e}")
    finally:
        # Close the connection
        wrapped_socket.close()
        print("Connection closed")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python test_client.py <hostname> [port]")
        sys.exit(1)
    
    host = sys.argv[1]
    port = int(sys.argv[2]) if len(sys.argv) > 2 else 443
    
    create_https_connection(host, port)

    create_https_connection(host, port, "before_send")

    create_https_connection(host, port, "before_recv")