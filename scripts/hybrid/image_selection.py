"""Unified product image selection for all hybrid card categories."""
from __future__ import annotations

import html as html_lib
import re
import urllib.parse

from .config import DR_STORE_BASE

ACCESSORY_IMAGE_PATTERNS = (
    "protective_tape",
    "mocoll",
    "magic-mouse",
    "magic-keyboard",
    "magic_trackpad",
    "trackpad",
    "adapter",
    "charger",
    "cable",
    "чехол",
    "case",
    "frame 35",
    "frame_",
    "/блог/",
    "/blog/",
    "аксессуар",
    "accessories",
    "наклей",
    "peel",
    "skin",
    "sleeve",
    "stand",
    "hub",
    "dongle",
    "power-adapter",
    "заряд",
    "комплект",
    "usb-c",
    "usb_c",
    "type-c",
    "/szu/",
    "mailservice",
    "remax",
)

GENERIC_JUNK_IN_URL = ("logo", "favicon", "mailservice", "/szu/", "remax")

DEVICE_LINEUP_RE = re.compile(
    r"/demo-prostore/products/(?:apple/)?(?:iphone|ipad|macbook|watch|airpods)/.+?-dr-store-\d+",
    re.I,
)

MAX_IMAGES = 8


def normalize_image_url(url: str) -> str:
    value = html_lib.unescape(str(url or "")).strip()
    if not value:
        return ""
    if value.startswith("//"):
        value = "https:" + value
    try:
        parts = urllib.parse.urlsplit(value)
    except Exception:
        return value
    if not parts.netloc:
        return value
    path = urllib.parse.unquote(parts.path or "")
    path = re.sub(r"/{2,}", "/", path)
    if "/image/catalog/" in path.lower() and "/image/cache/" not in path.lower():
        path = path.replace("/image/catalog/", "/image/cache/catalog/", 1)
        path = path.replace("/image/Catalog/", "/image/cache/catalog/", 1)
    return urllib.parse.urlunsplit((parts.scheme or "https", parts.netloc.lower(), path, "", ""))


def upscale_image_url(url: str) -> str:
    value = str(url or "").strip()
    if not value:
        return value
    return re.sub(
        r"-(300x300|500x500|600x600|1000x1000)(\.[a-z0-9]+)$",
        r"-1200x1200\2",
        value,
        flags=re.I,
    )


def image_dedup_key(url: str) -> str:
    value = normalize_image_url(url).lower()
    if not value:
        return ""
    return re.sub(r"-(?:\d{2,4}x\d{2,4})(\.[a-z0-9]+)$", r"\1", value, flags=re.I)


def dr_store_index(url: str) -> int | None:
    match = re.search(r"-dr-store-(\d+)-", str(url or ""), re.I)
    return int(match.group(1)) if match else None


def parse_og_image(page_html: str) -> str:
    match = re.search(r'property="og:image"\s+content="([^"]+)"', page_html or "", re.I)
    return normalize_image_url(match.group(1)) if match else ""


def parse_product_image_hints(category: str, product_name: str, catalog_url: str) -> dict[str, str]:
    blob = f"{product_name} {catalog_url}".lower()
    hints: dict[str, str] = {"category": category}

    if category == "macbook":
        if re.search(r"\bneo\b", blob):
            hints["family"] = "neo"
        elif re.search(r"\bpro\b", blob):
            hints["family"] = "pro"
        else:
            hints["family"] = "air"
        size = re.search(r"\b(13|15)\b", blob)
        if size:
            hints["size"] = size.group(1)
        gen = re.search(r"\b(m[345]|neo)\b", blob)
        if gen:
            hints["gen"] = gen.group(1)
        model = re.search(r"\b([a-z]{1,2}\d[a-z0-9]{2,4})(?:\s*/\s*a)?\b", blob, re.I)
        if model:
            hints["model_code"] = model.group(1).lower()
        href_size = re.search(r"macbook-air-(\d+)", catalog_url.lower())
        if href_size:
            hints["href_size"] = href_size.group(1)
        if re.search(r"macbook-neo", catalog_url.lower()):
            hints["family"] = "neo"

    if category == "iphone":
        color = re.search(
            r"\b(black|white|pink|blue|green|yellow|purple|natural|titanium|gold|silver|"
            r"ultramarine|teal|starlight|midnight|desert|graphite|sierra|lavender|orange|"
            r"red|gray|grey|violet|silvershadow|mist\s*blue|lavender|sage|cosmic|"
            r"space\s*black|jet\s*black|rose\s*gold)\b",
            product_name,
            re.I,
        )
        if color:
            hints["color"] = re.sub(r"\s+", "-", color.group(1).lower())

    return hints


