from __future__ import annotations

import html as html_lib
import re
from dataclasses import dataclass

from .config import (
    COMPETITOR_PATTERNS,
    DR_STORE_BASE,
    SPEC_DROP_KEY_PATTERNS,
    SPEC_DROP_KEYS,
)
from .http_utils import fetch_text
from .image_selection import select_product_images


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


def parse_gallery_images(page_html: str) -> list[str]:
    """Backward-compatible wrapper; prefer select_product_images()."""
    return select_product_images("", "", page_html)


def scrape_catalog_product(
    url: str,
    *,
    category: str = "",
    product_name: str = "",
    seed_images: list[str] | None = None,
) -> CatalogProduct:
    page_html = fetch_url(url)
    title = parse_page_title(page_html)
    og_match = re.search(r'property="og:title"\s+content="([^"]+)"', page_html, re.I)
    if og_match:
        og_title = _clean_text(og_match.group(1))
        if og_title and len(og_title) > len(title):
            title = og_title
    title = clean_catalog_title(title)
    specs = sanitize_specs(parse_specs(page_html))
    images = select_product_images(category, product_name, page_html, url, seed_images)
    return CatalogProduct(url=url, title=title, specs=specs, images_remote=images)


def clean_catalog_title(title: str) -> str:
    text = _clean_text(title)
    text = re.sub(r"Dr\.?-?Store", "", text, flags=re.I)
    text = re.sub(r"\s*\|\s*", " — ", text)
    text = re.sub(r"\s*—\s*(?:цена|цены|характеристик|доставк|интернет-магазин)[^—]*$", "", text, flags=re.I)
    text = re.sub(r"\s*—\s*[^—]+$", "", text)  # trailing SEO clause after em dash
    text = re.sub(r"\s+в\s+(?:Сочи|Краснодар(?:е)?|Москве|СПб|Санкт-Петербурге)\s*", " ", text, flags=re.I)
    text = re.sub(r"\s+в\s+(?:Сочи|Краснодар(?:е)?|Москве)\s*$", "", text, flags=re.I)
    text = re.sub(r"^Купить\s+(?:смартфон\s+)?", "", text, flags=re.I)
    text = re.sub(r"^Смартфон\s+", "", text, flags=re.I)
    text = re.sub(r"\s+в\s*$", "", text)
    text = re.sub(r"\s+в\s*…\s*$", "", text)
    return re.sub(r"\s+", " ", text).strip(" -—|")


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
    # Гарантия поставщика — не наша гарантия, см. SPEC_DROP_KEY_PATTERNS.
    for pattern in SPEC_DROP_KEY_PATTERNS:
        if pattern.search(key_clean):
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
