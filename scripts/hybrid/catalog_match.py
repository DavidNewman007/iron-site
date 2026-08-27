from __future__ import annotations

import json
import re
import urllib.request
from datetime import datetime, timezone
from difflib import SequenceMatcher
from pathlib import Path

from .config import (
    CATEGORY_MIN_URL_DEPTH,
    CATEGORY_URL_PREFIXES,
    DEFAULT_MIN_URL_DEPTH,
    DR_STORE_BASE,
    PROBE_DIR,
    ROOT_LEVEL_CATEGORIES,
    ROOT_LEVEL_MIN_PATH_LEN,
    SITEMAP_URL,
)
from .price_parser import Product
from .product_match import iphone_match_penalty, watch_match_penalty
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
    # Подчёркивание — это \w, и без явной замены слаг вида
    # Apple_Magic_Mouse_3_USB-C_White оставался ОДНИМ токеном: пересечение с
    # названием товара выходило нулевым, и товар не находился вовсе.
    # Найдено 27.08.2026 на «Magic Mouse 3 White».
    value = value.replace("_", " ")
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


# Русское название против латинского слага (27.08.2026).
#
# Прайс пишет «Яндекс Станция Мини 3 Серый», поставщик — то
# «yandex-station-mini-3-gray», то «umnaya-kolonka-yandeks-stanciya-mini-3-pro-
# na-yagpt-seryj». Пересечение слов выходило нулевым, и все 14 Яндекс-колонок
# оставались без карточки. Лечится в два шага: транслитерация кириллицы и
# сведение синонимов к одному написанию. Делается ТОЛЬКО в token_set: name_norm
# по-прежнему кириллический, на нём держатся проверки вида «чехол»/«сзу» в
# score_accessory_url.
TRANSLIT_MAP = {
    "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e", "ё": "e",
    "ж": "zh", "з": "z", "и": "i", "й": "j", "к": "k", "л": "l", "м": "m",
    "н": "n", "о": "o", "п": "p", "р": "r", "с": "s", "т": "t", "у": "u",
    "ф": "f", "х": "h", "ц": "c", "ч": "ch", "ш": "sh", "щ": "sch",
    "ъ": "", "ы": "y", "ь": "", "э": "e", "ю": "yu", "я": "ya",
}

TOKEN_SYNONYMS = {
    "yandeks": "yandex",
    "stanciya": "station",
    "kolonka": "speaker",
    "kolonki": "speaker",
    "umnaya": "smart",
    "umnye": "smart",
    "portativnaya": "portable",
    "besprovodnye": "wireless",
    "naushniki": "headphones",
    "chasy": "watch",
    "chernyj": "black",
    "cherny": "black",
    "seryj": "gray",
    "grey": "gray",
    "sinij": "blue",
    "goluboj": "blue",
    "zelenyj": "green",
    "fioletovyj": "purple",
    "lilovyj": "purple",
    "lilac": "purple",
    "biryuzovyj": "turquoise",
    "bezhevyj": "beige",
    "oranzhevyj": "orange",
    "oranzhevy": "orange",
    "krasnyj": "red",
    "rozovyj": "pink",
    "belyj": "white",
    "serebristyj": "silver",
    "grafit": "graphite",
    "grafitovyj": "graphite",
    "strit": "street",
    "lajt": "light",
    "duo": "duo",
    "stajler": "styler",
    "fen": "hairdryer",
    "vypryamitel": "straightener",
    "pylesos": "vacuum",
    "pristavka": "console",
    "igrovaya": "game",
    "fotoapparat": "camera",
    "fotoprinter": "printer",
    "kartridzh": "cartridge",
    "podstavka": "stand",
    "gejmpad": "gamepad",
    "portal": "portable",
    "cooper": "copper",
    "dualsense": "dual",
    "diskovod": "drive",
    "ochki": "glasses",
    "fitnes": "fitness",
    "braslet": "bracelet",
}


def transliterate(token: str) -> str:
    if not any(ch in TRANSLIT_MAP for ch in token):
        return token
    return "".join(TRANSLIT_MAP.get(ch, ch) for ch in token)


def canonical_token(token: str) -> str:
    latin = transliterate(token)
    return TOKEN_SYNONYMS.get(latin, latin)


def token_set(text: str) -> set[str]:
    tokens = {canonical_token(t) for t in normalize_match_text(text).split()}
    stop = {"the", "and", "for", "with", "apple", "a", "j", "hn", "ja", "sim"}
    return {t for t in tokens if len(t) > 1 and t not in stop}


