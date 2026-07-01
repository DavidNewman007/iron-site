#!/usr/bin/env python3
"""Build one or more hybrid cards incrementally from probe/source JSON."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from hybrid.audit import audit_all, missing_product_ids  # noqa: E402
from hybrid.card_builder import build_card_from_source, build_source_from_match  # noqa: E402
from hybrid.catalog_match import probe_category_products, save_probe_result  # noqa: E402
from hybrid.config import HYBRID_CATEGORIES, PROBE_DIR  # noqa: E402
from hybrid.eligibility import hybrid_skip_reason  # noqa: E402
from hybrid.images import mirror_images  # noqa: E402
from hybrid.existing import card_already_published  # noqa: E402
from hybrid.manifest import load_source, save_source  # noqa: E402
from hybrid.price_parser import load_products_from_sheet  # noqa: E402
from hybrid.scraper import scrape_catalog_product  # noqa: E402


def load_probe(category: str) -> dict:
    path = PROBE_DIR / f"catalog-match-probe-{category}.json"
    if not path.exists():
        raise FileNotFoundError(f"Probe file not found: {path}")
    return json.loads(path.read_text(encoding="utf-8"))


def refresh_source_from_catalog(source: dict) -> dict:
    url = source.get("catalog_url")
    if not url:
        raise RuntimeError(f"No catalog_url in source for {source.get('product_id')}")
    catalog = scrape_catalog_product(url)
    source["catalog_title"] = catalog.title
    source["specs"] = [{"key": k, "value": v} for k, v in catalog.specs]
    source["images_remote"] = catalog.images_remote
    source["images_local"] = mirror_images(catalog.images_remote)
    return source


def build_from_probe(category: str, product_ids: list[str], *, refresh_match: bool = False) -> tuple[list[dict], list[dict]]:
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
        if card_already_published(category, product_id):
            continue
        try:
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


def main() -> int:
    parser = argparse.ArgumentParser(description="Incrementally build hybrid product cards.")
    parser.add_argument("--category", choices=HYBRID_CATEGORIES)
    parser.add_argument("--product-id", action="append", default=[], help="Build specific product ID(s)")
    parser.add_argument("--missing-only", action="store_true", help="Build only cards missing from manifests/files")
    parser.add_argument("--all-in-category", action="store_true", help="Rebuild every card in category from probe/source")
    parser.add_argument("--refresh-match", action="store_true", help="Re-run catalog match before build")
    parser.add_argument("--from-source", action="store_true", help="Rebuild HTML from existing _sources JSON only")
    args = parser.parse_args()

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
        print(json.dumps({"built": results}, ensure_ascii=False, indent=2))
        return 0

    products, _ = load_products_from_sheet()
    by_id = {p.id: p for p in products}
    product_ids = list(args.product_id)

    if args.missing_only:
        report = audit_all(products)
        product_ids = missing_product_ids(report, args.category)
    elif args.all_in_category:
        if not args.category:
            raise SystemExit("--all-in-category requires --category")
        product_ids = [
            p.id
            for p in products
            if p.category == args.category and hybrid_skip_reason(p) is None
        ]

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
        if not product:
            continue
        grouped.setdefault(product.category, []).append(pid)

    results: list[dict] = []
    failures: list[dict] = []
    for category, ids in grouped.items():
        built, failed = build_from_probe(category, ids, refresh_match=args.refresh_match)
        results.extend(built)
        failures.extend(failed)

    print(
        json.dumps(
            {"built": results, "count": len(results), "failed": failures, "failed_count": len(failures)},
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0 if results or not failures else 1


if __name__ == "__main__":
    raise SystemExit(main())
