"""Audit hybrid card images and find cards needing repair."""
from __future__ import annotations

import json
import re
from collections import defaultdict
from pathlib import Path

from .config import HYBRID_CATEGORIES, ROOT, load_image_map
from .image_selection import dr_store_index, is_watch_strap_only_image

IMAGE_ISSUE_KEYS = (
    "no_cover",
    "missing_html",
    "empty_gallery",
    "thin_gallery",
    "lineup_cover",
    "strap_cover",
    "shared_cover_across_colors",
    "cover_main_mismatch",
    "missing_cover_file",
    "missing_gallery_file",
)

# Minimum in-card gallery size; below this we re-scrape dr-store.
MIN_GALLERY_IMAGES: dict[str, int] = {
    "iphone": 3,
    "samsung": 3,
    "macbook": 2,
    "ipad": 2,
    "watch": 2,
    "airpods": 2,
    "accessories": 1,
}


def model_key(name: str) -> str:
    value = re.sub(r"\s*\([^)]*\)\s*", "", name or "")
    value = re.sub(
        r"\b(black|white|pink|blue|green|yellow|purple|natural|titanium|gold|silver|"
        r"ultramarine|teal|starlight|midnight|desert|graphite|sierra|lavender|orange|"
        r"red|gray|grey|violet|silvershadow|mist\s*blue|sage|cosmic|space\s*black|"
        r"jet\s*black|rose\s*gold|light\s*blush|pur\s*fog)\b",
        "",
        value,
        flags=re.I,
    )
    return re.sub(r"\s+", " ", value).strip().lower()


def color_key(name: str) -> str:
    match = re.search(
        r"\b(black|white|pink|blue|green|yellow|purple|natural|titanium|gold|silver|"
        r"ultramarine|teal|starlight|midnight|desert|graphite|violet|silvershadow|"
        r"mist\s*blue|sage|lavender|orange|red|gray|grey|cosmic|space\s*black|"
        r"jet\s*black|rose\s*gold)\b",
        name or "",
        re.I,
    )
    return match.group(1).lower().replace(" ", "-") if match else "unknown"


