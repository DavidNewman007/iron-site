from __future__ import annotations

import html
import json
import re
from typing import Any

from .config import HYBRID_CARD_ASSETS_VERSION, HYBRID_CART_VERSION
from . import i18n_en
from .scraper import clean_catalog_title
from .images import mirror_images
from .manifest import html_path, save_source, upsert_manifest_entry
from .slug import build_file_slug


SITE_ORIGIN = "https://1iron.ru"
MAX_GALLERY_IMAGES = 8

# Код галереи (листание, миниатюры, лайтбокс, свайпы) и стиль карточки живут в
# public/js/hybrid-gallery.js и public/css/hybrid-card.css. До 10.10.2026 они
# вставлялись в КАЖДУЮ карточку целиком: 7,3 КБ одинакового текста на 13 796
# страницах — 91 МБ из предела GitHub Pages в 1 ГБ (план 105, ST-С5). В карточке
# остаётся только `const IMAGES = [...];` — её читают аудит галерей и
# source_repair.py, формат этой строки не менять.


def _esc(value: str) -> str:
    return html.escape(str(value or ""), quote=True)


def _gallery_block(images_rel: list[str], alt_text: str, base: str = "../..") -> tuple[str, str]:
    if not images_rel:
        return ("<p>Изображения не найдены</p>" if base == "../.." else "<p>No images available</p>", "")
    gallery = images_rel[:MAX_GALLERY_IMAGES]
    main = f"{base}/{gallery[0]}"
    main_img = (
        f'<img id="mainImg" src="{_esc(main)}" alt="{_esc(alt_text)}" '
        f'loading="eager" decoding="async" fetchpriority="high">'
    )
    thumbs = []
    for idx, rel in enumerate(gallery):
        src = f"{base}/{rel}"
        active = " is-active" if idx == 0 else ""
        thumbs.append(
            f'<button type="button" class="thumb{active}" data-idx="{idx}">'
            f'<img src="{_esc(src)}" alt="" loading="lazy" decoding="async"></button>'
        )
    return main_img, "".join(thumbs)


def _og_block(source: dict[str, Any], images_rel: list[str], lang: str = "ru") -> str:
    if not images_rel:
        return ""
    name = source["name"]
    file_slug = source.get("file_slug") or build_file_slug(
        source["name"], source.get("warehouse") or "", source["price"]
    )
    category = source["category"]
    cover_rel = images_rel[0]
    prefix = "/en" if lang == "en" else ""
    page_url = f"{SITE_ORIGIN}{prefix}/hybrid-products/{category}/{file_slug}.html"
    cover_url = f"{SITE_ORIGIN}/{cover_rel}"
    описание = (
        f"{name} — current price at IRON SERVICE" if lang == "en"
        else f"{name} — актуальная цена в IRON SERVICE"
    )
    return f"""  <meta property="og:type" content="website">
  <meta property="og:site_name" content="IRON SERVICE">
  <meta property="og:title" content="{_esc(name)}">
  <meta property="og:description" content="{_esc(описание)}">
  <meta property="og:url" content="{_esc(page_url)}">
  <meta property="og:image" content="{_esc(cover_url)}">
  <meta name="twitter:card" content="summary_large_image">"""

def build_source_from_match(match_entry: dict[str, Any]) -> dict[str, Any]:
    product = match_entry["product"]
    images_local = mirror_images(match_entry.get("images_remote") or [])
    file_slug = build_file_slug(product["name"], product["warehouse"], product["price"])
    return {
        "product_id": product["id"],
        "category": product["category"],
        "file_slug": file_slug,
        "name": product["name"],
        "country": product.get("country") or "",
        "warehouse": product.get("warehouse") or "",
        "price": product["price"],
        "catalog_url": match_entry.get("catalog_url") or "",
        "catalog_title": clean_catalog_title(match_entry.get("catalog_title") or product["name"]),
        "specs": match_entry.get("specs") or [],
        "images_remote": match_entry.get("images_remote") or [],
        "images_local": images_local,
    }


