#!/usr/bin/env python3
"""Ужать уже скачанные фото товаров и переписать ссылки на переименованные.

Заведено 10.10.2026 (план 105, ST-С5): public/ весил 878 МБ при пределе GitHub
Pages в 1 ГБ, из них 590 МБ — фото товаров в assets/product-images. Новые фото
ужимаются при скачивании (scripts/hybrid/image_compress.py), этот скрипт —
для того, что уже лежит.

Что делает:
  1. каждую картинку прогоняет через compress_image: PNG без прозрачности →
     .jpg, JPEG пережимается, если выходит на 15% меньше и больше;
  2. для переименованных (x.png → x.jpg) переписывает ссылки во всех текстовых
     файлах public/ (карточки ru/en, _sources, манифесты, bot-index.json) и в
     product-image-map.json;
  3. старый .png удаляет только после того, как .jpg записан.

Повторный прогон безопасен: уже ужатые JPEG не дают 15% выигрыша и не
трогаются, а PNG без прозрачности к тому времени уже нет.

Запуск: python3 scripts/compress_product_images.py [--dry-run]
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from hybrid.config import IMAGE_MAP_PATH, PUBLIC  # noqa: E402
from hybrid.image_compress import compress_image  # noqa: E402

IMAGES_DIR = PUBLIC / "assets" / "product-images"
TEXT_SUFFIXES = {".html", ".json", ".js", ".xml", ".txt"}
REF_RE = re.compile(r"(product-images/)([0-9a-f]{24})\.png")


def main() -> int:
    dry = "--dry-run" in sys.argv
    before = after = 0
    renamed: set[str] = set()
    touched = skipped_conflict = 0
    for path in sorted(IMAGES_DIR.iterdir()):
        if not path.is_file() or path.suffix.lower() not in (".png", ".jpg", ".jpeg"):
            continue
        data = path.read_bytes()
        packed, ext = compress_image(data)
        before += len(data)
        if ext and ext != path.suffix.lower():
            target = path.with_suffix(ext)
            if target.exists() or not re.fullmatch(r"[0-9a-f]{24}", path.stem):
                skipped_conflict += 1
                after += len(data)
                continue
            if not dry:
                target.write_bytes(packed)
                path.unlink()
            renamed.add(path.stem)
            after += len(packed)
            touched += 1
        elif len(packed) < len(data):
            if not dry:
                path.write_bytes(packed)
            after += len(packed)
            touched += 1
        else:
            after += len(data)

    files_fixed = refs_fixed = 0

    def fix(match: re.Match) -> str:
        nonlocal refs_fixed
        if match.group(2) in renamed:
            refs_fixed += 1
            return f"{match.group(1)}{match.group(2)}.jpg"
        return match.group(0)

    if renamed:
        targets = [IMAGE_MAP_PATH] + [
            p for p in PUBLIC.rglob("*")
            if p.is_file() and p.suffix.lower() in TEXT_SUFFIXES and IMAGES_DIR not in p.parents
        ]
        for p in targets:
            try:
                text = p.read_text(encoding="utf-8")
            except UnicodeDecodeError:
                continue
            if "product-images/" not in text:
                continue
            new = REF_RE.sub(fix, text)
            if new != text:
                files_fixed += 1
                if not dry:
                    p.write_text(new, encoding="utf-8")

    mb = 1024 * 1024
    print(f"картинок ужато: {touched}, переименовано в .jpg: {len(renamed)}, "
          f"пропущено (уже есть .jpg с тем же именем): {skipped_conflict}")
    print(f"вес: {before / mb:.1f} МБ → {after / mb:.1f} МБ (−{(before - after) / mb:.1f} МБ)")
    print(f"ссылок переписано: {refs_fixed} в {files_fixed} файлах" + (" (пробный прогон)" if dry else ""))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
