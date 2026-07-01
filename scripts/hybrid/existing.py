from __future__ import annotations

from .config import PUBLIC
from .manifest import load_manifest


def card_already_published(category: str, product_id: str) -> bool:
    """True if карточка уже есть в манифесте и HTML-файл на месте — не трогаем."""
    manifest = load_manifest(category)
    meta = manifest.get("byId", {}).get(product_id)
    if not meta:
        return False
    url = str(meta.get("url") or "").strip()
    if not url:
        return False
    return (PUBLIC / url).is_file()
