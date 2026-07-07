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


def airpods_max_generation(name: str) -> str | None:
    normalized = normalize_match_text(name)
    if re.search(r"max\s+2026|max\s*2\b", normalized):
        return "2026"
    if re.search(r"max\s+2024", normalized):
        return "2024"
    return None


def airpods_match_penalty(name: str, url: str) -> float:
    generation = airpods_max_generation(name)
    if not generation:
        return 1.0
    slug = url.rsplit("/", 1)[-1].lower()
    if generation == "2026":
        if "airpods-max-2-" in slug or slug.endswith("airpods-max-2"):
            return 5.0
        if "airpods-max-2024" in slug or "-2024-" in slug:
            return 0.001
    if generation == "2024":
        if "airpods-max-2024" in slug or "-2024-" in slug:
            return 2.0
        if "airpods-max-2-" in slug or slug.endswith("airpods-max-2"):
            return 0.05
    return 1.0


def is_fitbit_product(name: str) -> bool:
    normalized = normalize_match_text(name)
    return "fitbit" in normalized or "google fitbit" in normalized


FITBIT_COLOR_ALIASES: dict[str, list[str]] = {
    "lavender": ["lavender"],
    "black": ["black", "obsidian"],
    "berry": ["berry"],
    "rye": ["rye"],
    "fog": ["fog"],
}


def fitbit_color_keys(name: str) -> set[str]:
    normalized = normalize_match_text(name)
    found: set[str] = set()
    for canonical, aliases in FITBIT_COLOR_ALIASES.items():
        for alias in aliases:
            if alias in normalized:
                found.add(canonical)
                break
    return found


def fitbit_match_penalty(name: str, url: str) -> float:
    if not is_fitbit_product(name):
        return 1.0
    slug = url.rsplit("/", 1)[-1].lower()
    if "fitbit" not in slug and "fitnes-braslet" not in slug:
        return 0.02
    colors = fitbit_color_keys(name)
    if colors:
        for color in colors:
            for alias in FITBIT_COLOR_ALIASES[color]:
                if alias in slug:
                    return 1.0
        return 0.12
    return 1.0


def watch_model_code(name: str) -> str | None:
    match = re.search(r"\b([A-Z]{1,2}\d[A-Z0-9]{2,4})\b", str(name or ""))
    return match.group(1).lower() if match else None


def watch_match_penalty(name: str, url: str) -> float:
    if is_fitbit_product(name):
        return fitbit_match_penalty(name, url)
    slug = url.rsplit("/", 1)[-1].lower()
    if not is_fitbit_product(name) and ("fitbit" in slug or "fitnes-braslet-google" in slug):
        return 0.02

    multiplier = 1.0
    code = watch_model_code(name)
    if code and code in slug.replace("_", "-"):
        multiplier *= 2.5

    normalized = normalize_match_text(name)
    if re.search(r"series\s+ultra\s+\d+", normalized) or re.search(r"\bultra\s+\d+", normalized):
        if "ultra-3" in slug or "ultra_3" in slug:
            multiplier *= 1.6
        elif "series-" in slug and "ultra" not in slug:
            multiplier *= 0.2
        if "alpine" in normalized and "alpine" in slug:
            multiplier *= 1.4
        if "black" in normalized and "black" in slug:
            multiplier *= 1.2
        size = re.search(r"\b([lsm]/[lsm]|l\b|m\b|s\b)\b", normalized)
        if size and size.group(1).replace("/", "") in slug.replace("-", ""):
            multiplier *= 1.1

    return min(multiplier, 3.0)