def render_html(source: dict[str, Any], lang: str = "ru") -> str:
    """HTML карточки. lang="en" — та же страница с переведёнными подписями и
    характеристиками; см. hybrid/i18n_en.py. Английские файлы лежат на уровень
    глубже (public/en/hybrid-products/), поэтому у них другой путь до ассетов."""
    en = lang == "en"
    base = "../../.." if en else "../.."
    name = source["name"]
    specs = source.get("specs") or []
    if en:
        # Название переводится тем же словарём, что в магазине (28.08.2026):
        # до этого английская карточка показывала «Защитное стекло 3D Remax»
        # там, где плитка магазина уже писала «Remax 3D screen protector».
        name = i18n_en.product_name(name)
        specs = i18n_en.translate_specs(specs)
    images_rel = source.get("images_local") or []
    images_js = [f"{base}/{rel}" for rel in images_rel]
    meta_description = (
        i18n_en.UI["meta_description"].format(name=name) if en
        else f"{name} — актуальная цена и характеристики в IRON SERVICE, Сочи."
    )

    file_slug = source.get("file_slug") or build_file_slug(
        source["name"], source.get("warehouse") or "", source["price"]
    )
    category = source["category"]
    ru_url = f"{SITE_ORIGIN}/hybrid-products/{category}/{file_slug}.html"
    en_url = f"{SITE_ORIGIN}/en/hybrid-products/{category}/{file_slug}.html"
    # Обе версии генерируются вместе, поэтому hreflang можно ставить всегда:
    # страница, на которую он указывает, заведомо существует.
    alternates = (
        f'  <link rel="canonical" href="{en_url if en else ru_url}">\n'
        f'  <link rel="alternate" hreflang="ru" href="{ru_url}">\n'
        f'  <link rel="alternate" hreflang="en" href="{en_url}">\n'
        f'  <link rel="alternate" hreflang="x-default" href="{ru_url}">'
    )

    подписи = i18n_en.UI if en else {
        "back": "← Назад в Магазин",
        "price": "Цена:",
        "price_note": "Цена за наличный расчет · из актуального прайса IRON SERVICE",
        "specs": "Характеристики",
        "pick": "+ Выбрать",
        "preorder": "🛩️ под заказ, 1–2 дня",
        "about": "<strong>IRON SERVICE</strong> — магазин и сервис Apple в Сочи, ул. Московская, 5.",
        "order": "Заказ:",
        "footer_legal": "Независимый сервис Apple в Сочи. Не является официальным сайтом Apple Inc.",
    }
    shop_href = f"{base}/en/shop.html" if en else f"{base}/magazin.html"
    home_href = f"{base}/en/index.html" if en else f"{base}/index.html"

    spec_rows = "".join(
        f"<tr><td>{_esc(item['key'])}</td><td>{_esc(item['value'])}</td></tr>"
        for item in specs
    )
    # Пустой заголовок «Характеристики» с пустой таблицей под ним выглядит как
    # недоделанная карточка. Если у поставщика характеристик нет вовсе (защитные
    # стёкла, часть аксессуаров) — блока просто не будет (28.08.2026).
    specs_block = (
        f'<h3 class="price-card__name">{подписи["specs"]}</h3>\n        '
        f"<table>{spec_rows}</table>\n        "
        if spec_rows
        else ""
    )
    # Позиция склада S3 — не наличие, а поставка за 1–2 дня. Без этой пометки
    # детальная страница выглядела бы как товар в наличии: в магазине бейдж есть,
    # а на странице товара его не было вовсе (27.08.2026, когда для S3 начали
    # собирать карточки). Класс тот же, что в магазине, — стиль в shop.css.
    preorder_badge = (
        f'\n          <p class="price-card__preorder">{подписи["preorder"]}</p>'
        if re.search(r"s3", str(source.get("warehouse") or ""), re.I)
        else ""
    )
    gallery_main, thumbs_html = _gallery_block(images_rel, name, base)
    images_literal = json.dumps(images_js[:MAX_GALLERY_IMAGES], ensure_ascii=False)
    og_block = _og_block(source, images_rel, lang)

    return f"""<!DOCTYPE html>
<html lang="{lang}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="{_esc(meta_description)}">
{alternates}
{og_block}
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; base-uri 'self'; form-action 'self'; object-src 'none'; upgrade-insecure-requests; style-src 'self' https://fonts.bunny.net 'unsafe-inline'; font-src https://fonts.bunny.net; img-src 'self' data:; script-src 'self' https://telegram.org 'unsafe-inline'; connect-src 'self' https://docs.google.com https://order-bot.4489530.workers.dev https://functions.yandexcloud.net; frame-src 'none'">
  <title>{_esc(name)} — IRON SERVICE</title>
  <link rel="preconnect" href="https://fonts.bunny.net">
  <link href="https://fonts.bunny.net/css?family=oswald:400,600,700|pt-sans-narrow:400,700" rel="stylesheet">
  <link rel="stylesheet" href="{base}/css/styles.css?v={HYBRID_CART_VERSION}">
  <link rel="stylesheet" href="{base}/css/shop.css?v={HYBRID_CART_VERSION}">
  <link rel="stylesheet" href="{base}/css/hybrid-card.css?v={HYBRID_CARD_ASSETS_VERSION}">
</head>
<body>
  <header class="site-header">
    <div class="container header-inner">
      <a href="{home_href}" class="logo-link"><img src="{base}/assets/logo-horizontal.png" alt="IRON SERVICE" class="logo-img"></a>
      <a href="{shop_href}" class="header-phone">{подписи["back"]}</a>
    </div>
  </header>
  <main class="detail-wrap">
    <h1>{_esc(name)}</h1>
    <div class="detail-grid">
      <section class="price-card">
        <h3 class="price-card__name">{_esc(name)}</h3>
        <div class="meta">
          <p class="price-line"><b>{подписи["price"]}</b> <span class="price-card__price" aria-live="polite"></span></p>{preorder_badge}
          <p class="meta-note">{подписи["price_note"]}</p>
        </div>
        <div class="gallery-main">
          {gallery_main}
          <button type="button" class="gallery-nav gallery-prev" id="galleryPrev">‹</button>
          <button type="button" class="gallery-nav gallery-next" id="galleryNext">›</button>
        </div>
        <div class="thumbs" id="thumbs">{thumbs_html}</div>
        <div class="price-card__footer" style="margin-top:.8rem;">
          <strong class="price-card__price" aria-live="polite"></strong>
          <button type="button" class="price-card__btn" id="pickBtn" data-name="{_esc(name)}" data-country="{_esc(source.get('country') or '')}" data-warehouse="{_esc(source.get('warehouse') or '')}">{подписи["pick"]}</button>
        </div>
      </section>
      <section class="price-card">
        {specs_block}<div class="desc">
          <p>{подписи["about"]}</p>
          <p>{подписи["order"]} <a href="tel:+79288509404">+7 928 850-94-04</a> · <a href="https://t.me/ironsochi" target="_blank" rel="noopener">Telegram</a> · <a href="https://yandex.ru/profile/1716684342" target="_blank" rel="noopener">{"Yandex Maps" if en else "Яндекс.Карты"}</a></p>
        </div>
      </section>
    </div>
  </main>
  <footer class="site-footer hybrid-detail-footer">
    <div class="container footer-bottom">
      <p>© IRON SERVICE · {"Sochi" if en else "Сочи"} · <a href="tel:+79288509404">+7 928 850-94-04</a></p>
      <p class="footer-legal">{подписи["footer_legal"]}</p>
    </div>
  </footer>
  <div class="lightbox" id="lightbox">
    <img id="lbImg" src="" alt="">
    <button class="lightbox-close" id="lbClose">✕</button>
  </div>
  <script>const IMAGES = {images_literal};</script>
  <script src="{base}/js/hybrid-gallery.js?v={HYBRID_CARD_ASSETS_VERSION}"></script>
  <script src="{base}/js/config.js"></script>
  <script src="{base}/js/i18n.js?v={HYBRID_CART_VERSION}"></script>
  <script src="{base}/js/hybrid-cart.js?v={HYBRID_CART_VERSION}"></script>
</body>
</html>
"""


