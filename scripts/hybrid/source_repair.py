"""Repair hybrid card sources: re-mirror images, reorder covers, bootstrap missing sources."""
from __future__ import annotations

import json
import re
from typing import Any

from .config import load_image_map
from .image_selection import (
    demote_shared_lineup_tail,
    filter_accessory_images,
    filter_phone_product_images,
    fix_iphone_lineup_cover,
    fix_macbook_cover_order,
    fix_watch_cover_order,
    parse_product_image_hints,
)
from .images import mirror_images
from .manifest import html_path, load_manifest, load_source, save_source
from .scraper import scrape_catalog_product

MIN_GALLERY_IMAGES: dict[str, int] = {
    "iphone": 3,
    "samsung": 3,
    "macbook": 2,
    "ipad": 2,
    "watch": 2,
    "fitbit": 2,
    "airpods": 2,
    "accessories": 1,
}


def refresh_source_from_catalog(source: dict[str, Any]) -> dict[str, Any]:
    url = source.get("catalog_url")
    if not url:
        raise RuntimeError(f"No catalog_url in source for {source.get('product_id')}")
    catalog = scrape_catalog_product(
        url,
        category=str(source.get("category") or ""),
        product_name=str(source.get("name") or ""),
    )
    source["catalog_title"] = catalog.title
    source["specs"] = [{"key": k, "value": v} for k, v in catalog.specs]
    source["images_remote"] = catalog.images_remote
    return source

KNOWN_ACCESSORY_IMAGES: dict[str, list[str]] = {
    "-magic-mouse-3-black-s2-10500": [
        "https://sochi.dr-store.ru/image/cache/catalog/new%20products/"
        "Apple_Magic_Mouse_3_Wireless_Mouse_USB-C_Black/"
        "Apple_Magic_Mouse_3_Wireless_Mouse_USB-C_Black-1200x1200.jpg"
    ],
    "-magic-mouse-3-white-s2-9400": [
        "https://sochi.dr-store.ru/image/cache/catalog/new%20products/"
        "Apple_Magic_Mouse_3_Wireless_Mouse_USB-C_White/"
        "Apple_Magic_Mouse_3_Wireless_Mouse_USB-C_White-1200x1200.jpg"
    ],
    "-сзу-apple-20w-mhje3zm-a-s2-2300": [
        "https://sochi.dr-store.ru/image/cache/catalog/new%20products/"
        "Apple_USB-C_Power_Adapter_20W_white/"
        "Apple_USB-C_Power_Adapter_20W_white-1200x1200.jpg"
    ],
}

KNOWN_ACCESSORY_CATALOG_URLS: dict[str, str] = {
    "-magic-mouse-3-black-s2-10500": "https://sochi.dr-store.ru/apple/apple-gadgets/apple-mouse/Apple_Magic_Mouse_3_Wireless_Mouse_USB-C_Black",
    "-magic-mouse-3-white-s2-9400": "https://sochi.dr-store.ru/apple/apple-gadgets/apple-mouse/Apple_Magic_Mouse_3_Wireless_Mouse_USB-C_White",
    "-сзу-apple-20w-mhje3zm-a-s2-2300": "https://sochi.dr-store.ru/accessories/apple-usb-c-power-adapter-20w",
}


def remote_urls_from_local(local_paths: list[str], image_map: dict[str, str]) -> list[str]:
    local_to_remote: dict[str, str] = {}
    for remote, local in image_map.items():
        if local not in local_to_remote:
            local_to_remote[local] = remote
    result: list[str] = []
    for path in local_paths:
        rel = path.replace("../../", "").lstrip("/")
        remote = local_to_remote.get(rel) or local_to_remote.get(f"assets/{rel.split('assets/', 1)[-1]}")
        if remote:
            result.append(remote)
    return result


def reorder_remote_urls(category: str, name: str, catalog_url: str, remote_urls: list[str]) -> list[str]:
    if not remote_urls:
        return remote_urls
    hints = parse_product_image_hints(category, name, catalog_url)
    if category == "iphone":
        urls = fix_iphone_lineup_cover(list(remote_urls))
        urls = demote_shared_lineup_tail(urls)
        return filter_phone_product_images(urls, category)
    if category == "samsung":
        return filter_phone_product_images(list(remote_urls), category)
    if category == "macbook":
        return fix_macbook_cover_order(list(remote_urls), hints)
    if category == "accessories":
        return filter_accessory_images(list(remote_urls), name, catalog_url)
    if category == "airpods":
        return demote_shared_lineup_tail(list(remote_urls))
    if category == "watch":
        return fix_watch_cover_order(list(remote_urls))
    return list(remote_urls)


