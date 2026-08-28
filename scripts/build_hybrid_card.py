#!/usr/bin/env python3
"""Build one or more hybrid cards incrementally from probe/source JSON."""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from hybrid.audit import audit_all, missing_product_ids  # noqa: E402
from hybrid.audit_images import find_cards_needing_repair  # noqa: E402
from hybrid.audit_sources import find_cards_missing_specs, find_stale_matches  # noqa: E402
from hybrid.card_builder import build_card_from_source, build_source_from_match  # noqa: E402
from hybrid.catalog_match import probe_category_products, save_probe_result  # noqa: E402
from hybrid.config import HYBRID_CATEGORIES, PROBE_DIR  # noqa: E402
from hybrid.eligibility import hybrid_skip_reason  # noqa: E402
from hybrid.images import mirror_images  # noqa: E402
from hybrid.existing import card_already_published  # noqa: E402
from hybrid.manifest import load_manifest, load_source, save_source  # noqa: E402
from hybrid.bot_index import save_bot_index  # noqa: E402
from hybrid.price_parser import load_products_from_sheet  # noqa: E402
from hybrid.image_selection import is_ui_swatch_image, keep_product_folder_images  # noqa: E402
from hybrid.scraper import sanitize_specs, scrape_catalog_product  # noqa: E402
from hybrid.source_repair import repair_or_bootstrap_source  # noqa: E402


def load_probe(category: str) -> dict:
    path = PROBE_DIR / f"catalog-match-probe-{category}.json"
    if not path.exists():
        raise FileNotFoundError(f"Probe file not found: {path}")
    return json.loads(path.read_text(encoding="utf-8"))


def refresh_source_from_catalog(source: dict) -> dict:
    url = source.get("catalog_url")
    if not url:
        raise RuntimeError(f"No catalog_url in source for {source.get('product_id')}")
    catalog = scrape_catalog_product(
        url,
        category=str(source.get("category") or ""),
        product_name=str(source.get("name") or ""),
    )
    source["catalog_title"] = catalog.title
    source["specs"] = [{"key": k, "value": v} for k, v in catalog.specs]
    source["images_remote"] = catalog.images_remote
    source["images_local"] = mirror_images(catalog.images_remote)
    return source


def find_catalog_url_fallback(category: str, product_id: str, product_name: str) -> str:
    """Reuse catalog URL from another card with the same product name."""
    from hybrid.config import SOURCES_ROOT

    target = re.sub(r"\s+", " ", str(product_name or "").strip().lower())
    if not target:
        return ""
    sources_dir = SOURCES_ROOT / category
    if not sources_dir.is_dir():
        return ""
    for path in sources_dir.glob("*.json"):
        if path.stem == product_id:
            continue
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        name = re.sub(r"\s+", " ", str(data.get("name") or "").strip().lower())
        url = str(data.get("catalog_url") or "").strip()
        if name == target and url:
            return url
    return ""


def build_from_probe(
    category: str,
    product_ids: list[str],
    *,
    refresh_match: bool = False,
    force_rebuild: bool = False,
) -> tuple[list[dict], list[dict]]:
    products, _ = load_products_from_sheet()
    all_by_id = {p.id: p for p in products}
    category_by_id = {p.id: p for p in products if p.category == category}

    if refresh_match or not (PROBE_DIR / f"catalog-match-probe-{category}.json").exists():
        subset = [category_by_id[pid] for pid in product_ids if pid in category_by_id]
        payload = probe_category_products(subset, fetch_details=True)
        save_probe_result(category, payload)
        probe = payload
    else:
        probe = load_probe(category)

    built: list[dict] = []
    failed: list[dict] = []
    for product_id in product_ids:
        product = all_by_id.get(product_id)
        if product and hybrid_skip_reason(product):
            continue
        if card_already_published(category, product_id) and not force_rebuild:
            continue
        try:
            if force_rebuild:
                repaired = repair_or_bootstrap_source(category, product_id)
                if repaired:
                    built.append(build_card_from_source(repaired))
                    continue

                existing = load_source(category, product_id)
                match = probe.get("matches", {}).get(product_id)
                if match and match.get("status") == "matched":
                    source = build_source_from_match(match)
                    if existing and not refresh_match:
                        for key in ("catalog_url", "country"):
                            if existing.get(key):
                                source[key] = existing[key]
                elif existing and existing.get("catalog_url"):
                    source = dict(existing)
                    source.setdefault("product_id", product_id)
                    source.setdefault("category", category)
                else:
                    manifest = load_manifest(category)
                    meta = manifest.get("byId", {}).get(product_id, {})
                    catalog_url = find_catalog_url_fallback(category, product_id, meta.get("name") or "")
                    if catalog_url:
                        source = {
                            "product_id": product_id,
                            "category": category,
                            "name": meta.get("name") or product_id,
                            "country": "",
                            "warehouse": meta.get("warehouse") or "",
                            "price": meta.get("price") or 0,
                            "catalog_url": catalog_url,
                        }
                    else:
                        failed.append(
                            {
                                "product_id": product_id,
                                "error": f"catalog match status: {match.get('status') if match else 'missing'}",
                            }
                        )
                        continue
                source = refresh_source_from_catalog(source)
                built.append(build_card_from_source(source))
                continue

            existing = load_source(category, product_id)
            if existing and not refresh_match:
                if existing.get("images_remote") and not existing.get("images_local"):
                    existing["images_local"] = mirror_images(existing["images_remote"])
                built.append(build_card_from_source(existing))
                continue

            match = probe.get("matches", {}).get(product_id)
            if not match or match.get("status") != "matched":
                failed.append(
                    {
                        "product_id": product_id,
                        "error": f"catalog match status: {match.get('status') if match else 'missing'}",
                    }
                )
                continue
            source = build_source_from_match(match)
            built.append(build_card_from_source(source))
        except Exception as exc:  # noqa: BLE001
            failed.append({"product_id": product_id, "error": str(exc)})
    return built, failed


