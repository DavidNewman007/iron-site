from __future__ import annotations

import json
import re
import urllib.request
from datetime import datetime, timezone
from difflib import SequenceMatcher
from pathlib import Path

from .config import CATEGORY_URL_PREFIXES, DR_STORE_BASE, PROBE_DIR, SITEMAP_URL
from .price_parser import Product
from .scraper import scrape_catalog_product


def fetch_sitemap_urls() -> list[str]:
    req = urllib.request.Request(SITEMAP_URL, headers={"User-Agent": "iron-hybrid-pipeline/1.0"})
    with urllib.request.urlopen(req, timeout=90) as resp:
        xml = resp.read().decode("utf-8", errors="replace")
    return re.findall(r"<loc>(https://sochi\.dr-store\.ru[^<]+)</loc>", xml)


def sitemap_cache_path() -> Path:
    PROBE_DIR.mkdir(parents=True, exist_ok=True)
    return PROBE_DIR / "sitemap-cache.json"


def load_sitemap_cache(force_refresh: bool = False) -> list[str]:
    cache_path = sitemap_cache_path()
    if cache_path.exists() and not force_refresh:
        data = json.loads(cache_path.read_text(encoding="utf-8"))
        return data.get("urls", [])

    urls = fetch_sitemap_urls()
    cache_path.write_text(
        json.dumps(
            {
                "fetched_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
                "count": len(urls),
                "urls": urls,
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    return urls


def normalize_match_text(text: str) -> str:
    value = str(text or "").lower()
    value = value.replace("ё", "е")
    value = re.sub(r"[^\w\s/+]", " ", value, flags=re.UNICODE)
    value = re.sub(r"\s+", " ", value).strip()
    replacements = {
        "gb": "gb",
        "tb": "tb",
        "iphone": "iphone",
        "ipad": "ipad",
        "macbook": "macbook",
        "airpods": "airpods",
        "samsung": "samsung",
        "galaxy": "galaxy",
        "watch": "watch",
        "series": "series",
        "esim": "esim",
        "wi-fi": "wifi",
        "wi fi": "wifi",
    }
    for src, dst in replacements.items():
        value = value.replace(src, dst)
    return value


def token_set(text: str) -> set[str]:
    tokens = set(normalize_match_text(text).split())
    stop = {"the", "and", "for", "with", "apple", "a", "j", "hn", "ja", "sim"}
    return {t for t in tokens if len(t) > 1 and t not in stop}


def score_product_url(product: Product, url: str) -> float:
    slug = url.rsplit("/", 1)[-1].lower()
    name_norm = normalize_match_text(product.name)
    slug_norm = normalize_match_text(slug.replace("-", " "))
    name_tokens = token_set(product.name)
    slug_tokens = token_set(slug.replace("-", " "))

    if not name_tokens or not slug_tokens:
        return 0.0

    overlap = len(name_tokens & slug_tokens) / max(len(name_tokens), 1)
    ratio = SequenceMatcher(None, name_norm, slug_norm).ratio()
    score = overlap * 0.65 + ratio * 0.35

    # Category-specific hints
    if product.category == "iphone" and "iphone" not in slug:
        score *= 0.2
    if product.category == "samsung" and "samsung" not in slug and "galaxy" not in slug:
        score *= 0.3
    if product.category == "watch" and "watch" not in slug and "series" not in slug and "ultra" not in slug:
        score *= 0.3
    if product.category == "airpods" and "airpods" not in slug:
        score *= 0.2
    if product.category == "accessories":
        if any(x in slug for x in ("iphone", "ipad", "macbook", "watch")) and not any(
            x in name_norm for x in ("remax", "pitaka", "pencil", "airtag", "mouse", "сзu", "сзу", "стекло")
        ):
            score *= 0.15

    # Storage / color hints from slug
    storage = re.search(r"(\d+)\s*/\s*(\d+)", product.name)
    if storage:
        pair = f"{storage.group(1)}-{storage.group(2)}"
        if pair.replace("-", "") not in slug_norm.replace(" ", ""):
            score *= 0.85
    gb = re.search(r"(\d+)\s*gb", product.name, re.I)
    if gb and gb.group(1) not in slug:
        score *= 0.75

    return score


def candidate_urls(category: str, sitemap_urls: list[str]) -> list[str]:
    prefixes = CATEGORY_URL_PREFIXES.get(category, [])
    urls = []
    for url in sitemap_urls:
        path = url.replace(DR_STORE_BASE, "")
        if not any(path.startswith(prefix) for prefix in prefixes):
            continue
        if path.count("/") < 4:
            continue
        urls.append(url)
    return urls


def find_best_catalog_url(product: Product, sitemap_urls: list[str]) -> tuple[str, float]:
    urls = candidate_urls(product.category, sitemap_urls)
    best_url = ""
    best_score = 0.0
    for url in urls:
        score = score_product_url(product, url)
        if score > best_score:
            best_score = score
            best_url = url
    return best_url, best_score


def probe_category_products(
    products: list[Product],
    *,
    min_score: float = 0.40,
    force_refresh_sitemap: bool = False,
    fetch_details: bool = True,
) -> dict:
    sitemap_urls = load_sitemap_cache(force_refresh=force_refresh_sitemap)
    matches: dict[str, dict] = {}

    for product in products:
        url, score = find_best_catalog_url(product, sitemap_urls)
        entry: dict = {
            "product": {
                "id": product.id,
                "name": product.name,
                "country": product.country,
                "warehouse": product.warehouse,
                "price": product.price,
                "category": product.category,
                "section": product.section,
            },
            "catalog_url": url,
            "score": round(score, 4),
            "status": "matched" if url and score >= min_score else "unmatched",
        }
        if fetch_details and url and score >= min_score:
            try:
                catalog = scrape_catalog_product(url)
                entry["catalog_title"] = catalog.title
                entry["specs"] = [{"key": k, "value": v} for k, v in catalog.specs]
                entry["images_remote"] = catalog.images_remote
            except Exception as exc:  # noqa: BLE001
                entry["status"] = "scrape_error"
                entry["error"] = str(exc)
        matches[product.id] = entry

    return {
        "generated_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "category": products[0].category if products else "",
        "count": len(matches),
        "matches": matches,
    }


def save_probe_result(category: str, payload: dict) -> Path:
    PROBE_DIR.mkdir(parents=True, exist_ok=True)
    path = PROBE_DIR / f"catalog-match-probe-{category}.json"
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return path
