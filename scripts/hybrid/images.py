from __future__ import annotations

import hashlib
import re
from pathlib import Path

from .config import PUBLIC, load_image_map, save_image_map
from .http_utils import fetch_bytes


def _local_name(url: str) -> str:
    digest = hashlib.md5(url.encode("utf-8")).hexdigest()[:24]
    ext = ".jpg"
    lower = url.lower()
    if lower.endswith(".png") or ".png" in lower:
        ext = ".png"
    elif lower.endswith(".jpeg") or ".jpeg" in lower:
        ext = ".jpeg"
    elif lower.endswith(".webp") or ".webp" in lower:
        ext = ".webp"
    return digest + ext


def prefer_large_image_url(url: str) -> str:
    return re.sub(r"-(\d+)x(\d+)\.", "-1200x1200.", url)


def mirror_images(
    remote_urls: list[str],
    *,
    image_map: dict[str, str] | None = None,
) -> list[str]:
    image_map = dict(image_map or load_image_map())
    local_paths: list[str] = []
    assets_dir = PUBLIC / "assets" / "product-images"
    assets_dir.mkdir(parents=True, exist_ok=True)

    for remote in remote_urls:
        if not remote:
            continue
        large = prefer_large_image_url(remote)
        candidates: list[str] = []
        for candidate in (large, remote):
            if candidate and candidate not in candidates:
                candidates.append(candidate)

        resolved = False
        for candidate in candidates:
            if candidate not in image_map:
                continue
            rel_path = image_map[candidate]
            abs_path = PUBLIC / rel_path
            if not abs_path.exists():
                try:
                    abs_path.write_bytes(fetch_bytes(candidate, timeout=60))
                except Exception:
                    continue
            local_paths.append(rel_path)
            resolved = True
            break

        if resolved:
            continue

        last_error: Exception | None = None
        for candidate in candidates:
            rel_path = image_map.get(candidate) or f"assets/product-images/{_local_name(candidate)}"
            abs_path = PUBLIC / rel_path
            try:
                if not abs_path.exists():
                    abs_path.write_bytes(fetch_bytes(candidate, timeout=60))
                image_map[candidate] = rel_path
                if large != candidate and large in candidates:
                    image_map[large] = rel_path
                if remote != candidate:
                    image_map[remote] = rel_path
                local_paths.append(rel_path)
                resolved = True
                break
            except Exception as exc:  # noqa: BLE001
                last_error = exc
        if not resolved:
            continue

    deduped: list[str] = []
    seen: set[str] = set()
    for path in local_paths:
        if path in seen:
            continue
        seen.add(path)
        deduped.append(path)
    save_image_map(image_map)
    return deduped
