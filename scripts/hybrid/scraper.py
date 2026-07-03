from __future__ import annotations

import html as html_lib
import re
from dataclasses import dataclass

from .config import COMPETITOR_PATTERNS, DR_STORE_BASE, SPEC_DROP_KEYS
from .http_utils import fetch_text


@dataclass
class CatalogProduct:
    url: str
    title: str
    specs: list[tuple[str, str]]
    images_remote: list[str]


def fetch_url(url: str, timeout: int = 45) -> str:
    return fetch_text(url, timeout=timeout)


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


def parse_og_image(page_html: str) -> str | None:
    match = re.search(r'property="og:image"\s+content="([^"]+)"', page_html, re.I)
    if not match:
        return None
    url = match.group(1).strip()
    if not url.startswith("http"):
        url = DR_STORE_BASE + ("" if url.startswith("/") else "/") + url
    return url


def _product_gallery_prefix(page_url: str) -> str | None:
    path = page_url.replace(DR_STORE_BASE, "").strip("/")
    parts = path.split("/")
    if len(parts) < 2:
        return None
    return f"/{'/'.join(parts[:-1])}/"


def _image_base(url: str) -> str:
    return re.sub(r"-\d+x\d+\.", ".", url)


def _image_size(url: str) -> int:
    size_match = re.search(r"-(\d+)x(\d+)\.", url)
    return int(size_match.group(1)) if size_match else 0


def _normalize_cache_url(url: str) -> str:
    if not url.startswith("http"):
        url = DR_STORE_BASE + ("" if url.startswith("/") else "/") + url
    return url


def parse_gallery_images(page_html: str, *, page_url: str = "") -> list[str]:
    gallery_prefix = _product_gallery_prefix(page_url) if page_url else None
    ordered_bases: list[str] = []
    best_by_base: dict[str, tuple[str, int]] = {}

    def consider(url: str) -> None:
        url = _normalize_cache_url(url)
        if "/image/cache/" not in url:
            return
        if any(x in url.lower() for x in ("logo", "favicon", "mailservice", "/szu/", "remax")):
            return
        path_part = url.replace(DR_STORE_BASE, "")
        if gallery_prefix and gallery_prefix not in path_part:
            return
        base = _image_base(url)
        size = _image_size(url)
        if base not in best_by_base:
            ordered_bases.append(base)
            best_by_base[base] = (url, size)
        elif size > best_by_base[base][1]:
            best_by_base[base] = (url, size)

    for match in re.finditer(r"https://sochi\.dr-store\.ru/image/cache/[^\"'\s<>]+", page_html):
        consider(match.group(0))

    ordered = [best_by_base[base][0] for base in ordered_bases]

    og_image = parse_og_image(page_html)
    if og_image:
        og_base = _image_base(og_image)
        cover = best_by_base.get(og_base, (og_image, 0))[0]
        ordered = [cover] + [url for url in ordered if _image_base(url) != og_base]

    return ordered


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
    images = parse_gallery_images(page_html, page_url=url)
    return CatalogProduct(url=url, title=title, specs=specs, images_remote=images)
