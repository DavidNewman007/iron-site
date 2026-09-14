#!/usr/bin/env python3
"""Локальный сервер для iron-service-site/public (только разработка).

Отдаёт файлы с Cache-Control: no-store. Добавлено 14.09.2026: без этого браузер
держал в кэше js/config.js (он подключён без ?v=), и правка конфига не доезжала
до страницы — выглядело как «код не работает», хотя файл на диске был верный.
"""
import http.server
import os
import socketserver

os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), "public"))

PORT = 3000


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        super().end_headers()


with socketserver.TCPServer(("", PORT), Handler) as httpd:
    print(f"Serving iron-service-site/public at http://localhost:{PORT}")
    httpd.serve_forever()
