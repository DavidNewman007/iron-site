#!/usr/bin/env python3
import http.server
import os
import socketserver

os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), "public"))

PORT = 3000
Handler = http.server.SimpleHTTPRequestHandler

with socketserver.TCPServer(("", PORT), Handler) as httpd:
    print(f"Serving iron-service-site/public at http://localhost:{PORT}")
    httpd.serve_forever()