def drop_card(category: str, product_id: str) -> None:
    """Снести карточку целиком: HTML (ru+en), источник и запись манифеста."""
    from hybrid.config import HYBRID_ROOT, HYBRID_ROOT_EN, SOURCES_ROOT
    from hybrid.manifest import load_manifest, remove_manifest_entry

    meta = (load_manifest(category).get("byId") or {}).get(product_id) or {}
    file_slug = str(meta.get("url") or "").rsplit("/", 1)[-1].replace(".html", "")
    if not file_slug:
        source = load_source(category, product_id) or {}
        file_slug = str(source.get("file_slug") or "")
    for path in (
        HYBRID_ROOT / category / f"{file_slug}.html" if file_slug else None,
        HYBRID_ROOT_EN / category / f"{file_slug}.html" if file_slug else None,
        SOURCES_ROOT / category / f"{product_id}.json",
    ):
        if path and path.exists():
            path.unlink()
    remove_manifest_entry(category, product_id)


def refresh_bot_index() -> dict:
    """Пересобрать индекс для бота заказов.

    Зовётся в конце ЛЮБОЙ ветки, которая трогала карточки: индекс собирается из
    файлов на диске за секунду, а бот по нему решает, показывать ли кнопку «📸
    Фото и характеристики». Отстанет индекс — кнопка либо пропадёт у товара с
    карточкой, либо появится там, где фотографий нет (28.08.2026, план 45).
    """
    count, size = save_bot_index()
    return {"count": count, "bytes": size}


