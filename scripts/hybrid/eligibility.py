from __future__ import annotations

import re

from .config import HYBRID_CATEGORIES
from .price_parser import Product

# Позиции без карточки dr-store: услуги, гравировка, сервисные строки прайса.
SKIP_HYBRID_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"гравиров", re.I), "service_engraving"),
    (re.compile(r"замена\s+кноп", re.I), "service_keyboard"),
    (re.compile(r"^\s*⌨", re.I), "service_keyboard"),
    (re.compile(r"^\s*🔧", re.I), "service_repair"),
    (re.compile(r"диагност", re.I), "service_repair"),
    (re.compile(r"ремонт", re.I), "service_repair"),
]


def hybrid_skip_reason(product: Product | dict) -> str | None:
    """Причина пропуска hybrid-карточки или None, если позицию можно собирать."""
    if isinstance(product, Product):
        category = product.category
        name = product.name or ""
    else:
        category = str(product.get("category") or "")
        name = str(product.get("name") or "")

    if category not in HYBRID_CATEGORIES:
        return "category_not_supported"

    for pattern, reason in SKIP_HYBRID_PATTERNS:
        if pattern.search(name):
            return reason
    return None


def is_hybrid_eligible(product: Product | dict) -> bool:
    return hybrid_skip_reason(product) is None
