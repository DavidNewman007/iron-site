#!/usr/bin/env python3
"""Orchestrator for hybrid card refresh pipeline."""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from hybrid.audit import audit_all, missing_product_ids, save_audit_report  # noqa: E402
from hybrid.config import HYBRID_CATEGORIES  # noqa: E402
from hybrid.price_parser import load_products_from_sheet  # noqa: E402


def run(cmd: list[str], *, cwd: Path | None = None) -> None:
    print("$", " ".join(cmd))
    subprocess.run(cmd, cwd=cwd or ROOT, check=True)


def git_publish(message: str, *, push: bool) -> dict:
    name = os.environ.get("GIT_AUTHOR_NAME", "github-actions[bot]")
    email = os.environ.get(
        "GIT_AUTHOR_EMAIL",
        "41898282+github-actions[bot]@users.noreply.github.com",
    )
    subprocess.run(["git", "config", "user.name", name], cwd=ROOT, check=True)
    subprocess.run(["git", "config", "user.email", email], cwd=ROOT, check=True)
    run(["git", "add", "public/hybrid-products", "product-image-map.json"])
    status = subprocess.run(
        ["git", "status", "--porcelain"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=True,
    )
    if not status.stdout.strip():
        return {"committed": False, "pushed": False, "message": "No changes to commit"}
    run(["git", "commit", "-m", message])
    pushed = False
    if push:
        branch = subprocess.run(
            ["git", "rev-parse", "--abbrev-ref", "HEAD"],
            cwd=ROOT,
            capture_output=True,
            text=True,
            check=True,
        ).stdout.strip()
        run(["git", "push", "-u", "origin", branch])
        pushed = True
    return {"committed": True, "pushed": pushed}


def main() -> int:
    parser = argparse.ArgumentParser(description="Refresh hybrid cards: sync → match → audit → build → patch → publish.")
    parser.add_argument(
        "--categories",
        default=",".join(HYBRID_CATEGORIES),
        help=f"Comma-separated categories (default: all). Options: {','.join(HYBRID_CATEGORIES)}",
    )
    parser.add_argument("--all", action="store_true", help="Same as default all categories")
    parser.add_argument("--full-category", action="store_true", help="Rebuild entire category instead of missing-only")
    parser.add_argument("--skip-sync", action="store_true")
    parser.add_argument("--skip-match", action="store_true")
    parser.add_argument("--skip-build", action="store_true")
    parser.add_argument("--skip-patch", action="store_true")
    parser.add_argument("--refresh-sitemap", action="store_true")
    parser.add_argument("--push", action="store_true", help="Commit and push site changes")
    parser.add_argument("--dry-run", action="store_true", help="Audit only, do not build or publish")
    args = parser.parse_args()

    categories = [c.strip() for c in args.categories.split(",") if c.strip()]
    for cat in categories:
        if cat not in HYBRID_CATEGORIES:
            raise SystemExit(f"Unknown category: {cat}")

    report: dict = {
        "started_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "categories": categories,
        "steps": {},
    }

    if not args.skip_sync:
        run([sys.executable, "scripts/sync_public_sheets.py"])
        report["steps"]["sync"] = "ok"

    products, updated_at = load_products_from_sheet()
    report["price_updated_at"] = updated_at

    if not args.skip_match:
        for category in categories:
            cmd = [sys.executable, "scripts/catalog_match_probe.py", "--category", category]
            if not args.full_category:
                audit_pre = audit_all(products)
                missing = missing_product_ids(audit_pre, category)
                if not missing:
                    report.setdefault("match_skipped", []).append(category)
                    continue
                for product_id in missing:
                    cmd.extend(["--product-id", product_id])
            if args.refresh_sitemap:
                cmd.append("--refresh-sitemap")
            run(cmd)
        report["steps"]["match"] = "ok"

    audit_report = audit_all(products)
    save_audit_report(audit_report)
    report["audit"] = audit_report["summary"]

    if args.dry_run:
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return 0

    if not args.skip_build:
        build_failures: list[dict] = []
        for category in categories:
            cmd = [sys.executable, "scripts/build_hybrid_card.py", "--category", category]
            if args.full_category:
                cmd.append("--all-in-category")
                if not args.skip_match:
                    cmd.append("--refresh-match")
            else:
                cmd.append("--missing-only")
            result = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True)
            print(result.stdout, end="")
            if result.stderr:
                print(result.stderr, file=sys.stderr, end="")
            if result.returncode != 0 and result.stdout.strip():
                try:
                    payload = json.loads(result.stdout)
                    build_failures.extend(payload.get("failed", []))
                except json.JSONDecodeError:
                    result.check_returncode()
            elif result.returncode != 0:
                result.check_returncode()
        report["steps"]["build"] = "ok"
        if build_failures:
            report["build_failures"] = build_failures
            report["build_failed_count"] = len(build_failures)

        audit_report = audit_all(load_products_from_sheet()[0])
        save_audit_report(audit_report)
        report["audit_after_build"] = audit_report["summary"]

    if not args.skip_patch:
        run(["node", "scripts/patch_hybrid_covers.js"])
        report["steps"]["patch"] = "ok"

    if args.push:
        stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        missing = report.get("audit_after_build", report["audit"]).get("missing_meta", 0)
        msg = f"Обновить hybrid-карточки ({stamp}). Осталось без meta: {missing}."
        report["publish"] = git_publish(msg, push=True)
    else:
        report["publish"] = {"committed": False, "pushed": False}

    report["finished_at"] = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
