"""Аудит СОХРАНЁННЫХ источников карточек, а не картинок в них.

Зачем отдельно от `audit_images`: там проверяется, что в карточке достаточно
фотографий и файлы на месте. Здесь — две другие беды, которые аудит картинок не
видит вовсе (обе найдены 28.08.2026 по жалобе владельца «много карточек Apple
Watch без фотографий и характеристик»):

1. **Карточка собрана по устаревшим правилам сопоставления.** Источник хранит
   `catalog_url`, выбранный тогдашним алгоритмом. Правила с тех пор поумнели —
   например, 27.08.2026 появилась сверка поколения часов, — и 33 карточки
   Apple Watch указывали на чужое поколение: «S11 42mm Black» на страницу
   Series 10, «SE3 44mm Midnight» на SE 2022. Картинки при этом на месте и
   аудит картинок молчит: они просто не от того товара.

2. **Пустые характеристики.** Источник, восстановленный из HTML или скопированный
   у соседа, приходит с `specs: []`. У поставщика характеристики есть (у SE 3 —
   39 строк), просто их никто не забрал.
"""
from __future__ import annotations

import json

from .catalog_match import GENERIC_MATCH_CATEGORIES, generic_match_penalty
from .config import SOURCES_ROOT
from .product_match import iphone_match_penalty, watch_match_penalty

# Ниже этого штрафа страница у поставщика считается чужой. 0.5 — потому что все
# проверки штрафуют кратно (0.4, 0.25, 0.15, 0.05): один сработавший запрет уже
# уводит ниже порога, а «почти совпало» остаётся выше.
STALE_MATCH_THRESHOLD = 0.5


def source_match_penalty(category: str, name: str, catalog_url: str) -> float:
    """Насколько сегодняшние правила доверяют сохранённому адресу товара."""
    if not catalog_url:
        return 1.0
    if category == "watch":
        return watch_match_penalty(name, catalog_url)
    if category == "iphone":
        return iphone_match_penalty(name, catalog_url)
    if category in GENERIC_MATCH_CATEGORIES:
        slug = catalog_url.rsplit("/", 1)[-1].replace("-", " ")
        return generic_match_penalty(name, slug)
    return 1.0


def iter_sources(category: str):
    directory = SOURCES_ROOT / category
    if not directory.is_dir():
        return
    for path in sorted(directory.glob("*.json")):
        try:
            yield path, json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue


def find_stale_matches(category: str) -> list[dict]:
    """Карточки, чей адрес у поставщика сегодняшние правила бы отвергли."""
    stale: list[dict] = []
    for _, source in iter_sources(category):
        url = str(source.get("catalog_url") or "")
        if not url:
            continue
        penalty = source_match_penalty(category, str(source.get("name") or ""), url)
        if penalty < STALE_MATCH_THRESHOLD:
            stale.append(
                {
                    "product_id": source.get("product_id"),
                    "name": source.get("name"),
                    "penalty": round(penalty, 3),
                    "catalog_url": url,
                }
            )
    return stale


def find_cards_missing_specs(category: str) -> list[dict]:
    """Карточки с пустой таблицей характеристик."""
    empty: list[dict] = []
    for _, source in iter_sources(category):
        if source.get("specs"):
            continue
        empty.append(
            {
                "product_id": source.get("product_id"),
                "name": source.get("name"),
                "catalog_url": source.get("catalog_url") or "",
            }
        )
    return empty


def audit_category(category: str) -> dict:
    stale = find_stale_matches(category)
    empty = find_cards_missing_specs(category)
    return {
        "category": category,
        "stale_match": stale,
        "empty_specs": empty,
        "summary": {
            "category": category,
            "stale_match": len(stale),
            "empty_specs": len(empty),
        },
    }
