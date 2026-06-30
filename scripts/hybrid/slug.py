from __future__ import annotations

import re

from .config import LEGACY_COUNTRY_TOKENS


def slugify(value: str, max_len: int = 80) -> str:
    return re.sub(r"[^a-z0-9а-яё]+", "-", str(value or "").lower())[:max_len]


def slugify_with_suffix(prefix: str, suffix: str, max_len: int = 80) -> str:
    def normalize(part: str) -> str:
        return (
            re.sub(r"[^a-z0-9а-яё]+", "-", str(part or "").lower())
            .strip("-")
        )

    safe_prefix = normalize(prefix)
    safe_suffix = normalize(suffix)
    if not safe_suffix:
        return safe_prefix[:max_len]
    max_prefix_len = max_len - len(safe_suffix) - 1
    if max_prefix_len <= 0:
        return safe_suffix[-max_len:]
    trimmed = safe_prefix[:max_prefix_len].rstrip("-")
    return f"{trimmed}-{safe_suffix}" if trimmed else safe_suffix


def build_product_id(name: str, country: str, warehouse: str, price: int) -> str:
    return slugify(f"{name}{country}{warehouse}{price}")


def build_file_slug(name: str, warehouse: str, price: int) -> str:
    return slugify_with_suffix(f"{name}{warehouse}", str(price))


def build_catalog_key(name: str, warehouse: str, price: int) -> str:
    return slugify(f"{name}{warehouse}{price}")


def normalize_cart_id(value: str) -> str:
    raw = (
        str(value or "")
        .lower()
        .replace("ё", "е")
    )
    raw = re.sub(r"[^a-z0-9а-я]+", "-", raw).strip("-")
    if not raw:
        return ""
    tokens = []
    for token in raw.split("-"):
        if not token or token in LEGACY_COUNTRY_TOKENS:
            continue
        gb_match = re.match(r"^(\d{2,4})gb$", token)
        if gb_match:
            tokens.append(gb_match.group(1))
            continue
        if token == "1tb":
            tokens.append("1024")
            continue
        if token == "2tb":
            tokens.append("2048")
            continue
        tokens.append(token)
    return "-".join(tokens)
