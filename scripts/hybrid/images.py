from __future__ import annotations

import hashlib
import re
import urllib.request
from pathlib import Path

from .config import PUBLIC, load_image_map, save_image_map


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
        for candidate in (large, remote):
            if candidate in image_map:
                local_paths.append(image_map[candidate])
                break
        else:
            filename = _local_name(candidate)
            rel_path = f"assets/product-images/{filename}"
            abs_path = PUBLIC / rel_path
            if not abs_path.exists():
                req = urllib.request.Request(
                    candidate,
                    headers={"User-Agent": "iron-hybrid-pipeline/1.0"},
                )
                with urllib.request.urlopen(req, timeout=60) as resp:
                    abs_path.write_bytes(resp.read())
            image_map[candidate] = rel_path
            if large != candidate:
                image_map[large] = rel_path
            if remote != candidate:
                image_map[remote] = rel_path
            local_paths.append(rel_path)

    deduped: list[str] = []
    seen: set[str] = set()
    for path in local_paths:
        if path in seen:
            continue
        seen.add(path)
        deduped.append(path)
    save_image_map(image_map)
    return deduped
