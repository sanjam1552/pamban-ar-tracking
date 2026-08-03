import http.server
import ssl
import socket

# Get local IP address dynamically
def get_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(('10.255.255.255', 1))
        IP = s.getsockname()[0]
    except Exception:
        IP = '127.0.0.1'
    finally:
        s.close()
    return IP

ip_addr = get_ip()
server_address = ('0.0.0.0', 8000)
handler = http.server.SimpleHTTPRequestHandler
httpd = http.server.HTTPServer(server_address, handler)

# Bind SSL Context
context = ssl.SSLContext(ssl.PROTOCOL_TLS)
context.load_cert_chain(certfile='cert.pem', keyfile='key.pem')
httpd.socket = context.wrap_socket(httpd.socket, server_side=True)

print(f"\n=======================================================")
print(f"Secure WebAR server is running!")
print(f"Access on your Computer: https://localhost:8000")
print(f"Access on your Mobile Phone: https://{ip_addr}:8000")
print(f"=======================================================\n")

httpd.serve_forever()
