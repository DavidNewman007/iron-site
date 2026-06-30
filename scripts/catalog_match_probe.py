#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from hybrid.catalog_match import probe_category_products, save_probe_result  # noqa: E402
from hybrid.config import HYBRID_CATEGORIES, PROBE_DIR  # noqa: E402
from hybrid.price_parser import load_products_from_sheet  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description="Match price rows with dr-store catalog pages.")
    parser.add_argument("--category", choices=HYBRID_CATEGORIES, required=True)
    parser.add_argument("--product-id", action="append", default=[], help="Limit probe to specific product IDs")
    parser.add_argument("--refresh-sitemap", action="store_true")
    parser.add_argument("--min-score", type=float, default=0.45)
    parser.add_argument("--dry-run", action="store_true", help="Score only, do not scrape product pages")
    args = parser.parse_args()

    products, _updated = load_products_from_sheet()
    category_products = [p for p in products if p.category == args.category]
    if args.product_id:
        wanted = set(args.product_id)
        category_products = [p for p in category_products if p.id in wanted]

    payload = probe_category_products(
        category_products,
        min_score=args.min_score,
        force_refresh_sitemap=args.refresh_sitemap,
        fetch_details=not args.dry_run,
    )
    path = save_probe_result(args.category, payload)
    matched = sum(1 for item in payload["matches"].values() if item.get("status") == "matched")
    print(
        json.dumps(
            {
                "category": args.category,
                "probed": len(category_products),
                "matched": matched,
                "output": str(path.relative_to(ROOT)),
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