def accessory_kind(name_norm: str) -> str | None:
    if "pitaka" in name_norm or "питака" in name_norm:
        return "pitaka"
    if "pencil" in name_norm or "пенсил" in name_norm:
        return "pencil"
    if "airtag" in name_norm:
        return "airtag"
    if "smarttag" in name_norm.replace(" ", ""):
        return "smarttag"
    if "remax" in name_norm or "стекло" in name_norm:
        return "remax"
    if "mouse" in name_norm or "мыш" in name_norm:
        return "mouse"
    if "сзu" in name_norm or "сзу" in name_norm or "charger" in name_norm:
        return "charger"
    return None


def iphone_model_in_text(text: str) -> str | None:
    value = str(text or "").lower().replace("ё", "е")
    for model in ("17-pro-max", "17-pro", "16-pro-max", "16-pro", "15-pro-max", "15-pro"):
        if model in value or model.replace("-", " ") in value:
            return model
    if "s26 ultra" in value or "s26-ultra" in value:
        return "s26-ultra"
    return None


def model_matches_slug(model: str, slug: str) -> bool:
    if model == "17-pro":
        return "17-pro" in slug and "17-pro-max" not in slug
    if model == "16-pro":
        return "16-pro" in slug and "16-pro-max" not in slug
    if model == "15-pro":
        return "15-pro" in slug and "15-pro-max" not in slug
    return model in slug


def score_accessory_url(name_norm: str, slug: str, url: str, score: float) -> float:
    kind = accessory_kind(name_norm)
    model = iphone_model_in_text(name_norm)

    if kind == "pencil":
        if "pencil" in slug:
            score *= 3.0
        if "chexol" in slug or "smartphone-cases" in slug:
            score *= 0.02
        if "accessories-ipad" in url or "apple-gadgets" in url:
            score *= 1.4
        if "pro" in name_norm and "pro" in slug:
            score *= 1.2
        if "usb" in name_norm and "usb" in slug:
            score *= 1.3
        return score

    if kind == "pitaka" or ("чехол" in name_norm and model):
        # PITAKA у dr-store нет вовсе, а «чехол» есть у десятка других марок.
        # Без этой проверки под именем PITAKA на сайт попадало фото чехла
        # AceCase/vlp/uBear — чужой бренд и часто чужая модель телефона
        # (найдено 27.08.2026, 11 карточек). Лучше плитка без фото.
        if kind == "pitaka" and "pitaka" not in slug:
            return 0.0
        if "chexol" not in slug:
            score *= 0.05
        if model:
            if model_matches_slug(model, slug):
                score *= 2.0
            elif any(token in slug for token in ("17-pro-max", "17-pro", "16-pro-max", "16-pro", "s26-ultra")):
                score *= 0.1
        for token, hints in (
            ("black-gray", ("black", "chernyj")),
            ("black gray", ("black", "chernyj")),
            ("lucid-blue", ("deep-blue", "sinij")),
            ("lucid blue", ("deep-blue", "sinij")),
        ):
            if token in name_norm and any(hint in slug for hint in hints):
                score *= 1.4
        return score

    if kind == "airtag":
        if "airtag" in slug:
            score *= 2.5
        if "chexol" in slug and "airtag" not in slug:
            score *= 0.1
        return score

    if kind == "smarttag":
        # Трекер Samsung лежит у поставщика в корне сайта и называется
        # «poiskovoj-treker-samsung-galaxy-smarttag-2-…»: общего с «Galaxy
        # SmartTag2» — одно слово, а слово «galaxy» в слаге ещё и включало
        # штраф «это карточка устройства». Разбираем явно (27.08.2026).
        if "smarttag" in slug.replace("-", ""):
            score *= 3.0
        else:
            score *= 0.05
        wants_pack = "4pack" in name_norm.replace(" ", "")
        has_pack = "4pack" in slug.replace("-", "")
        if wants_pack != has_pack:
            score *= 0.4
        return score

    if kind == "charger":
        # «СЗУ Apple 35W» уезжало на Samsung Travel Adapter 25W: слова совпали,
        # а мощность никто не сверял (27.08.2026).
        name_watts = set(re.findall(r"(\d{1,3})\s*w\b", name_norm))
        slug_watts = set(re.findall(r"(\d{1,3})\s*w\b", slug.replace("-", " ")))
        if name_watts and slug_watts and not (name_watts & slug_watts):
            score *= 0.05

    if kind in ("mouse", "charger") and any(token in slug for token in ("iphone", "chexol", "smartphone-cases")):
        score *= 0.05

    if any(token in slug for token in ("iphone", "ipad", "macbook", "watch", "galaxy")):
        if kind is None and "чехол" not in name_norm and "стекло" not in name_norm:
            score *= 0.15
        elif kind == "pencil":
            score *= 0.02

    return score


