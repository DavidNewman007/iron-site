"""Тонкий индекс карточек для бота заказов (`hybrid-products/bot-index.json`).

Зачем отдельный файл, а не манифесты категорий: бот держит индекс в KV и читает
его на КАЖДЫЙ показ карточки товара, чтобы решить, рисовать ли кнопку «📸 Фото и
характеристики». Манифесты для этого не годятся — один только `iphone-cards.json`
весит 464 КБ, а сопоставление строки прайса с карточкой на сайте размазано по
десятку правил на категорию (`resolveIphoneHybridMeta` и родня в `prices.js`).
Портировать эти правила в бота значило бы завести вторую копию хрупкой логики.

Поэтому сопоставление считается ЗДЕСЬ, один раз при сборке карточек, а боту
достаётся плоский словарь: ключ, который бот вычисляет из строки каталога в три
строки кода, и путь к источнику.

Ключ — `имя~страна~склад`, БЕЗ ЦЕНЫ. `product_id` цену содержит, а она меняется
по нескольку раз в день: ключ с ценой протухал бы к обеду (см. план 45,
«Почему это будет повторяться»). Имя и страна берутся из того же листа `Prices*`,
что читает Apps Script для `?action=catalog`, — это одна и та же строка прайса,
просто прочитанная двумя разными потребителями.
"""
from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from typing import Any

from .config import CATEGORY_MANIFEST, HYBRID_CATEGORIES, HYBRID_ROOT, SOURCES_ROOT

BOT_INDEX_PATH = HYBRID_ROOT / "bot-index.json"

_WAREHOUSE_RE = re.compile(r"s\s*([0-9])", re.I)


def normalize_key_part(value: Any) -> str:
    """Так же нормализует бот (`hybridKeyPart` в worker.js). Менять — в обоих местах."""
    text = str(value or "").lower().replace("ё", "е")
    text = re.sub(r"[^0-9a-zа-я]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def warehouse_tag(value: Any) -> str:
    """«(S2)» → «s2». В каталоге бота тот же склад приходит полем `source` = «S2»."""
    match = _WAREHOUSE_RE.search(str(value or ""))
    return f"s{match.group(1)}" if match else "s"


def bot_index_key(name: Any, country: Any, warehouse: Any) -> str:
    return f"{normalize_key_part(name)}~{normalize_key_part(country)}~{warehouse_tag(warehouse)}"


def _score(source: dict[str, Any]) -> tuple[int, int, str]:
    """Чем полнее источник, тем он лучше как представитель ключа.

    Под одним ключом обычно лежит несколько источников: `product_id` включает
    цену, поэтому каждая смена цены оставляет ещё один файл того же товара.
    Фотографии и характеристики у них одинаковые, но старые записи бывают
    «тонкими» (восстановлены из HTML, без характеристик) — берём самую полную,
    при равенстве самую свежую.
    """
    return (
        len(source.get("images_local") or []),
        len(source.get("specs") or []),
        str(source.get("updated_at") or ""),
    )


def build_bot_index() -> dict[str, Any]:
    best: dict[str, dict[str, Any]] = {}
    urls: dict[str, str] = {}

    for category in HYBRID_CATEGORIES:
        manifest_path = CATEGORY_MANIFEST[category]
        if manifest_path.exists():
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            for product_id, meta in (manifest.get("byId") or {}).items():
                if meta.get("url"):
                    urls[f"{category}/{product_id}"] = meta["url"]

        source_dir = SOURCES_ROOT / category
        if not source_dir.exists():
            continue
        for path in sorted(source_dir.glob("*.json")):
            try:
                source = json.loads(path.read_text(encoding="utf-8"))
            except json.JSONDecodeError:
                continue
            # Карточки без фотографий боту не нужны: кнопка «Фото и
            # характеристики» на таком товаре обманывает — лучше её не рисовать.
            if not (source.get("images_local") or []):
                continue
            key = bot_index_key(source.get("name"), source.get("country"), source.get("warehouse"))
            current = best.get(key)
            if current is None or _score(source) > _score(current):
                best[key] = source

    by_key: dict[str, list[Any]] = {}
    by_name: dict[str, str] = {}
    for key, source in best.items():
        ref = f"{source['category']}/{source['product_id']}"
        by_key[key] = [
            ref,
            len(source.get("images_local") or []),
            len(source.get("specs") or []),
            urls.get(ref, ""),
        ]
        # Запасной вход по одному имени: поставщик привозит ту же модель из
        # другой страны, и точный ключ перестаёт совпадать. Та же беда и то же
        # лечение, что у «Цена: временно недоступна» на карточках сайта.
        name_key = normalize_key_part(source.get("name"))
        if name_key and name_key not in by_name:
            by_name[name_key] = key

    return {
        "generated_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "count": len(by_key),
        "byKey": by_key,
        "byName": by_name,
    }


def save_bot_index() -> tuple[int, int]:
    index = build_bot_index()
    BOT_INDEX_PATH.write_text(
        json.dumps(index, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8"
    )
    return index["count"], BOT_INDEX_PATH.stat().st_size
