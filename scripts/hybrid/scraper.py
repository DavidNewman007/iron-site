from __future__ import annotations

import html as html_lib
import re
import urllib.request
from dataclasses import dataclass

from .config import COMPETITOR_PATTERNS, DR_STORE_BASE, SPEC_DROP_KEYS


@dataclass
class CatalogProduct:
    url: str
    title: str
    specs: list[tuple[str, str]]
    images_remote: list[str]


def fetch_url(url: str, timeout: int = 45) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": "iron-hybrid-pipeline/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read().decode("utf-8", errors="replace")


def _clean_text(value: str) -> str:
    text = re.sub(r"<[^>]+>", "", value or "")
    text = html_lib.unescape(text)
    return re.sub(r"\s+", " ", text).strip()


def parse_specs(page_html: str) -> list[tuple[str, str]]:
    specs: list[tuple[str, str]] = []
    seen: set[str] = set()

    patterns = [
        r'details__specifications-table-line">([^<]+)</span>[\s\S]*?<td>([\s\S]*?)</td>',
        r"<td>\s*<small>([^<]+)</small>([^<]+(?:<[^>]+>[^<]*)*?)\s*</td>",
    ]
    for pattern in patterns:
        for match in re.finditer(pattern, page_html, re.I):
            key = _clean_text(match.group(1))
            value = _clean_text(match.group(2))
            if not key or not value:
                continue
            if key.lower() in seen:
                continue
            if "человек" in key.lower() or "сравн" in key.lower():
                continue
            seen.add(key.lower())
            specs.append((key, value))
    return specs


def parse_gallery_images(page_html: str) -> list[str]:
    candidates: dict[str, tuple[str, int]] = {}

    def add(url: str) -> None:
        if not url.startswith("http"):
            url = DR_STORE_BASE + ("" if url.startswith("/") else "/") + url
        if "/image/cache/" not in url:
            return
        if any(x in url.lower() for x in ("logo", "favicon", "mailservice", "/szu/", "remax")):
            return
        size_match = re.search(r"-(\d+)x(\d+)\.", url)
        size = int(size_match.group(1)) if size_match else 0
        base = re.sub(r"-\d+x\d+\.", ".", url)
        prev_size = candidates.get(base, ("", 0))[1]
        if size >= prev_size:
            candidates[base] = (url, size)

    for match in re.finditer(r'https://sochi\.dr-store\.ru/image/cache/[^"\']+', page_html):
        add(match.group(0))

    ordered: list[str] = []
    seen_urls: set[str] = set()
    for url, _size in candidates.values():
        if url in seen_urls:
            continue
        seen_urls.add(url)
        ordered.append(url)

    def sort_key(url: str) -> tuple[int, str]:
        num = re.search(r"-dr-store-(\d+)-", url)
        return (int(num.group(1)) if num else 999, url)

    return sorted(ordered, key=sort_key)


def clean_catalog_title(title: str) -> str:
    text = _clean_text(title)
    text = re.sub(r"\s*—\s*Dr\.?Store\s*$", "", text, flags=re.I)
    text = re.sub(r"\s*в\s+Сочи\s*$", "", text, flags=re.I)
    text = re.sub(r"^Купить\s+", "", text, flags=re.I)
    text = re.sub(r"^Смартфон\s+", "", text, flags=re.I)
    return text.strip()


def parse_page_title(page_html: str) -> str:
    match = re.search(r"<title>([^<]+)</title>", page_html, re.I)
    title = _clean_text(match.group(1)) if match else ""
    og_match = re.search(r'property="og:title"\s+content="([^"]+)"', page_html, re.I)
    if og_match:
        og_title = _clean_text(og_match.group(1))
        if og_title and len(og_title) > len(title):
            title = og_title
    return clean_catalog_title(title)


def sanitize_spec(key: str, value: str) -> tuple[str, str] | None:
    key_clean = _clean_text(key)
    value_clean = _clean_text(value)
    if not key_clean or not value_clean:
        return None
    if key_clean.lower() in SPEC_DROP_KEYS:
        return None
    for pattern in COMPETITOR_PATTERNS:
        if pattern.search(value_clean):
            return None
    return key_clean, value_clean


def sanitize_specs(specs: list[tuple[str, str]]) -> list[tuple[str, str]]:
    cleaned: list[tuple[str, str]] = []
    seen: set[str] = set()
    for key, value in specs:
        item = sanitize_spec(key, value)
        if not item:
            continue
        k, v = item
        lk = k.lower()
        if lk in seen:
            continue
        seen.add(lk)
        cleaned.append((k, v))
    return cleaned


def scrape_catalog_product(url: str) -> CatalogProduct:
    page_html = fetch_url(url)
    title = parse_page_title(page_html)
    og_match = re.search(r'property="og:title"\s+content="([^"]+)"', page_html, re.I)
    if og_match:
        og_title = _clean_text(og_match.group(1))
        if og_title and len(og_title) > len(title):
            title = og_title
    specs = sanitize_specs(parse_specs(page_html))
    images = parse_gallery_images(page_html)
    return CatalogProduct(url=url, title=title, specs=specs, images_remote=images)