# Цвета в канонической записи (после transliterate + TOKEN_SYNONYMS).
COLOR_TOKENS = frozenset(
    {
        "black", "white", "gray", "blue", "green", "purple", "turquoise",
        "beige", "orange", "red", "pink", "silver", "graphite", "gold",
        "yellow", "brown", "cream", "lavender", "coral", "sand", "copper",
    }
)

# Категории без собственных правил сопоставления: у них нет ни разбора модели,
# ни штрафов вроде iphone_match_penalty, поэтому цвет и приставку «Pro» надо
# сверять явно — иначе «Станция Мини 3 Про Зелёный» цепляет обычную Мини 3
# зелёную, а «Мини 3 Бирюзовый» (такого цвета у поставщика нет) — серую.
GENERIC_MATCH_CATEGORIES = frozenset(
    {"audio", "gaming", "dyson", "gadgets", "galaxy_watch", "meta"}
)


def canonical_text(text: str) -> str:
    """Название в один латинский вид — для сравнения строк целиком."""
    return " ".join(canonical_token(t) for t in normalize_match_text(text).split())


# Служебные слова: встречаются в названии, но никогда в адресе товара, — по ним
# нельзя судить, тот ли это товар. Слова вроде «дисковод», «подставка» или
# «картридж» сюда НЕ входят: они как раз и отличают товар от соседнего.
GENERIC_NOISE_WORDS = frozenset(
    {
        "dlya", "for", "and", "with", "na", "i",
        "novyj", "new", "originalnyj", "orig", "raspak", "ucenka",
        "zigbee", "yagpt",
        # приписки прайса: «+ годовая подписка», «Size C», «(Gen 2)»
        "godovaya", "podpiska", "size", "gen", "edition",
    }
)

# После «для»/«for» у поставщика идёт совместимость («…-dlya-playstation-5-slim-
# i-pro»), а не сам товар: слова-линейки оттуда брать нельзя (27.08.2026).
COMPAT_MARKERS = ("dlya", "for")

# Слова-линейки: их отсутствие ИЛИ появление меняет товар. Проверяются в обе
# стороны — иначе «Станция MAX» цепляла «Станцию Дуо MAX» (27.08.2026).
LINE_MARKER_WORDS = frozenset(
    {"duo", "midi", "mini", "max", "light", "street", "plus", "ultra", "classic", "slim", "portal", "pro"}
)

ROMAN_NUMERALS = {"ii": "2", "iii": "3", "iv": "4", "v": "5", "vi": "6", "vii": "7"}


def _generic_words(text: str) -> set[str]:
    """Слова товара: цифры отделены от букв, римские номера — арабскими."""
    value = normalize_match_text(text)
    value = re.sub(r"(?<=\d)(?=[a-zа-я])|(?<=[a-zа-я])(?=\d)", " ", value)
    # «ZigbeeЧерный» в прайсе пишут слитно — латиница и кириллица тоже разные слова.
    value = re.sub(r"(?<=[a-z])(?=[а-я])|(?<=[а-я])(?=[a-z])", " ", value)
    words: set[str] = set()
    for raw in value.split():
        token = canonical_token(raw)
        words.add(ROMAN_NUMERALS.get(token, token))
    return words


def _gen_number(text: str) -> str:
    match = re.search(r"\bgen\s*(\d+)", normalize_match_text(text))
    return match.group(1) if match else ""


def _cut_at_compat(text: str) -> str:
    words = normalize_match_text(text).split()
    for i, word in enumerate(words):
        if canonical_token(word) in COMPAT_MARKERS:
            return " ".join(words[:i])
    return text


