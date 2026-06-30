from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .config import CATEGORY_MANIFEST, HYBRID_ROOT, SOURCES_ROOT


def load_manifest(category: str) -> dict[str, Any]:
    path = CATEGORY_MANIFEST[category]
    if not path.exists():
        return {"generated_at": "", "count": 0, "byId": {}}
    return json.loads(path.read_text(encoding="utf-8"))


def save_manifest(category: str, manifest: dict[str, Any]) -> None:
    path = CATEGORY_MANIFEST[category]
    manifest["count"] = len(manifest.get("byId", {}))
    manifest["generated_at"] = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def upsert_manifest_entry(category: str, product_id: str, entry: dict[str, Any]) -> None:
    manifest = load_manifest(category)
    by_id = manifest.setdefault("byId", {})
    by_id[product_id] = entry
    save_manifest(category, manifest)


def remove_manifest_entry(category: str, product_id: str) -> None:
    manifest = load_manifest(category)
    by_id = manifest.get("byId", {})
    if product_id in by_id:
        del by_id[product_id]
        save_manifest(category, manifest)


def source_path(category: str, product_id: str) -> Path:
    return SOURCES_ROOT / category / f"{product_id}.json"


def load_source(category: str, product_id: str) -> dict[str, Any] | None:
    path = source_path(category, product_id)
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def save_source(source: dict[str, Any]) -> Path:
    category = source["category"]
    product_id = source["product_id"]
    path = source_path(category, product_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    source["updated_at"] = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    path.write_text(json.dumps(source, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return path


def html_path(category: str, file_slug: str) -> Path:
    return HYBRID_ROOT / category / f"{file_slug}.html"