CROSS_SELL_IMAGE_RE = re.compile(
    r"chexol-|chekhol-|bumazhnik|cardholder|card-holder|/accessories/|smartphone-cases|"
    r"pitaka|/new[\s%20]+products/chexol",
    re.I,
)


def is_cross_sell_accessory_image(url: str) -> bool:
    return bool(CROSS_SELL_IMAGE_RE.search(urllib.parse.unquote(str(url or ""))))


def filter_phone_product_images(urls: list[str], category: str) -> list[str]:
    if category not in ("iphone", "samsung"):
        return urls
    filtered = [url for url in urls if not is_cross_sell_accessory_image(url)]
    return filtered or urls


def is_device_lineup_image(url: str) -> bool:
    return bool(DEVICE_LINEUP_RE.search(urllib.parse.unquote(str(url or ""))))


def catalog_slug_from_url(catalog_url: str) -> str:
    return str(catalog_url or "").rstrip("/").rsplit("/", 1)[-1].lower()


def is_catalog_product_image(url: str, catalog_url: str) -> bool:
    slug = catalog_slug_from_url(catalog_url)
    if not slug:
        return False
    decoded = urllib.parse.unquote(str(url or "")).lower()
    compact = decoded.replace("-", "")
    return slug in decoded or slug.replace("-", "") in compact


def filter_accessory_images(urls: list[str], product_name: str, catalog_url: str) -> list[str]:
    filtered = [url for url in urls if not is_device_lineup_image(url)]
    if not filtered:
        return []

    name = str(product_name or "").lower()
    if "чехол" not in name and "case" not in name:
        return filtered[:MAX_IMAGES]

    slug_matches = [url for url in filtered if is_catalog_product_image(url, catalog_url)]
    if slug_matches:
        return slug_matches[:MAX_IMAGES]

    new_products = [
        url
        for url in filtered
        if "/new%20products/" in url.lower() or "/new products/" in url.lower()
    ]
    if new_products:
        return new_products[:MAX_IMAGES]

    return filtered[:MAX_IMAGES]


def should_exclude_image_url(url: str, hints: dict[str, str], *, strict_gen: bool = True) -> bool:
    value = urllib.parse.unquote(str(url or "")).lower()
    if any(token in value for token in GENERIC_JUNK_IN_URL):
        return True
    category = hints.get("category") or ""
    if category != "accessories":
        if any(token in value for token in ACCESSORY_IMAGE_PATTERNS):
            return True
    if category == "accessories" and is_device_lineup_image(url):
        return True

    if category != "macbook":
        return False

    size = hints.get("size") or hints.get("href_size") or ""
    if size == "13":
        if re.search(r"\bmba15\b|/air-15[-/]|macbook-air-15", value) and "air-13" not in value and "mba13" not in value:
            return True
    if size == "15":
        if re.search(r"\bmba13\b|/air-13[-/]|macbook-air-13", value) and "air-15" not in value and "mba15" not in value:
            return True

    gen = hints.get("gen", "")
    if gen == "m5" and re.search(r"\bmba13-m3\b|/m3/", value):
        return True
    if strict_gen and gen == "m5":
        if re.search(r"\bmba13-m4\b|/m4/", value) and "m5" not in value and "2026" not in value:
            if re.search(r"air-13-15-m4-2025", value):
                return False
            return True
    if hints.get("family") == "neo" and "macbook-neo" not in value and "/neo/" not in value:
        return True
    return False


def image_resolution_score(url: str) -> int:
    value = url.lower()
    match = re.search(r"-(\d+)x(\d+)\.(?:jpe?g|png|webp)$", value)
    if match:
        return int(match.group(1)) * int(match.group(2))
    match = re.search(r"/(\d+)x(\d+)/", value)
    if match:
        return int(match.group(1)) * int(match.group(2))
    return 0


def image_variant_key(url: str) -> str:
    value = normalize_image_url(url).lower()
    value = re.sub(r"-\d+x\d+(?=\.(?:jpe?g|png|webp)$)", "", value)
    return image_dedup_key(value) or value


def parse_gallery_page_order(page_html: str) -> list[str]:
    """Gallery URLs in page order, largest variant per slot."""
    scope = (page_html or "")[:500000]
    order: list[str] = []
    best: dict[str, str] = {}
    best_score: dict[str, int] = {}

    for raw in re.findall(
        r'https://sochi\.dr-store\.ru/image/[^"\']+?\.(?:jpg|jpeg|png|webp)',
        scope,
        flags=re.I,
    ):
        normalized = normalize_image_url(raw)
        if not normalized or "/image/cache/" not in normalized:
            continue
        candidate = upscale_image_url(normalized)
        key = image_variant_key(candidate)
        if not key:
            continue
        score = image_resolution_score(candidate)
        if key not in best or score > best_score.get(key, -1):
            best[key] = candidate
            best_score[key] = score
        if key not in order:
            order.append(key)

    return [best[key] for key in order]


