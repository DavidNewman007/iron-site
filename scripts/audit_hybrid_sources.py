#!/usr/bin/env python3
"""Аудит источников hybrid-карточек: чужая страница поставщика и пустые характеристики.

    python3 scripts/audit_hybrid_sources.py            # сводка по всем категориям
    python3 scripts/audit_hybrid_sources.py --json     # подробности
    python3 scripts/audit_hybrid_sources.py --repair-ids --category watch

Чинит найденное — `build_hybrid_card.py --repair-cards --category <кат>`.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from hybrid.audit_sources import audit_category  # noqa: E402
from hybrid.config import HYBRID_CATEGORIES  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description="Audit hybrid card sources.")
    parser.add_argument("--category", choices=HYBRID_CATEGORIES)
    parser.add_argument("--json", action="store_true")
    parser.add_argument(
        "--repair-ids",
        action="store_true",
        help="Печатать product_id, требующие пересборки (по одному в строке)",
    )
    args = parser.parse_args()

    categories = [args.category] if args.category else HYBRID_CATEGORIES
    reports = [audit_category(category) for category in categories]

    if args.repair_ids:
        ids: set[str] = set()
        for report in reports:
            for key in ("stale_match", "empty_specs"):
                for item in report[key]:
                    if item.get("product_id"):
                        ids.add(str(item["product_id"]))
        for product_id in sorted(ids):
            print(product_id)
        return 0

    if args.json:
        print(json.dumps(reports, ensure_ascii=False, indent=2))
        return 0

    total_stale = total_empty = 0
    for report in reports:
        summary = report["summary"]
        total_stale += summary["stale_match"]
        total_empty += summary["empty_specs"]
        print(
            f"[{summary['category']}] чужая_страница={summary['stale_match']} "
            f"пустые_характеристики={summary['empty_specs']}"
        )
    print(f"ИТОГО: чужая страница {total_stale}, пустые характеристики {total_empty}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