def audit_category(category: str) -> dict:
    manifest_path = ROOT / "public" / "hybrid-products" / f"{category}-cards.json"
    if not manifest_path.exists():
        return {"category": category, "error": "manifest missing"}

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    image_map = load_image_map()
    local_to_remote = {v: k for k, v in image_map.items()}

    min_gallery = MIN_GALLERY_IMAGES.get(category, 2)

    issues: dict = {
        "no_cover": [],
        "missing_html": [],
        "empty_gallery": [],
        "thin_gallery": [],
        "lineup_cover": [],
        "strap_cover": [],
        "shared_cover_across_colors": [],
        "cover_main_mismatch": [],
        "missing_cover_file": [],
        "missing_gallery_file": [],
    }

    model_covers: dict[str, dict[str, list[str]]] = defaultdict(lambda: defaultdict(list))

    for product_id, meta in (manifest.get("byId") or {}).items():
        name = meta.get("name") or product_id
        cover = str(meta.get("cover") or "").strip()
        rel_url = str(meta.get("url") or "").strip()

        if not cover:
            issues["no_cover"].append(product_id)
            continue

        html_path = ROOT / "public" / rel_url
        if not html_path.exists():
            issues["missing_html"].append(product_id)
            continue

        html = html_path.read_text(encoding="utf-8", errors="replace")
        images_match = re.search(r"const IMAGES = (\[.*?\]);", html, re.S)
        if not images_match:
            issues["empty_gallery"].append(product_id)
            continue
        images = json.loads(images_match.group(1))
        if not images:
            issues["empty_gallery"].append(product_id)
            continue

        if len(images) < min_gallery:
            issues["thin_gallery"].append(
                {"product_id": product_id, "name": name, "count": len(images)}
            )

        cover_path = ROOT / "public" / cover if cover else None
        if cover and (cover_path is None or not cover_path.exists()):
            issues.setdefault("missing_cover_file", []).append(
                {"product_id": product_id, "name": name, "cover": cover}
            )

        missing_gallery: list[str] = []
        for img_ref in images:
            if not img_ref or not str(img_ref).strip():
                continue
            rel = str(img_ref).replace("../../", "")
            if not (ROOT / "public" / rel).exists():
                missing_gallery.append(rel)
        if missing_gallery:
            issues["missing_gallery_file"].append(
                {
                    "product_id": product_id,
                    "name": name,
                    "missing": missing_gallery[:5],
                    "count": len(missing_gallery),
                }
            )

        main_match = re.search(r'id="mainImg" src="\.\./\.\./([^"]+)"', html)
        if main_match and main_match.group(1) != cover:
            issues["cover_main_mismatch"].append(product_id)

        remote = local_to_remote.get(cover, "")
        idx = dr_store_index(remote)
        if idx == 1 and category == "iphone":
            issues["lineup_cover"].append({"product_id": product_id, "name": name, "cover": cover})

        if category == "watch" and remote and is_watch_strap_only_image(remote):
            issues["strap_cover"].append({"product_id": product_id, "name": name, "cover": cover})

        mk = model_key(name)
        ck = color_key(name)
        model_covers[mk][cover].append(f"{ck}:{product_id}")

    for mk, cover_map in model_covers.items():
        for cover, entries in cover_map.items():
            colors = {entry.split(":", 1)[0] for entry in entries}
            if len(colors) > 1:
                product_ids = [entry.split(":", 1)[1] for entry in entries]
                issues["shared_cover_across_colors"].append(
                    {
                        "model": mk,
                        "cover": cover,
                        "colors": sorted(colors),
                        "count": len(entries),
                        "product_ids": product_ids,
                    }
                )

    summary = {
        "category": category,
        "total": len(manifest.get("byId") or {}),
        "no_cover": len(issues["no_cover"]),
        "missing_html": len(issues["missing_html"]),
        "empty_gallery": len(issues["empty_gallery"]),
        "thin_gallery": len(issues["thin_gallery"]),
        "lineup_cover": len(issues["lineup_cover"]),
        "strap_cover": len(issues["strap_cover"]),
        "shared_cover_across_colors": len(issues["shared_cover_across_colors"]),
        "cover_main_mismatch": len(issues["cover_main_mismatch"]),
        "missing_cover_file": len(issues.get("missing_cover_file", [])),
        "missing_gallery_file": len(issues.get("missing_gallery_file", [])),
    }
    return {"summary": summary, "issues": issues}


def find_cards_needing_repair(category: str) -> list[str]:
    """Return product IDs flagged by image audit for incremental repair."""
    report = audit_category(category)
    if report.get("error"):
        return []

    issues = report["issues"]
    ids: set[str] = set()

    for key in ("no_cover", "missing_html", "empty_gallery", "cover_main_mismatch"):
        ids.update(issues.get(key, []))

    for item in issues.get("thin_gallery", []):
        if isinstance(item, dict):
            pid = item.get("product_id")
            if pid:
                ids.add(str(pid))

    for item in issues.get("missing_cover_file", []):
        if isinstance(item, dict):
            pid = item.get("product_id")
            if pid:
                ids.add(str(pid))

    for item in issues.get("lineup_cover", []):
        if isinstance(item, dict):
            pid = item.get("product_id")
            if pid:
                ids.add(str(pid))
        elif item:
            ids.add(str(item))

    for item in issues.get("strap_cover", []):
        if isinstance(item, dict):
            pid = item.get("product_id")
            if pid:
                ids.add(str(pid))

    for item in issues.get("missing_gallery_file", []):
        if isinstance(item, dict):
            pid = item.get("product_id")
            if pid:
                ids.add(str(pid))

    for item in issues.get("shared_cover_across_colors", []):
        ids.update(item.get("product_ids", []))

    return sorted(ids)


def audit_all_categories(categories: list[str] | None = None) -> list[dict]:
    cats = categories or HYBRID_CATEGORIES
    return [audit_category(category) for category in cats]