def generic_match_penalty(name: str, slug: str) -> float:
    """Сверка цвета, поколения и слова-модели для категорий без своих правил."""
    name_words = _generic_words(name)
    slug_words = _generic_words(slug)
    slug_marker_words = _generic_words(_cut_at_compat(slug))
    penalty = 1.0

    name_colors = name_words & COLOR_TOKENS
    slug_colors = slug_words & COLOR_TOKENS
    if name_colors and slug_colors and not (name_colors & slug_colors):
        penalty *= 0.15
    elif name_colors and not slug_colors:
        # У поставщика цвет почти всегда в адресе: страница без цвета — это
        # раздел («…/yandeks-stanciya-mini-3-pro»), а не конкретный товар.
        penalty *= 0.25

    for marker in LINE_MARKER_WORDS:
        if (marker in name_words) != (marker in slug_marker_words):
            penalty *= 0.4

    # «Gen 2» против «gen-1»: само слово gen в шум записано (оно бывает и в
    # скобках, и в слаге), но номер поколения сверить надо.
    name_gen = _gen_number(name)
    slug_gen = _gen_number(slug)
    if name_gen and slug_gen and name_gen != slug_gen:
        penalty *= 0.15

    name_numbers = {w for w in name_words if w.isdigit()}
    slug_numbers = {w for w in slug_words if w.isdigit()}
    if name_numbers and slug_numbers and not (name_numbers & slug_numbers):
        penalty *= 0.2

    # Слово-модель («acton», «flip», «major») должно быть и в адресе: иначе это
    # соседний товар той же марки.
    identity = {
        w
        for w in name_words
        if w.isalpha() and len(w) >= 3 and w not in COLOR_TOKENS and w not in GENERIC_NOISE_WORDS
    }
    missing = identity - slug_words
    if missing:
        penalty *= 0.25 ** min(len(missing), 2)

    return penalty


def score_product_url(product: Product, url: str) -> float:
    slug = url.rsplit("/", 1)[-1].lower()
    name_norm = normalize_match_text(product.name)
    slug_norm = normalize_match_text(slug.replace("-", " "))
    name_tokens = token_set(product.name)
    slug_tokens = token_set(slug.replace("-", " "))

    if not name_tokens or not slug_tokens:
        return 0.0

    overlap = len(name_tokens & slug_tokens) / max(len(name_tokens), 1)
    # Строки сравниваем в канонической латинице: у русского названия и
    # латинского слага общих символов почти нет, и ratio раньше был шумом,
    # который решал ничьи наугад (27.08.2026).
    ratio = SequenceMatcher(None, canonical_text(product.name), canonical_text(slug.replace("-", " "))).ratio()
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
        score = score_accessory_url(name_norm, slug, url, score)

    # Storage / color hints from slug
    storage = re.search(r"(\d+)\s*/\s*(\d+)", product.name)
    if storage:
        pair = f"{storage.group(1)}-{storage.group(2)}"
        if pair.replace("-", "") not in slug_norm.replace(" ", ""):
            score *= 0.85
    gb = re.search(r"(\d+)\s*gb", product.name, re.I)
    if gb:
        storage = gb.group(1)
        if storage not in slug and f"{storage}gb" not in slug:
            score *= 0.75

    if product.category == "iphone":
        score *= iphone_match_penalty(product.name, url)

    if product.category == "watch":
        score *= watch_match_penalty(product.name, url)

    if product.category in GENERIC_MATCH_CATEGORIES:
        score *= generic_match_penalty(product.name, slug.replace("-", " "))

    return score


def candidate_urls(category: str, sitemap_urls: list[str]) -> list[str]:
    prefixes = CATEGORY_URL_PREFIXES.get(category, [])
    min_slashes = CATEGORY_MIN_URL_DEPTH.get(category, DEFAULT_MIN_URL_DEPTH)
    allow_root = category in ROOT_LEVEL_CATEGORIES
    urls = []
    for url in sitemap_urls:
        path = url.replace(DR_STORE_BASE, "")
        if any(path.startswith(prefix) for prefix in prefixes):
            if path.count("/") < min_slashes:
                continue
        elif not (
            allow_root
            and path.count("/") == 1
            and len(path) >= ROOT_LEVEL_MIN_PATH_LEN
        ):
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


# Категории, где неверная страница уже отсекается проверками (поколение, цвет,
# размер, мощность). Там планка ниже: правильный адрес часто набирает 0.3 из-за
# служебных хвостов в названии («GPS + Cellular MF0X4 J/A»), а конкурентов
# проверки уже утопили. Для остальных категорий планка прежняя (27.08.2026).
GUARDED_CATEGORIES = frozenset(
    {
        "iphone", "watch", "accessories",
        "audio", "gaming", "dyson", "gadgets", "galaxy_watch", "meta",
    }
)
GUARDED_MIN_SCORE = 0.25


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
        threshold = GUARDED_MIN_SCORE if product.category in GUARDED_CATEGORIES else min_score
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
            "status": "matched" if url and score >= threshold else "unmatched",
        }
        if fetch_details and url and score >= threshold:
            try:
                catalog = scrape_catalog_product(
                    url,
                    category=product.category,
                    product_name=product.name,
                )
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
