from __future__ import annotations

import re


def normalize_match_text(text: str) -> str:
    value = str(text or "").lower()
    value = value.replace("ё", "е")
    value = re.sub(r"[^\w\s/+]", " ", value, flags=re.UNICODE)
    value = re.sub(r"\s+", " ", value).strip()
    return value


IPHONE_MODEL_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("iphone-air", re.compile(r"\biphone\s+air\b", re.I)),
    ("iphone-17", re.compile(r"\biphone\s+17\b", re.I)),
    ("iphone-16", re.compile(r"\biphone\s+16\b", re.I)),
    ("iphone-15", re.compile(r"\biphone\s+15\b", re.I)),
    ("iphone-14", re.compile(r"\biphone\s+14\b", re.I)),
    ("iphone-se", re.compile(r"\biphone\s+se\b", re.I)),
]

IPHONE_COLOR_ALIASES: dict[str, list[str]] = {
    "black": ["black", "space-black", "midnight", "space black"],
    "white": ["white", "cloud-white", "starlight", "cloud white"],
    "blue": ["blue", "mist-blue", "sky-blue", "ultramarine", "sky blue", "mist blue"],
    "gold": ["gold", "light-gold", "light gold"],
    "lavender": ["lavender"],
    "sage": ["sage"],
    "pink": ["pink"],
    "teal": ["teal"],
    "yellow": ["yellow"],
    "green": ["green"],
    "purple": ["purple"],
    "red": ["red"],
    "orange": ["orange"],
    "natural": ["natural", "titanium-natural"],
    "desert": ["desert"],
}


def iphone_model_key(name: str) -> str | None:
    normalized = normalize_match_text(name)
    for key, pattern in IPHONE_MODEL_PATTERNS:
        if pattern.search(normalized):
            return key
    return None


def iphone_color_keys(name: str) -> set[str]:
    normalized = normalize_match_text(name)
    found: set[str] = set()
    for canonical, aliases in IPHONE_COLOR_ALIASES.items():
        for alias in aliases:
            token = alias.replace("-", " ")
            if token in normalized or alias.replace(" ", "-") in normalized.replace(" ", "-"):
                found.add(canonical)
                break
    return found


def slug_has_model(slug: str, model_key: str) -> bool:
    slug_norm = slug.lower().replace("_", "-")
    if model_key == "iphone-air":
        return "iphone-air" in slug_norm or slug_norm.startswith("air-")
    return model_key in slug_norm


def slug_has_color(slug: str, color_keys: set[str]) -> bool:
    if not color_keys:
        return True
    slug_norm = slug.lower()
    for color in color_keys:
        for alias in IPHONE_COLOR_ALIASES[color]:
            if alias.replace(" ", "-") in slug_norm:
                return True
    return False


def iphone_match_penalty(name: str, url: str) -> float:
    """Return multiplier 0..1 — lower means worse match."""
    slug = url.rsplit("/", 1)[-1].lower()
    model = iphone_model_key(name)
    if not model:
        return 1.0

    multiplier = 1.0
    if not slug_has_model(slug, model):
        multiplier *= 0.05

    # Prevent iPhone Air ↔ numbered iPhone cross-match.
    if model == "iphone-air" and re.search(r"iphone-\d+", slug):
        multiplier *= 0.02
    if model.startswith("iphone-") and model != "iphone-air" and "iphone-air" in slug:
        multiplier *= 0.02

    colors = iphone_color_keys(name)
    if colors and not slug_has_color(slug, colors):
        multiplier *= 0.15

    return multiplier


# Apple Watch: поколение и размер (27.08.2026).
#
# После того как в token_set научились разбирать слаги через подчёркивание,
# «Series Ultra 3 49mm» начал попадать на страницу Ultra 2 (Apple_Watch_Ultra_2_
# GPS_49mm_…): общих слов достаточно, а номер поколения короче двух символов и
# из токенов выбрасывался. Отдельная проверка семейства, поколения и размера.
SE_YEAR_TO_GEN = {"2020": "1", "2022": "2", "2025": "3"}


def _watch_family_gen(text: str) -> tuple[str, str]:
    value = normalize_match_text(text).replace("_", " ").replace("-", " ")
    ultra = re.search(r"\bultra\s*(\d)?\b", value)
    if ultra:
        return "ultra", (ultra.group(1) or "")
    se = re.search(r"\bse\s*(\d{1,4})?\b", value)
    if se:
        raw = se.group(1) or ""
        return "se", SE_YEAR_TO_GEN.get(raw, raw)
    series = re.search(r"\b(?:series|watch|s)\s*(\d{1,2})\b", value)
    if series:
        return "series", series.group(1)
    return "", ""


def _watch_size(text: str) -> str:
    match = re.search(r"\b(\d{2})\s*mm\b", normalize_match_text(text).replace("_", " "))
    return match.group(1) if match else ""


def watch_match_penalty(product_name: str, url: str) -> float:
    slug = str(url or "").rsplit("/", 1)[-1]
    name_family, name_gen = _watch_family_gen(product_name)
    slug_family, slug_gen = _watch_family_gen(slug)

    penalty = 1.0
    if name_family and slug_family and name_family != slug_family:
        penalty *= 0.05
    if name_gen and slug_gen and name_gen != slug_gen:
        penalty *= 0.05

    name_size = _watch_size(product_name)
    slug_size = _watch_size(slug)
    if name_size and slug_size and name_size != slug_size:
        penalty *= 0.15

    return penalty
