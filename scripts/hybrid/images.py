from __future__ import annotations

import hashlib
import re
from pathlib import Path

from .config import PUBLIC, load_image_map, save_image_map
from .http_utils import fetch_bytes
from .image_compress import compress_image


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


def _on_disk(rel_path: str) -> str | None:
    """Путь, под которым картинка уже лежит: сам rel_path или его ужатый двойник .jpg.

    PNG без прозрачности при скачивании становится JPEG (image_compress.py), а
    старые записи product-image-map.json могут ещё указывать на .png — без этой
    проверки такая картинка качалась бы заново при каждой сборке.
    """
    if (PUBLIC / rel_path).exists():
        return rel_path
    twin = rel_path.rsplit(".", 1)[0] + ".jpg"
    if twin != rel_path and (PUBLIC / twin).exists():
        return twin
    return None


def _download(candidate: str, rel_path: str) -> str:
    """Качает картинку, ужимает и кладёт. Возвращает путь, под которым она легла."""
    data, ext = compress_image(fetch_bytes(candidate, timeout=60))
    if ext and not rel_path.endswith(ext):
        rel_path = rel_path.rsplit(".", 1)[0] + ext
    (PUBLIC / rel_path).write_bytes(data)
    return rel_path


def prefer_large_image_url(url: str) -> str:
    return re.sub(r"-(\d+)x(\d+)\.", "-1200x1200.", url)


def fallback_image_urls(url: str) -> list[str]:
    """Запасные адреса той же картинки у dr-store (28.09.2026).

    Кэш OpenCart хранит не все размеры: у новых товаров (Redmi Note 17, POCO X8
    Pro) есть «-1000x1000» и «-500x500», а «-1200x1200», который просит галерея,
    отдаёт 404. Скрейпер при этом галерею находил, а mirror_images не скачивал
    ни одного файла — карточки выходили с характеристиками, но без фото. Сначала
    пробуем 1000x1000, потом оригинал без кэша (/image/catalog/…, без размера).
    """
    match = re.search(r"-(\d+)x(\d+)(\.[a-z0-9]+)$", url, re.I)
    if not match:
        return []
    result = [url[: match.start()] + "-1000x1000" + match.group(3)]
    original = url[: match.start()] + match.group(3)
    if "/image/cache/catalog/" in original:
        result.append(original.replace("/image/cache/catalog/", "/image/catalog/", 1))
    return result


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
        for candidate in (large, remote, *fallback_image_urls(remote)):
            if candidate and candidate not in candidates:
                candidates.append(candidate)

        resolved = False
        for candidate in candidates:
            if candidate not in image_map:
                continue
            rel_path = _on_disk(image_map[candidate])
            if not rel_path:
                try:
                    rel_path = _download(candidate, image_map[candidate])
                except Exception:
                    continue
            image_map[candidate] = rel_path
            local_paths.append(rel_path)
            resolved = True
            break

        if resolved:
            continue

        last_error: Exception | None = None
        for candidate in candidates:
            rel_path = image_map.get(candidate) or f"assets/product-images/{_local_name(candidate)}"
            try:
                rel_path = _on_disk(rel_path) or _download(candidate, rel_path)
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
