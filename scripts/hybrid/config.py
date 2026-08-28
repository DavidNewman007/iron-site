from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PUBLIC = ROOT / "public"
HYBRID_ROOT = PUBLIC / "hybrid-products"
# Английские копии карточек. Отдельные файлы, а не перевод на клиенте: иначе
# поисковику достаётся русская страница с пометкой lang="en" (18.08.2026).
HYBRID_ROOT_EN = PUBLIC / "en" / "hybrid-products"
SOURCES_ROOT = HYBRID_ROOT / "_sources"
SNAPSHOTS_DIR = ROOT / "public-sheet-snapshots"
PROBE_DIR = ROOT / "catalog-match-probe"
IMAGE_MAP_PATH = ROOT / "product-image-map.json"
CONFIG_JS = PUBLIC / "js" / "config.example.js"

# Prices-3 — склад «под заказ» (S3). Добавлен 27.08.2026 по решению владельца:
# «под заказ в принципе те же позиции, что и обычно, так что и на них можно
# сделать карточки». До этого лист не читался вовсе, и 91 плитка магазина из 621
# оставалась без фотографии. Склад входит в product_id и в имя файла, поэтому
# карточка S3 не конфликтует с такой же позицией из наличия.
SHEET_TABS = ["Prices", "Prices-2", "Prices-3"]
SHEET_RANGE = "A1:F1200"

# Категории, для которых собираются hybrid-карточки. Первые семь — с самого
# начала; audio/gaming/dyson/gadgets/galaxy_watch/meta добавлены 27.08.2026.
# До этого прайс-парсер их различал, а конвейер карточек — нет, поэтому 112
# позиций магазина (колонки, приставки, Dyson, instax/GoPro, Galaxy Watch,
# умные очки) висели плитками без фотографии. У поставщика они есть: разделы
# /audio/, /gaming/, /dyson/, /foto-video/, /smart-watches/, /gadgets/.
HYBRID_CATEGORIES = [
    "iphone",
    "ipad",
    "macbook",
    "watch",
    "airpods",
    "samsung",
    "accessories",
    "audio",
    "gaming",
    "dyson",
    "gadgets",
    "galaxy_watch",
    "meta",
]

CATEGORY_MANIFEST = {cat: HYBRID_ROOT / f"{cat}-cards.json" for cat in HYBRID_CATEGORIES}
CATEGORY_DIR = {cat: HYBRID_ROOT / cat for cat in HYBRID_CATEGORIES}

DR_STORE_BASE = "https://sochi.dr-store.ru"
SITEMAP_URL = f"{DR_STORE_BASE}/sitemap.xml"

HYBRID_CART_VERSION = "2026-08-28-1"

CATEGORY_URL_PREFIXES: dict[str, list[str]] = {
    "iphone": ["/apple/iphone/"],
    "ipad": ["/apple/ipad/"],
    "macbook": ["/apple/macbook/"],
    "watch": ["/apple/apple-watch/", "/apple/watch/"],
    "airpods": ["/apple/airpods/"],
    "samsung": ["/smartfony/samsung/", "/samsung/"],
    # /apple/apple-gadgets/ — там Magic Mouse и клавиатуры (добавлено 27.08.2026).
    "accessories": ["/apple/accessories/", "/accessories/", "/apple/apple-gadgets/"],
    "audio": ["/audio/"],
    "gaming": ["/gaming/"],
    "dyson": ["/dyson/"],
    # Whoop и Fitbit прайс относит к гаджетам, а поставщик — к фитнес-браслетам.
    "gadgets": ["/foto-video/", "/gadgets/", "/smart-watches/fitness-bracelets/"],
    "galaxy_watch": ["/smart-watches/samsung-watch/", "/smart-watches/"],
    "meta": ["/gadgets/smart-glasses/"],
}

# Минимальная глубина ссылки товара в карте сайта. У Apple товар лежит на
# четвёртом уровне (/apple/iphone/iphone-17/<товар>), у остальных разделов —
# на третьем (/audio/naushniki/<товар>), и порог 4 отсекал их целиком.
CATEGORY_MIN_URL_DEPTH: dict[str, int] = {
    "accessories": 3,
    "audio": 3,
    "gaming": 3,
    "dyson": 3,
    "gadgets": 3,
    "galaxy_watch": 3,
    "meta": 3,
}
DEFAULT_MIN_URL_DEPTH = 4

# Категории, которым разрешено брать товары из КОРНЯ карты сайта. У поставщика
# часть аксессуаров лежит без раздела вовсе (ремешки Ultra 2, Galaxy SmartTag2,
# защитные стёкла) — по префиксу их не поймать (27.08.2026).
ROOT_LEVEL_CATEGORIES = frozenset({"accessories"})
ROOT_LEVEL_MIN_PATH_LEN = 20

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
