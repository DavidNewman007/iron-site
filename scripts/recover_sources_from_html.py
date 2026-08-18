#!/usr/bin/env python3
"""Восстановление _sources из уже сгенерированных русских карточек (18.08.2026).

Зачем: 225 карточек из 1204 были собраны до появления папки `_sources` (или их
источники потерялись), и пересобрать их из данных нечем — а значит, английской
версии у них не появилось бы. Между тем всё нужное лежит прямо в русском HTML:
название, таблица характеристик и список локальных картинок.

Скрипт работает ОФЛАЙН и намеренно не ходит в каталог поставщика: задача не
обновить данные, а вернуть возможность пересобирать страницу. Восстановленный
источник помечается `recovered_from_html`, чтобы потом было видно, что
`catalog_url` у него может отсутствовать.

Запуск:  python3 scripts/recover_sources_from_html.py [--dry-run]
"""

from __future__ import annotations

import argparse
import html as html_mod
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from hybrid.card_builder import build_card_from_source  # noqa: E402
from hybrid.config import HYBRID_CATEGORIES, HYBRID_ROOT  # noqa: E402
from hybrid.manifest import load_manifest, source_path  # noqa: E402

СТРОКА_ТАБЛИЦЫ = re.compile(r"<tr><td>(.*?)</td><td>(.*?)</td></tr>", re.S)
ЗАГОЛОВОК = re.compile(r"<h1>(.*?)</h1>", re.S)
КАРТИНКИ = re.compile(r"const IMAGES = (\[.*?\]);", re.S)


def разобрать_карточку(путь: Path) -> dict | None:
    html = путь.read_text(encoding="utf-8")

    заголовок = ЗАГОЛОВОК.search(html)
    картинки = КАРТИНКИ.search(html)
    if not заголовок or not картинки:
        return None

    images_local = [
        str(ref).replace("../../", "")
        for ref in json.loads(картинки.group(1))
        if ref and str(ref).strip()
    ]
    specs = [
        {"key": html_mod.unescape(k).strip(), "value": html_mod.unescape(v).strip()}
        for k, v in СТРОКА_ТАБЛИЦЫ.findall(html)
    ]
    return {
        "name": html_mod.unescape(заголовок.group(1)).strip(),
        "specs": specs,
        "images_local": images_local,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    восстановлено, пропущено = 0, []
    for категория in HYBRID_CATEGORIES:
        manifest = load_manifest(категория)
        # Ключ манифеста — product_id, а имя файла берём из его же url: у части
        # товаров slug не выводится из id (в нём цена и склад).
        по_слагу = {
            str(meta.get("url") or "").rsplit("/", 1)[-1].replace(".html", ""): (pid, meta)
            for pid, meta in manifest.get("byId", {}).items()
        }
        for файл in sorted((HYBRID_ROOT / категория).glob("*.html")):
            slug = файл.stem
            if source_path(категория, по_слагу.get(slug, ("", {}))[0]).exists():
                continue
            if slug not in по_слагу:
                пропущено.append({"file": str(файл), "why": "нет записи в манифесте"})
                continue
            product_id, meta = по_слагу[slug]
            разобранное = разобрать_карточку(файл)
            if not разобранное:
                пропущено.append({"file": str(файл), "why": "не разобрался HTML"})
                continue

            source = {
                "product_id": product_id,
                "category": категория,
                "file_slug": slug,
                "name": разобранное["name"] or meta.get("name") or product_id,
                "country": "",
                "warehouse": meta.get("warehouse") or "",
                "price": meta.get("price") or 0,
                "catalog_url": "",
                "catalog_title": meta.get("name") or "",
                "specs": разобранное["specs"],
                "images_remote": [],
                "images_local": разобранное["images_local"],
                "recovered_from_html": True,
            }
            if not args.dry_run:
                build_card_from_source(source)
            восстановлено += 1

    print(
        json.dumps(
            {"recovered": восстановлено, "skipped": пропущено, "skipped_count": len(пропущено)},
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