def _append_unique(result: list[str], seen: set[str], url: str, hints: dict[str, str]) -> None:
    for relaxed in (False, True):
        normalized = normalize_image_url(url)
        if not normalized:
            return
        if should_exclude_image_url(normalized, hints, strict_gen=not relaxed):
            continue
        candidate = upscale_image_url(normalized)
        key = image_dedup_key(candidate)
        if not key or key in seen:
            return
        seen.add(key)
        result.append(candidate)
        return


def is_macbook_keyboard_shot(url: str) -> bool:
    value = urllib.parse.unquote(str(url or "")).lower()
    if re.search(r"-dr-store2(?:[\-\.]|$)", value):
        return True
    if re.search(r"(?:starlight|silver|midnight|skyblue|spacegray)4-dr-store", value):
        return True
    if re.search(r"mba15-[^/]+-(?:4|7)-", value):
        return True
    return False


def fix_macbook_cover_order(urls: list[str], hints: dict[str, str]) -> list[str]:
    if hints.get("category") != "macbook" or len(urls) < 2:
        return urls
    size = hints.get("size") or hints.get("href_size") or ""
    heroes = [url for url in urls if not is_macbook_keyboard_shot(url)]
    keyboards = [url for url in urls if is_macbook_keyboard_shot(url)]
    if not heroes:
        return urls
    if size == "13":
        on_size = [url for url in heroes if "mba15" not in url.lower() and "/air-15" not in url.lower()]
        other_size = [url for url in heroes if url not in on_size]
        if on_size:
            heroes = on_size + other_size
    return heroes + keyboards


def fix_iphone_lineup_cover(urls: list[str]) -> list[str]:
    """When dr-store uses a low-index lineup hero, prefer the next color-specific shot."""
    if len(urls) < 2:
        return urls
    first_idx = dr_store_index(urls[0])
    if first_idx != 1:
        return urls
    for i, url in enumerate(urls[1:], start=1):
        idx = dr_store_index(url)
        if idx is not None and idx > 1:
            return urls[i:] + urls[:i]
    return urls


def watch_gallery_index(url: str) -> int:
    """Dr-store watch gallery slot; unindexed hero files are strap close-ups."""
    value = urllib.parse.unquote(str(url or "")).lower()
    match = re.search(r"-(\d+)-(?:1000|1200)x(?:1000|1200)\.(?:png|jpe?g)$", value)
    if match:
        return int(match.group(1))
    return 1


def is_watch_strap_only_image(url: str) -> bool:
    value = urllib.parse.unquote(str(url or "")).lower()
    if "demo-prostore" in value and "/watch/" in value:
        return False
    if "remeshok" in value or ("alpine" in value and "loop" in value and "strap" in value):
        return watch_gallery_index(url) < 2
    return False


def fix_watch_cover_order(urls: list[str]) -> list[str]:
    if len(urls) < 2:
        return urls
    demo = [url for url in urls if "demo-prostore" in url.lower() and "/watch/" in url.lower()]
    heroes = [url for url in urls if url not in demo and not is_watch_strap_only_image(url)]
    straps = [url for url in urls if url not in demo and is_watch_strap_only_image(url)]
    if demo:
        return demo + heroes + straps
    if heroes:
        return heroes + straps
    return urls


def demote_shared_lineup_tail(urls: list[str]) -> list[str]:
    """Move generic dr-store-1 lineup shots to the end when color-specific images exist."""
    if len(urls) <= 1:
        return urls
    lineup = [url for url in urls if dr_store_index(url) == 1]
    if not lineup:
        return urls
    specific = [url for url in urls if dr_store_index(url) not in (None, 1)]
    if not specific:
        return urls
    return specific + lineup


def select_product_images(
    category: str,
    product_name: str,
    page_html: str,
    catalog_url: str = "",
    seed_images: list[str] | None = None,
) -> list[str]:
    hints = parse_product_image_hints(category, product_name, catalog_url)
    queue: list[str] = []

    og_image = parse_og_image(page_html)
    if og_image:
        queue.append(og_image)
    for url in seed_images or []:
        if url:
            queue.append(str(url))
    queue.extend(parse_gallery_page_order(page_html))

    result: list[str] = []
    seen: set[str] = set()
    for url in queue:
        _append_unique(result, seen, url, hints)

    if category == "iphone":
        result = fix_iphone_lineup_cover(result)
        result = demote_shared_lineup_tail(result)
        result = filter_phone_product_images(result, category)

    if category == "samsung":
        result = filter_phone_product_images(result, category)

    if category == "macbook":
        result = fix_macbook_cover_order(result, hints)

    if category == "accessories":
        result = filter_accessory_images(result, product_name, catalog_url)

    if category == "watch":
        result = fix_watch_cover_order(result)

    return result[:MAX_IMAGES]
