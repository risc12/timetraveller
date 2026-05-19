"""Static server with SPA fallback: any path that isn't a real file serves index.html."""
import http.server
import os
import socketserver

PORT = 8000
ROOT = os.path.dirname(os.path.abspath(__file__))


class SPA(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        target = self.translate_path(self.path)
        if not os.path.exists(target) or os.path.isdir(target) and not os.path.exists(os.path.join(target, "index.html")):
            self.path = "/index.html"
        return super().do_GET()


if __name__ == "__main__":
    os.chdir(ROOT)
    with socketserver.TCPServer(("", PORT), SPA) as httpd:
        print(f"serving on http://localhost:{PORT}")
        httpd.serve_forever()
