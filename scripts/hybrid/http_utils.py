from __future__ import annotations

import urllib.parse
import urllib.request

DEFAULT_HEADERS = {"User-Agent": "iron-hybrid-pipeline/1.0"}


def encode_url(url: str) -> str:
    """Percent-encode non-ASCII characters in URL paths (Python urllib requires ASCII)."""
    parsed = urllib.parse.urlsplit(url)
    path = urllib.parse.quote(parsed.path, safe="/%:@!$&'()*+,;=-._~")
    query = (
        urllib.parse.quote(parsed.query, safe="=&%:@!$'()*+,;/?~.-_")
        if parsed.query
        else ""
    )
    return urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, path, query, parsed.fragment))


def fetch_bytes(url: str, *, timeout: int = 60) -> bytes:
    safe_url = encode_url(url)
    req = urllib.request.Request(safe_url, headers=DEFAULT_HEADERS)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read()


def fetch_text(url: str, *, timeout: int = 45) -> str:
    return fetch_bytes(url, timeout=timeout).decode("utf-8", errors="replace")
