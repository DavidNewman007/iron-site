from __future__ import annotations

import json
from dataclasses import asdict
from pathlib import Path

from .config import HYBRID_CATEGORIES, HYBRID_ROOT, PUBLIC
from .manifest import load_manifest
from .price_parser import Product, load_products_from_sheet
from .slug import build_file_slug


def audit_category(products: list[Product], category: str) -> dict:
    manifest = load_manifest(category)
    by_id = manifest.get("byId", {})
    category_products = [p for p in products if p.category == category]

    missing_meta: list[dict] = []
    broken_file: list[dict] = []
    ok: list[dict] = []

    for product in category_products:
        meta = by_id.get(product.id)
        file_slug = build_file_slug(product.name, product.warehouse, product.price)
        html_rel = f"hybrid-products/{category}/{file_slug}.html"
        html_abs = PUBLIC / html_rel

        if not meta:
            missing_meta.append(
                {
                    "product_id": product.id,
                    "name": product.name,
                    "warehouse": product.warehouse,
                    "price": product.price,
                    "expected_url": html_rel,
                }
            )
            continue

        manifest_url = meta.get("url") or ""
        manifest_abs = PUBLIC / manifest_url if manifest_url else None
        target_abs = manifest_abs if manifest_abs and manifest_abs.exists() else html_abs

        if not target_abs.exists():
            broken_file.append(
                {
                    "product_id": product.id,
                    "name": product.name,
                    "manifest_url": manifest_url,
                    "expected_url": html_rel,
                }
            )
        else:
            ok.append({"product_id": product.id, "url": manifest_url or html_rel})

    return {
        "category": category,
        "price_rows": len(category_products),
        "manifest_rows": len(by_id),
        "ok": len(ok),
        "missing_meta": missing_meta,
        "broken_file": broken_file,
    }


def audit_all(products: list[Product] | None = None) -> dict:
    if products is None:
        products, updated_at = load_products_from_sheet()
    else:
        updated_at = ""

    report = {
        "updated_at": updated_at,
        "categories": {},
        "summary": {
            "missing_meta": 0,
            "broken_file": 0,
            "ok": 0,
        },
    }

    for category in HYBRID_CATEGORIES:
        cat_report = audit_category(products, category)
        report["categories"][category] = cat_report
        report["summary"]["missing_meta"] += len(cat_report["missing_meta"])
        report["summary"]["broken_file"] += len(cat_report["broken_file"])
        report["summary"]["ok"] += cat_report["ok"]

    return report


def missing_product_ids(report: dict, category: str | None = None) -> list[str]:
    ids: list[str] = []
    categories = [category] if category else HYBRID_CATEGORIES
    for cat in categories:
        cat_report = report["categories"].get(cat, {})
        for item in cat_report.get("missing_meta", []):
            ids.append(item["product_id"])
        for item in cat_report.get("broken_file", []):
            ids.append(item["product_id"])
    return ids


def save_audit_report(report: dict, path: Path | None = None) -> Path:
    out = path or (HYBRID_ROOT / "audit-report.json")
    out.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return out
