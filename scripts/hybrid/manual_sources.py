"""Ручной источник карточки: фото и характеристики, найденные человеком.

Зачем (28.09.2026). Конвейер берёт фото у одного поставщика — sochi.dr-store.ru.
У части позиций там страницы нет вовсе (чехлы PITAKA, новые Redmi/POCO, Galaxy
Watch 9, часть Dyson и Яндекс Станций) или она есть, но сопоставление её не
находит (iPhone 15 Pro Max лежит у поставщика в корне сайта, без раздела).
Такие позиции годами висели плиткой без фото и без кнопки «📸 Фото» в боте.
Владелец: «возьми фотки с основного сайта, где мы берём для других карточек,
а если там нет — найди на других сайтах».

Файл `manual_sources.json` рядом с этим модулем — ручная разметка. Ключ записи —
имя позиции без цены и склад: `bot_index_key` без страны, то есть
«нормализованное имя~s2». Цена в ключ не входит намеренно: она меняется по
нескольку раз в день, и ключ с ценой протухал бы к обеду (та же причина, что у
индекса бота). Вместо склада можно поставить `*` — запись подойдёт любому складу.

Запись бывает двух видов:

* `catalog_url` — страница dr-store, которую автоматическое сопоставление не
  нашло. Её разбирает обычный скрейпер, с обычным отбором картинок.
* `images` (+ `specs`, `title`) — фото и характеристики с другого сайта:
  официального сайта производителя, а если там нет — крупного магазина.
  `source_url` — страница, откуда они взяты: по нему видно происхождение фото.

Ручная запись ВАЖНЕЕ автоматического сопоставления: её завёл человек, проверив,
что фото именно этой модели и этого цвета. Автомат иногда уверенно ошибается —
так «Dyson PencilVac» получал фото Apple Pencil.

Карточка из ручного источника помечается в `_sources` полем `manual: true`, и
ремонт карточек (`source_repair.py`) и проверки устаревших адресов
(`audit_sources.py`) её не трогают: переразбор внешней страницы правилами
dr-store испортил бы галерею.
"""
from __future__ import annotations

import hashlib
import json
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any

from .bot_index import normalize_key_part, warehouse_tag
from .config import PUBLIC, load_image_map, save_image_map
from .http_utils import fetch_bytes
from .image_compress import compress_image
from .images import mirror_images
from .scraper import clean_catalog_title, scrape_catalog_product
from .slug import build_file_slug

MANUAL_SOURCES_PATH = Path(__file__).with_name("manual_sources.json")
ASSETS_REL = "assets/product-images"


def _sniff_ext(data: bytes) -> str:
    if data[:3] == b"\xff\xd8\xff":
        return ".jpg"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return ".png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return ".webp"
    raise RuntimeError("не картинка (JPEG/PNG/WEBP)")


def mirror_manual_images(urls: list[str]) -> list[str]:
    """Скачать фото со стороннего сайта в assets/product-images.

    Отличие от mirror_images: расширение берётся по содержимому, а не по адресу.
    CDN магазинов (Shopify у PITAKA) по адресу «….webp» отдаёт PNG, если клиент
    не просит webp, — файл «.webp» с PNG внутри браузер ещё переварит, а
    Telegram при отправке альбома по ссылке может и нет. Не-JPEG на Mac
    пережимается в JPEG через sips (фото с Shopify весят 0,7 МБ в PNG и 0,2 МБ
    в JPEG); где sips нет (GitHub Actions), файл сохраняется как есть. Уже
    скачанное берётся из product-image-map.json, повторно не качается.
    """
    image_map = load_image_map()
    assets_dir = PUBLIC / ASSETS_REL
    assets_dir.mkdir(parents=True, exist_ok=True)
    result: list[str] = []
    for url in urls:
        rel = image_map.get(url)
        if rel and (PUBLIC / rel).exists():
            result.append(rel)
            continue
        # Файла нет или записи нет — качаем заново. Каждый снимок пережимается
        # в своём временном каталоге (TemporaryDirectory), общего файла нет.
        try:
            data = fetch_bytes(url, timeout=60)
            ext = _sniff_ext(data)
        except Exception:  # noqa: BLE001
            continue
        stem = hashlib.md5(url.encode("utf-8")).hexdigest()[:24]
        if ext != ".jpg" and shutil.which("sips"):
            with tempfile.TemporaryDirectory() as tmp:
                src = Path(tmp) / f"src{ext}"
                src.write_bytes(data)
                dst = assets_dir / f"{stem}.jpg"
                done = subprocess.run(
                    ["sips", "-s", "format", "jpeg", "-s", "formatOptions", "85", "-Z", "1400",
                     str(src), "--out", str(dst)],
                    capture_output=True,
                )
                if done.returncode == 0 and dst.exists():
                    rel = f"{ASSETS_REL}/{dst.name}"
                else:
                    rel = ""
        else:
            rel = ""
        if not rel:
            # Без sips (GitHub Actions) ужимает Pillow: PNG без прозрачности
            # становится JPEG (10.10.2026, план 105, ST-С5).
            data, new_ext = compress_image(data)
            dst = assets_dir / f"{stem}{new_ext or ext}"
            dst.write_bytes(data)
            rel = f"{ASSETS_REL}/{dst.name}"
        image_map[url] = rel
        result.append(rel)
    save_image_map(image_map)
    result = list(dict.fromkeys(result))
    assert_distinct_files(result)
    return result