def main() -> int:
    parser = argparse.ArgumentParser(description="Incrementally build hybrid product cards.")
    parser.add_argument("--category", choices=HYBRID_CATEGORIES)
    parser.add_argument("--product-id", action="append", default=[], help="Build specific product ID(s)")
    parser.add_argument("--missing-only", action="store_true", help="Build only cards missing from manifests/files")
    parser.add_argument("--all-in-category", action="store_true", help="Rebuild every card in category from probe/source")
    parser.add_argument("--refresh-match", action="store_true", help="Re-run catalog match before build")
    parser.add_argument("--force-rebuild", action="store_true", help="Rebuild existing cards from catalog (re-scrape images)")
    parser.add_argument(
        "--repair-images",
        action="store_true",
        help="Audit images and rebuild only flagged cards (re-scrape from catalog)",
    )
    parser.add_argument(
        "--repair-cards",
        action="store_true",
        help="Пересобрать карточки, собранные по устаревшим правилам: страница "
             "поставщика от другого товара или пустые характеристики "
             "(scripts/audit_hybrid_sources.py покажет, что найдено)",
    )
    parser.add_argument(
        "--refilter-images",
        action="store_true",
        help="Прогнать сохранённые галереи через нынешние правила отбора картинок "
             "(свотчи выбора цвета, чужие папки — блок «с этим товаром покупают») и "
             "пересобрать HTML только у изменившихся карточек. Сеть не трогает",
    )
    parser.add_argument(
        "--resanitize",
        action="store_true",
        help="Прогнать сохранённые характеристики через нынешние правила чистки "
             "(SPEC_DROP_KEYS, SPEC_DROP_KEY_PATTERNS, COMPETITOR_PATTERNS) и "
             "пересобрать HTML только у изменившихся карточек. Сеть не трогает",
    )
    parser.add_argument("--from-source", action="store_true", help="Rebuild HTML from existing _sources JSON only")
    parser.add_argument(
        "--all-sources",
        action="store_true",
        help="Rebuild HTML for EVERY saved source, without network. Нужен после правки шаблона "
             "или словаря переводов: пересобирает русскую и английскую версии всех карточек.",
    )
    args = parser.parse_args()

    if args.repair_images or args.repair_cards:
        args.force_rebuild = True

    if args.refilter_images:
        # Чужие кадры и свотчи уже лежат в сохранённой галерее — чтобы их убрать,
        # заново ходить к поставщику не нужно: правила применимы прямо к списку
        # адресов. Списки remote и local идут парами по индексу, поэтому чистятся
        # синхронно, иначе подпись «фото N» разъедется с файлом (28.08.2026).
        from hybrid.config import SOURCES_ROOT

        изменено, ошибки = [], []
        категории = [args.category] if args.category else sorted(
            d.name for d in SOURCES_ROOT.iterdir() if d.is_dir()
        )
        for категория in категории:
            for путь in sorted((SOURCES_ROOT / категория).glob("*.json")):
                try:
                    source = json.loads(путь.read_text(encoding="utf-8"))
                    remote = source.get("images_remote") or []
                    local = source.get("images_local") or []
                    # Источники, восстановленные из HTML, помнят только локальные
                    # файлы — по ним о папке поставщика судить нечем.
                    if len(remote) < 2:
                        continue
                    if len(remote) != len(local):
                        # Часть картинок не скачалась, и соответствие «i-я remote =
                        # i-я local» нарушено. Трогать local нельзя — карточка
                        # показывает именно его, — но сам список адресов чистим,
                        # иначе следующая пересборка снова притащит чужой кадр.
                        чистые = [r for r in remote if not is_ui_swatch_image(r)]
                        чистые = keep_product_folder_images(чистые, source.get("catalog_url") or "")
                        if чистые and len(чистые) != len(remote):
                            source["images_remote"] = чистые
                            save_source(source)
                            изменено.append({
                                "product_id": source.get("product_id"),
                                "category": категория,
                                "убрано": len(remote) - len(чистые),
                                "только_адреса": True,
                            })
                        continue
                    пары = [(r, l) for r, l in zip(remote, local) if not is_ui_swatch_image(r)]
                    if not пары:
                        continue
                    оставить = set(keep_product_folder_images(
                        [r for r, _ in пары], source.get("catalog_url") or ""
                    ))
                    пары = [(r, l) for r, l in пары if r in оставить]
                    if not пары or len(пары) == len(remote):
                        continue
                    source["images_remote"] = [r for r, _ in пары]
                    source["images_local"] = [l for _, l in пары]
                    build_card_from_source(source)
                    изменено.append({
                        "product_id": source.get("product_id"),
                        "category": категория,
                        "убрано": len(remote) - len(пары),
                    })
                except Exception as exc:  # noqa: BLE001
                    ошибки.append({"file": str(путь), "error": str(exc)})
        print(json.dumps(
            {
                "cleaned": len(изменено),
                "removed_images": sum(x["убрано"] for x in изменено),
                "failed": ошибки,
                "bot_index": refresh_bot_index(),
            },
            ensure_ascii=False, indent=2,
        ))
        return 0 if not ошибки else 1

    if args.resanitize:
        # Правила чистки характеристик со временем прибавляются (28.08.2026 — гарантия
        # поставщика), а карточки уже собраны и сеть для этого не нужна: чужая строка
        # лежит в сохранённом источнике. Пересобираем HTML только у тех, где что-то
        # реально убралось, — иначе перегенерация тронула бы полторы тысячи файлов и
        # правку стало бы не видно в git.
        from hybrid.config import SOURCES_ROOT

        изменено, ошибки = [], []
        категории = [args.category] if args.category else sorted(
            d.name for d in SOURCES_ROOT.iterdir() if d.is_dir()
        )
        for категория in категории:
            for путь in sorted((SOURCES_ROOT / категория).glob("*.json")):
                try:
                    source = json.loads(путь.read_text(encoding="utf-8"))
                    было = [(s.get("key", ""), s.get("value", "")) for s in source.get("specs") or []]
                    стало = sanitize_specs(было)
                    if стало == было:
                        continue
                    source["specs"] = [{"key": k, "value": v} for k, v in стало]
                    save_source(source)
                    build_card_from_source(source)
                    изменено.append({
                        "product_id": source.get("product_id"),
                        "category": категория,
                        "убрано": len(было) - len(стало),
                    })
                except Exception as exc:  # noqa: BLE001
                    ошибки.append({"file": str(путь), "error": str(exc)})
        print(json.dumps(
            {
                "cleaned": len(изменено),
                "removed_rows": sum(x["убрано"] for x in изменено),
                "failed": ошибки,
                "bot_index": refresh_bot_index(),
            },
            ensure_ascii=False, indent=2,
        ))
        return 0 if not ошибки else 1

    if args.all_sources:
        # Перегенерация из сохранённых источников: сеть не трогаем, каталог
        # поставщика не опрашиваем — только пересобираем HTML по текущему
        # шаблону. Добавлено 18.08.2026 вместе с английскими карточками.
        from hybrid.config import SOURCES_ROOT

        собрано, ошибки = 0, []
        категории = [args.category] if args.category else sorted(
            d.name for d in SOURCES_ROOT.iterdir() if d.is_dir()
        )
        for категория in категории:
            for путь in sorted((SOURCES_ROOT / категория).glob("*.json")):
                try:
                    source = json.loads(путь.read_text(encoding="utf-8"))
                    build_card_from_source(source)
                    собрано += 1
                except Exception as exc:  # noqa: BLE001
                    ошибки.append({"file": str(путь), "error": str(exc)})
        индекс = refresh_bot_index()
        print(json.dumps({"rebuilt": собрано, "failed": ошибки, "bot_index": индекс},
                         ensure_ascii=False, indent=2))
        return 0 if not ошибки else 1

    if args.from_source:
        if not args.product_id:
            raise SystemExit("--from-source requires --product-id")
        results = []
        for product_id in args.product_id:
            category = args.category or product_id.split("-")[0]
            source = load_source(category, product_id)
            if not source:
                raise SystemExit(f"Source not found: {category}/{product_id}")
            results.append(build_card_from_source(source))
        print(json.dumps({"built": results, "bot_index": refresh_bot_index()},
                         ensure_ascii=False, indent=2))
        return 0

    products, _ = load_products_from_sheet()
    by_id = {p.id: p for p in products}
    product_ids = list(args.product_id)

    if args.missing_only:
        report = audit_all(products)
        product_ids.extend(missing_product_ids(report, args.category))

    if args.repair_images:
        if not args.category:
            raise SystemExit("--repair-images requires --category")
        product_ids.extend(find_cards_needing_repair(args.category))
    if args.repair_cards:
        if not args.category:
            raise SystemExit("--repair-cards requires --category")
        # Чужая страница поставщика лечится только пересбором с нуля: пока
        # источник на месте, repair_or_bootstrap_source возьмёт из него тот же
        # неверный catalog_url. Поэтому сносим источник, HTML и запись
        # манифеста — и позиция становится «отсутствующей», а её собирают
        # заново по нынешним правилам сопоставления (28.08.2026).
        stale = find_stale_matches(args.category)
        for item in stale:
            drop_card(args.category, str(item["product_id"]))
        product_ids.extend(str(item["product_id"]) for item in stale)
        # Пустые характеристики чинятся мягко: источник остаётся, дозабираем
        # характеристики со страницы поставщика (см. repair_or_bootstrap_source).
        product_ids.extend(
            str(item["product_id"]) for item in find_cards_missing_specs(args.category)
        )
        args.refresh_match = True

    if args.all_in_category:
        if not args.category:
            raise SystemExit("--all-in-category requires --category")
        product_ids.extend(
            p.id
            for p in products
            if p.category == args.category and hybrid_skip_reason(p) is None
        )

    product_ids = list(dict.fromkeys(product_ids))

    product_ids = [
        pid
        for pid in product_ids
        if pid not in by_id or hybrid_skip_reason(by_id[pid]) is None
    ]

    if not product_ids:
        print(json.dumps({"built": [], "message": "Nothing to build"}, ensure_ascii=False, indent=2))
        return 0

    grouped: dict[str, list[str]] = {}
    for pid in product_ids:
        product = by_id.get(pid)
        category = product.category if product else (args.category or pid.split("-", 1)[0])
        if category not in HYBRID_CATEGORIES:
            continue
        grouped.setdefault(category, []).append(pid)

    results: list[dict] = []
    failures: list[dict] = []
    patched_categories: list[str] = []
    for category, ids in grouped.items():
        built, failed = build_from_probe(
            category,
            ids,
            refresh_match=args.refresh_match,
            force_rebuild=args.force_rebuild,
        )
        results.extend(built)
        failures.extend(failed)
        if built:
            patched_categories.append(category)

    for category in patched_categories:
        subprocess.run(
            ["node", str(ROOT / "scripts" / "patch_hybrid_covers.js"), "--category", category],
            cwd=ROOT,
            check=False,
        )

    print(
        json.dumps(
            {
                "built": results,
                "count": len(results),
                "failed": failures,
                "failed_count": len(failures),
                "bot_index": refresh_bot_index(),
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0 if results or not failures else 1


if __name__ == "__main__":
    raise SystemExit(main())