def repair_source_images(source: dict[str, Any]) -> dict[str, Any]:
    category = str(source.get("category") or "")
    name = str(source.get("name") or "")
    catalog_url = str(source.get("catalog_url") or "")
    remote = list(source.get("images_remote") or [])
    if not remote and source.get("images_local"):
        remote = remote_urls_from_local(list(source["images_local"]), load_image_map())
    remote = reorder_remote_urls(category, name, catalog_url, remote)
    source["images_remote"] = remote
    source["images_local"] = mirror_images(remote)
    return source


def find_catalog_url_fallback(category: str, product_id: str, product_name: str) -> str:
    from .config import SOURCES_ROOT

    target = re.sub(r"\s+", " ", str(product_name or "").strip().lower())
    if not target:
        return ""
    sources_dir = SOURCES_ROOT / category
    if not sources_dir.is_dir():
        return ""
    for path in sources_dir.glob("*.json"):
        if path.stem == product_id:
            continue
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        name = re.sub(r"\s+", " ", str(data.get("name") or "").strip().lower())
        url = str(data.get("catalog_url") or "").strip()
        if name == target and url:
            return url
    return ""


def bootstrap_source_from_html(category: str, product_id: str) -> dict[str, Any] | None:
    manifest = load_manifest(category)
    meta = manifest.get("byId", {}).get(product_id)
    if not meta:
        return None
    url = str(meta.get("url") or "")
    file_slug = url.rsplit("/", 1)[-1].replace(".html", "")
    html_file = html_path(category, file_slug)
    if not html_file.is_file():
        return None
    html = html_file.read_text(encoding="utf-8")
    images_match = re.search(r"const IMAGES = (\[.*?\]);", html, re.S)
    if not images_match:
        return None
    local_refs = [ref for ref in json.loads(images_match.group(1)) if ref and str(ref).strip()]
    if not local_refs:
        return None
    image_map = load_image_map()
    remote = remote_urls_from_local(
        [ref.replace("../../", "") for ref in local_refs],
        image_map,
    )
    if not remote:
        return None
    catalog_url = find_catalog_url_fallback(category, product_id, meta.get("name") or "")
    source: dict[str, Any] = {
        "product_id": product_id,
        "category": category,
        "file_slug": file_slug,
        "name": meta.get("name") or product_id,
        "country": "",
        "warehouse": meta.get("warehouse") or "",
        "price": meta.get("price") or 0,
        "catalog_url": catalog_url,
        "catalog_title": meta.get("name") or "",
        "specs": [],
        "images_remote": remote,
    }
    return repair_source_images(source)


def bootstrap_accessory_source(product_id: str) -> dict[str, Any] | None:
    remote = KNOWN_ACCESSORY_IMAGES.get(product_id)
    if not remote:
        return None
    manifest = load_manifest("accessories")
    meta = manifest.get("byId", {}).get(product_id)
    if not meta:
        return None
    url = str(meta.get("url") or "")
    file_slug = url.rsplit("/", 1)[-1].replace(".html", "")
    source: dict[str, Any] = {
        "product_id": product_id,
        "category": "accessories",
        "file_slug": file_slug,
        "name": meta.get("name") or product_id,
        "country": "",
        "warehouse": meta.get("warehouse") or "",
        "price": meta.get("price") or 0,
        "catalog_url": KNOWN_ACCESSORY_CATALOG_URLS.get(product_id, ""),
        "catalog_title": meta.get("name") or "",
        "specs": [],
        "images_remote": remote,
    }
    return repair_source_images(source)


SAMSUNG_COLOR_SLUGS: dict[str, str] = {
    "gray": "awesome-gray",
    "grey": "awesome-gray",
    "navy": "navy",
    "white": "white",
    "lilac": "lilac",
    "icyblue": "icy-blue",
    "jetblack": "jet-black",
}


