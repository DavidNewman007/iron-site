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
from hybrid.eligibility import hybrid_skip_reason  # noqa: E402
from hybrid.price_parser import load_products_from_sheet  # noqa: E402


def load_requested_ids(args: argparse.Namespace) -> list[str]:
    ids: list[str] = list(args.product_id or [])
    if args.ids_file:
        text = Path(args.ids_file).read_text(encoding="utf-8")
        ids.extend(line.strip() for line in text.splitlines() if line.strip())
    # dedupe preserving order
    seen: set[str] = set()
    ordered: list[str] = []
    for product_id in ids:
        if product_id in seen:
            continue
        seen.add(product_id)
        ordered.append(product_id)
    return ordered


def main() -> int:
    parser = argparse.ArgumentParser(description="Match price rows with dr-store catalog pages.")
    parser.add_argument("--category", choices=HYBRID_CATEGORIES, required=True)
    parser.add_argument(
        "--product-id",
        action="append",
        default=[],
        help="Limit probe to specific product IDs (use --product-id=-id for leading dash)",
    )
    parser.add_argument(
        "--ids-file",
        help="File with product IDs to probe, one per line (preferred for orchestrator)",
    )
    parser.add_argument("--refresh-sitemap", action="store_true")
    parser.add_argument("--min-score", type=float, default=0.45)
    parser.add_argument("--dry-run", action="store_true", help="Score only, do not scrape product pages")
    args = parser.parse_args()

    requested_ids = load_requested_ids(args)
    products, _updated = load_products_from_sheet()
    category_products = [p for p in products if p.category == args.category]

    skipped: list[dict] = []
    eligible: list = []
    for product in category_products:
        reason = hybrid_skip_reason(product)
        if reason:
            if not requested_ids or product.id in requested_ids:
                skipped.append({"product_id": product.id, "name": product.name, "reason": reason})
            continue
        eligible.append(product)

    if requested_ids:
        wanted = set(requested_ids)
        eligible = [p for p in eligible if p.id in wanted]

    payload = probe_category_products(
        eligible,
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
                "probed": len(eligible),
                "matched": matched,
                "skipped": skipped,
                "output": str(path.relative_to(ROOT)),
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
