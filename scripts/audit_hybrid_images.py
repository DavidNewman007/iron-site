#!/usr/bin/env python3
"""Audit hybrid card images across categories."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from hybrid.audit_images import audit_all_categories, find_cards_needing_repair  # noqa: E402
from hybrid.config import HYBRID_CATEGORIES  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description="Audit hybrid card images.")
    parser.add_argument("--category", choices=HYBRID_CATEGORIES)
    parser.add_argument("--json", action="store_true")
    parser.add_argument(
        "--repair-ids",
        action="store_true",
        help="Print product IDs that need image repair (one per line)",
    )
    args = parser.parse_args()

    categories = [args.category] if args.category else HYBRID_CATEGORIES

    if args.repair_ids:
        ids: list[str] = []
        for category in categories:
            ids.extend(find_cards_needing_repair(category))
        for pid in sorted(set(ids)):
            print(pid)
        return 0

    reports = audit_all_categories(categories)

    if args.json:
        print(json.dumps(reports, ensure_ascii=False, indent=2))
        return 0

    for report in reports:
        if report.get("error"):
            print(f"[{report['category']}] ERROR: {report['error']}")
            continue
        summary = report["summary"]
        print(
            f"[{summary['category']}] total={summary['total']} "
            f"thin_gallery={summary['thin_gallery']} "
            f"lineup_cover={summary['lineup_cover']} "
            f"shared_colors={summary['shared_cover_across_colors']} "
            f"no_cover={summary['no_cover']} empty_gallery={summary['empty_gallery']}"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
