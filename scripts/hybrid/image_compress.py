"""Ужатие картинок товаров перед публикацией (10.10.2026, план 105, ST-С5).

Зачем. Публикуемая папка public/ к 10.10.2026 весила 878 МБ при пределе GitHub
Pages в 1 ГБ и росла на ~15 МБ в сутки. Две трети — фотографии товаров: их
качали у поставщика как есть, и 707 из 817 PNG оказались обычными фотографиями
без прозрачности, по 400 КБ штука. В JPEG та же фотография весит в девять раз
меньше. JPEG поставщика сохранены почти без сжатия — пережатие с качеством 85
снимает ещё около трети.

Что делает compress_image:
  • PNG без прозрачности → JPEG (расширение меняется на .jpg);
  • PNG с прозрачностью → остаётся PNG, пересохраняется без потерь;
  • JPEG → пережимается, только если выходит заметно меньше (MIN_SAVING): так
    повторный прогон по уже ужатым файлам их не трогает и не портит качество;
  • длинная сторона — не больше MAX_SIDE (как у sips -Z 1400 в manual_sources.py).
Без Pillow (на машине без зависимости) возвращает байты как есть: сборка
карточек не должна падать из-за ужатия.
"""
from __future__ import annotations

import io

try:
    from PIL import Image, ImageOps
except ImportError:  # pragma: no cover - на машине без Pillow
    Image = None
    ImageOps = None

JPEG_QUALITY = 85
MAX_SIDE = 1400
MIN_SAVING = 0.15


def _has_alpha(im) -> bool:
    if im.mode in ("RGBA", "LA", "PA") or (im.mode == "P" and "transparency" in im.info):
        return im.convert("RGBA").getchannel("A").getextrema()[0] < 255
    return False


def _fit(im):
    if max(im.size) > MAX_SIDE:
        im = im.copy()
        im.thumbnail((MAX_SIDE, MAX_SIDE), Image.LANCZOS)
    return im


def _jpeg(im, icc) -> bytes:
    # Цветовой профиль описывает ИСХОДНЫЙ режим картинки: после перевода из
    # CMYK, палитры или серого в RGB он уже неверен, и его не прикладываем.
    if im.mode not in ("RGB", "L"):
        im, icc = im.convert("RGB"), None
    out = io.BytesIO()
    im.save(out, "JPEG", quality=JPEG_QUALITY, optimize=True, progressive=True,
            **({"icc_profile": icc} if icc else {}))
    return out.getvalue()


def compress_image(data: bytes) -> tuple[bytes, str | None]:
    """(байты для записи, новое расширение). Расширение None — оставить прежнее.

    Сменить его может только PNG без прозрачности: он становится JPEG, ".jpg"."""
    if Image is None or not data:
        return data, None
    try:
        im = Image.open(io.BytesIO(data))
        fmt = im.format
        if getattr(im, "is_animated", False) or fmt not in ("PNG", "JPEG"):
            return data, None
        icc = im.info.get("icc_profile")
        im = ImageOps.exif_transpose(im)
        if fmt == "PNG":
            if _has_alpha(im):
                out = io.BytesIO()
                _fit(im).save(out, "PNG", optimize=True)
                packed = out.getvalue()
                return (packed if len(packed) < len(data) else data), None
            return _jpeg(_fit(im), icc), ".jpg"
        packed = _jpeg(_fit(im), icc)
        if len(packed) <= len(data) * (1 - MIN_SAVING):
            return packed, None
        return data, None
    except Exception:  # noqa: BLE001 - битая картинка: пусть лежит как скачалась
        return data, None