def assert_distinct_files(rel_paths: list[str]) -> None:
    """Разные снимки галереи не должны оказаться одним и тем же файлом.

    28.09.2026 обложки 11 карточек PITAKA оказались побайтно одинаковыми
    (копия фото ремешка Galaxy Watch) при разных именах файлов: их перезаписала
    сторонняя команда ffmpeg, у которой имена файлов без «-i» стали выходами.
    Сверка md5 ловит это при любой пересборке, а не глазами владельца.
    """
    seen: dict[str, str] = {}
    for rel in rel_paths:
        path = PUBLIC / rel
        if not path.exists():
            continue
        digest = hashlib.md5(path.read_bytes()).hexdigest()
        if digest in seen:
            raise RuntimeError(
                f"одинаковое содержимое у {seen[digest]} и {rel} — файл перезаписан? "
                "удалите оба и соберите карточку заново"
            )
        seen[digest] = rel


def check_manual_cards() -> list[str]:
    """Проверка всех карточек из ручного источника: файлы на месте и не дублируют
    друг друга (кроме честно общих путей). python3 -m hybrid.manual_sources"""
    from .config import SOURCES_ROOT

    problems: list[str] = []
    owner: dict[str, str] = {}
    for path in sorted(SOURCES_ROOT.glob("*/*.json")):
        source = json.loads(path.read_text(encoding="utf-8"))
        if not source.get("manual"):
            continue
        for rel in source.get("images_local") or []:
            file = PUBLIC / rel
            if not file.exists():
                problems.append(f"нет файла {rel} ({source.get('name')})")
                continue
            digest = hashlib.md5(file.read_bytes()).hexdigest()
            previous = owner.setdefault(digest, rel)
            if previous != rel:
                problems.append(f"{rel} совпадает по содержимому с {previous} ({source.get('name')})")
    return problems


if __name__ == "__main__":
    found = check_manual_cards()
    print("\n".join(found) if found else "ручные карточки: файлы на месте, дублей нет")
    raise SystemExit(1 if found else 0)


def manual_key(name: Any, warehouse: Any) -> str:
    return f"{normalize_key_part(name)}~{warehouse_tag(warehouse)}"


def load_manual_sources() -> dict[str, dict[str, Any]]:
    if not MANUAL_SOURCES_PATH.exists():
        return {}
    data = json.loads(MANUAL_SOURCES_PATH.read_text(encoding="utf-8"))
    return {k: v for k, v in (data.get("items") or {}).items() if isinstance(v, dict)}


def find_manual_entry(name: Any, warehouse: Any) -> tuple[str, dict[str, Any]] | None:
    items = load_manual_sources()
    for key in (manual_key(name, warehouse), f"{normalize_key_part(name)}~*"):
        entry = items.get(key)
        if entry and (entry.get("images") or entry.get("catalog_url")):
            return key, entry
    return None


def _specs_list(specs: Any) -> list[dict[str, str]]:
    if isinstance(specs, dict):
        return [{"key": str(k), "value": str(v)} for k, v in specs.items()]
    result = []
    for item in specs or []:
        if isinstance(item, dict) and item.get("key"):
            result.append({"key": str(item["key"]), "value": str(item.get("value") or "")})
        elif isinstance(item, (list, tuple)) and len(item) == 2:
            result.append({"key": str(item[0]), "value": str(item[1])})
    return result


def build_source_from_manual(product: Any, key: str, entry: dict[str, Any]) -> dict[str, Any]:
    """Источник карточки из ручной записи. `product` — Product из прайса."""
    if entry.get("images"):
        images_remote = [str(u) for u in entry["images"] if u]
        specs = _specs_list(entry.get("specs"))
        title = str(entry.get("title") or product.name)
        page_url = str(entry.get("source_url") or "")
    else:
        catalog = scrape_catalog_product(
            str(entry["catalog_url"]), category=product.category, product_name=product.name
        )
        images_remote = list(catalog.images_remote)
        specs = [{"key": k, "value": v} for k, v in catalog.specs]
        title = catalog.title
        page_url = str(entry["catalog_url"])
    images_local = mirror_manual_images(images_remote) if entry.get("images") else mirror_images(images_remote)
    if not images_local:
        raise RuntimeError(f"manual source {key}: ни одно фото не скачалось")
    return {
        "product_id": product.id,
        "category": product.category,
        "file_slug": build_file_slug(product.name, product.warehouse, product.price),
        "name": product.name,
        "country": product.country or "",
        "warehouse": product.warehouse or "",
        "price": product.price,
        "catalog_url": page_url,
        "catalog_title": clean_catalog_title(title),
        "specs": specs,
        "images_remote": images_remote,
        "images_local": images_local,
        "manual": True,
        "manual_key": key,
        "photo_source": str(entry.get("source_url") or page_url),
    }
