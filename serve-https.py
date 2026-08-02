#!/usr/bin/env python3
"""Serve Fauci Pies over HTTPS on all interfaces for Mac + iOS LAN preview."""
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
import ssl
import sys

ROOT = Path(__file__).resolve().parent
DEFAULT_PORT = 8850
CERT = ROOT / ".local-cert.pem"
KEY = ROOT / ".local-key.pem"


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        path = (self.path or "").split("?", 1)[0].lower()
        if path.endswith(
            (
                ".png",
                ".jpg",
                ".jpeg",
                ".webp",
                ".ico",
                ".webmanifest",
                ".svg",
            )
        ) or path.endswith("manifest.webmanifest"):
            self.send_header("Cache-Control", "public, max-age=86400")
        else:
            self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        super().end_headers()

    def log_message(self, fmt, *args):
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))


def _lan_ips():
    ips = []
    try:
        import socket

        hostname = socket.gethostname()
        for info in socket.getaddrinfo(hostname, None, socket.AF_INET):
            ip = info[4][0]
            if ip and not ip.startswith("127.") and ip not in ips:
                ips.append(ip)
    except Exception:
        pass
    return ips


def main():
    mode = "https"
    argv = [a for a in sys.argv[1:] if a]
    port = DEFAULT_PORT
    if argv and argv[0] in ("--http", "http"):
        mode = "http"
        argv = argv[1:]
    if argv:
        port = int(argv[0])

    httpd = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    lan = _lan_ips()
    lan_hint = lan[0] if lan else "<this-mac-ip>"

    if mode == "https":
        if not CERT.exists() or not KEY.exists():
            print("Missing .local-cert.pem / .local-key.pem", file=sys.stderr)
            sys.exit(1)
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ctx.load_cert_chain(certfile=str(CERT), keyfile=str(KEY))
        httpd.socket = ctx.wrap_socket(httpd.socket, server_side=True)
        print("Fauci Pies HTTPS", flush=True)
        print(f"  Mac:    https://127.0.0.1:{port}/", flush=True)
        print(f"  iOS:    https://{lan_hint}:{port}/", flush=True)
        print("  Self-signed: tap Advanced → proceed on first visit.")
    else:
        print("Fauci Pies HTTP (A2HS icon test)")
        print(f"  Mac:    http://127.0.0.1:{port}/")
        print(f"  iOS:    http://{lan_hint}:{port}/")

    print(f"  Dir:    {ROOT}")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nstopped")


if __name__ == "__main__":
    main()