def build_card_from_source(source: dict[str, Any], *, write_html: bool = True) -> dict[str, str]:
    category = source["category"]
    product_id = source["product_id"]
    file_slug = source.get("file_slug") or build_file_slug(
        source["name"], source.get("warehouse") or "", source["price"]
    )
    source["file_slug"] = file_slug
    save_source(source)

    rel_url = f"hybrid-products/{category}/{file_slug}.html"
    rel_url_en = f"en/hybrid-products/{category}/{file_slug}.html"
    cover = source.get("images_local", [""])[0] if source.get("images_local") else ""

    if write_html:
        # Обе версии пишутся вместе — иначе английская отстаёт от русской при
        # каждой пересборке и постепенно расходится с ней по данным.
        for lang in ("ru", "en"):
            out_path = html_path(category, file_slug, lang)
            out_path.parent.mkdir(parents=True, exist_ok=True)
            out_path.write_text(render_html(source, lang), encoding="utf-8")

    upsert_manifest_entry(
        category,
        product_id,
        {
            "url": rel_url,
            "url_en": rel_url_en,
            "cover": cover,
            "name": source["name"],
            "warehouse": source.get("warehouse") or "",
            "price": source["price"],
        },
    )
    return {"product_id": product_id, "url": rel_url, "source": str(save_source(source))}
