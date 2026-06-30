from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PUBLIC = ROOT / "public"
HYBRID_ROOT = PUBLIC / "hybrid-products"
SOURCES_ROOT = HYBRID_ROOT / "_sources"
SNAPSHOTS_DIR = ROOT / "public-sheet-snapshots"
PROBE_DIR = ROOT / "catalog-match-probe"
IMAGE_MAP_PATH = ROOT / "product-image-map.json"
CONFIG_JS = PUBLIC / "js" / "config.example.js"

SHEET_TABS = ["Prices", "Prices-2"]
SHEET_RANGE = "A1:F1200"

HYBRID_CATEGORIES = [
    "iphone",
    "ipad",
    "macbook",
    "watch",
    "airpods",
    "samsung",
    "accessories",
]

CATEGORY_MANIFEST = {cat: HYBRID_ROOT / f"{cat}-cards.json" for cat in HYBRID_CATEGORIES}
CATEGORY_DIR = {cat: HYBRID_ROOT / cat for cat in HYBRID_CATEGORIES}

DR_STORE_BASE = "https://sochi.dr-store.ru"
SITEMAP_URL = f"{DR_STORE_BASE}/sitemap.xml"

HYBRID_CART_VERSION = "2026-06-30-1"

CATEGORY_URL_PREFIXES: dict[str, list[str]] = {
    "iphone": ["/apple/iphone/"],
    "ipad": ["/apple/ipad/"],
    "macbook": ["/apple/macbook/"],
    "watch": ["/apple/watch/"],
    "airpods": ["/apple/airpods/"],
    "samsung": ["/samsung/"],
    "accessories": ["/apple/accessories/", "/accessories/"],
}

LEGACY_COUNTRY_TOKENS = {
    "япония",
    "индия",
    "европа",
    "германия",
    "сша",
    "китай",
    "корея",
    "гонконг",
    "сингапур",
    "оаэ",
    "тайвань",
    "россия",
    "австралия",
}

COMPETITOR_PATTERNS = [
    re.compile(r"dr\.?store", re.I),
    re.compile(r"официальн(?:ая|ой)\s+гарантия\s+от\s+магазина", re.I),
    re.compile(r"кредит\s+и\s+рассрочка", re.I),
    re.compile(r"доставк[аи]\s+по\s+(?:городу|рф)", re.I),
]

SPEC_DROP_KEYS = {"комплектация"}


def read_sheet_id() -> str:
    if not CONFIG_JS.exists():
        return ""
    text = CONFIG_JS.read_text(encoding="utf-8")
    match = re.search(r'googleSheetId:\s*"([^"]+)"', text)
    return match.group(1) if match else ""


def load_image_map() -> dict[str, str]:
    if not IMAGE_MAP_PATH.exists():
        return {}
    return json.loads(IMAGE_MAP_PATH.read_text(encoding="utf-8"))


def save_image_map(image_map: dict[str, str]) -> None:
    IMAGE_MAP_PATH.write_text(
        json.dumps(image_map, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