def infer_samsung_catalog_urls(product_id: str, name: str) -> list[str]:
    blob = f"{product_id} {name}".lower()
    color = ""
    for token in SAMSUNG_COLOR_SLUGS:
        if token in blob.replace("-", ""):
            color = token
            break
    if not color:
        return []
    slug = SAMSUNG_COLOR_SLUGS[color]
    if "s25-fe" in product_id:
        slugs = [slug]
        compact = slug.replace("-", "")
        if compact not in slugs:
            slugs.append(compact)
        return [
            f"https://sochi.dr-store.ru/smartfony/samsung/galaxy-s/galaxy-s25-fe/smartfon-samsung-s25-fe-8-256gb-{s}"
            for s in slugs
        ]
    if "a57" in product_id:
        mem = re.search(r"(\d+)/(\d+)", name)
        storage = mem.group(2) if mem else "128"
        return [
            "https://sochi.dr-store.ru/smartfony/samsung/galaxy-a/galaxy-a57/"
            f"smartfon-samsung-galaxy-a57-5g-8-{storage}gb-{slug}"
        ]
    return []


def bootstrap_source_from_samsung_catalog(category: str, product_id: str) -> dict[str, Any] | None:
    if category != "samsung":
        return None
    manifest = load_manifest(category)
    meta = manifest.get("byId", {}).get(product_id)
    if not meta:
        return None
    from .scraper import scrape_catalog_product

    catalog = None
    catalog_url = ""
    for candidate_url in infer_samsung_catalog_urls(product_id, str(meta.get("name") or "")):
        try:
            catalog = scrape_catalog_product(
                candidate_url,
                category="samsung",
                product_name=str(meta.get("name") or ""),
            )
            catalog_url = candidate_url
            break
        except Exception:
            continue
    if not catalog or not catalog_url:
        return None
    url = str(meta.get("url") or "")
    file_slug = url.rsplit("/", 1)[-1].replace(".html", "")
    source: dict[str, Any] = {
        "product_id": product_id,
        "category": category,
        "file_slug": file_slug,
        "name": meta.get("name") or product_id,
        "country": "",
        "warehouse": meta.get("warehouse") or "",
        "price": meta.get("price") or 0,
        "catalog_url": catalog_url,
        "catalog_title": catalog.title,
        "specs": [{"key": k, "value": v} for k, v in catalog.specs],
        "images_remote": catalog.images_remote,
    }
    return repair_source_images(source)


def bootstrap_source_from_sibling(category: str, product_id: str) -> dict[str, Any] | None:
    manifest = load_manifest(category)
    meta = manifest.get("byId", {}).get(product_id)
    if not meta:
        return None
    target_name = re.sub(r"\s+", " ", str(meta.get("name") or "").strip().lower())
    if not target_name:
        return None
    from .config import SOURCES_ROOT

    sibling: dict[str, Any] | None = None
    for path in (SOURCES_ROOT / category).glob("*.json"):
        if path.stem == product_id:
            continue
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        name = re.sub(r"\s+", " ", str(data.get("name") or "").strip().lower())
        if name == target_name and data.get("images_remote"):
            sibling = data
            break
    if not sibling:
        return None
    url = str(meta.get("url") or "")
    file_slug = url.rsplit("/", 1)[-1].replace(".html", "")
    source = {
        "product_id": product_id,
        "category": category,
        "file_slug": file_slug,
        "name": meta.get("name") or product_id,
        "country": sibling.get("country") or "",
        "warehouse": meta.get("warehouse") or "",
        "price": meta.get("price") or 0,
        "catalog_url": sibling.get("catalog_url") or "",
        "catalog_title": sibling.get("catalog_title") or meta.get("name") or "",
        "specs": sibling.get("specs") or [],
        "images_remote": list(sibling.get("images_remote") or []),
    }
    return repair_source_images(source)


def repair_or_bootstrap_source(category: str, product_id: str) -> dict[str, Any] | None:
    existing = load_source(category, product_id)
    if existing and (existing.get("images_remote") or existing.get("images_local")):
        source = repair_source_images(dict(existing))
    elif category == "accessories":
        source = bootstrap_accessory_source(product_id)
    else:
        source = bootstrap_source_from_html(category, product_id)
        if not source:
            source = bootstrap_source_from_sibling(category, product_id)
        if not source:
            source = bootstrap_source_from_samsung_catalog(category, product_id)

    if not source:
        return None

    min_gallery = MIN_GALLERY_IMAGES.get(category, 2)
    local_count = len(source.get("images_local") or [])
    if local_count < min_gallery and source.get("catalog_url"):
        try:
            source = refresh_source_from_catalog(dict(source))
            source = repair_source_images(source)
        except Exception:
            pass
    return source
