from __future__ import annotations

import html
import json
from typing import Any

from .config import HYBRID_CART_VERSION
from .images import mirror_images
from .manifest import html_path, save_source, upsert_manifest_entry
from .slug import build_file_slug


GALLERY_SCRIPT = r"""
    const IMAGES = __IMAGES__;
    const mainImg = document.getElementById('mainImg');
    const galleryMain = document.querySelector('.gallery-main');
    const thumbs = Array.from(document.querySelectorAll('.thumb'));
    const lightbox = document.getElementById('lightbox');
    const lbImg = document.getElementById('lbImg');
    let idx = 0;

    function parsePrice(v) {
      const n = String(v || '').replace(/[^\d]/g, '');
      return n ? parseInt(n, 10) : 0;
    }
    function formatPrice(n) {
      return n.toLocaleString('ru-RU') + ' ₽';
    }
    function setImage(i) {
      if (!IMAGES.length || !mainImg) return;
      idx = (i + IMAGES.length) % IMAGES.length;
      const nextSrc = IMAGES[idx];
      mainImg.classList.add('is-fading');
      if (lbImg) lbImg.classList.add('is-fading');
      const pre = new Image();
      pre.onload = () => {
        mainImg.src = nextSrc;
        if (lbImg) lbImg.src = nextSrc;
      };
      pre.onerror = () => {
        mainImg.classList.remove('is-fading');
        if (lbImg) lbImg.classList.remove('is-fading');
      };
      pre.src = nextSrc;
      thumbs.forEach((t, ti) => t.classList.toggle('is-active', ti === idx));
    }
    function openLightbox() {
      if (!IMAGES.length || !lbImg) return;
      lbImg.src = IMAGES[idx];
      lightbox.classList.add('is-open');
    }
    function closeLightbox() { lightbox.classList.remove('is-open'); }
    function nav(step) { setImage(idx + step); }
    if (mainImg) mainImg.addEventListener('load', () => mainImg.classList.remove('is-fading'));
    if (lbImg) lbImg.addEventListener('load', () => lbImg.classList.remove('is-fading'));

    function bindSwipe(el, onLeft, onRight, onTap, dragTarget) {
      if (!el) return;
      let sx = 0, sy = 0, ex = 0, ey = 0, active = false;
      const TH = 40;
      function start(x, y) {
        active = true; sx = ex = x; sy = ey = y;
        if (dragTarget && dragTarget.classList) dragTarget.classList.add('is-swiping');
      }
      function move(x, y) { if (active) { ex = x; ey = y; } }
      function end(ev) {
        if (!active) return;
        active = false;
        if (dragTarget && dragTarget.classList) dragTarget.classList.remove('is-swiping');
        const dx = ex - sx, dy = ey - sy, ax = Math.abs(dx), ay = Math.abs(dy);
        if (ax >= TH && ax > ay) return dx < 0 ? onLeft && onLeft() : onRight && onRight();
        if (ax < 8 && ay < 8) onTap && onTap(ev);
      }
      el.addEventListener('touchstart', (e) => e.touches && e.touches[0] && start(e.touches[0].clientX, e.touches[0].clientY), { passive: true });
      el.addEventListener('touchmove', (e) => e.touches && e.touches[0] && move(e.touches[0].clientX, e.touches[0].clientY), { passive: true });
      el.addEventListener('touchend', end, { passive: true });
      el.addEventListener('touchcancel', () => { active = false; if (dragTarget && dragTarget.classList) dragTarget.classList.remove('is-swiping'); }, { passive: true });
      el.addEventListener('mousedown', (e) => start(e.clientX, e.clientY));
      el.addEventListener('mousemove', (e) => move(e.clientX, e.clientY));
      el.addEventListener('mouseup', end);
      el.addEventListener('mouseleave', () => { active = false; if (dragTarget && dragTarget.classList) dragTarget.classList.remove('is-swiping'); });
    }

    if (mainImg) {
      mainImg.setAttribute('draggable', 'false');
      mainImg.addEventListener('click', openLightbox);
    }
    if (lbImg) lbImg.setAttribute('draggable', 'false');
    thumbs.forEach((t) => t.addEventListener('click', () => setImage(parseInt(t.dataset.idx || '0', 10))));
    document.getElementById('galleryPrev').addEventListener('click', (e) => { e.stopPropagation(); nav(-1); });
    document.getElementById('galleryNext').addEventListener('click', (e) => { e.stopPropagation(); nav(1); });
    document.getElementById('lbClose').addEventListener('click', closeLightbox);
    lightbox.addEventListener('click', (e) => { if (e.target === lightbox) closeLightbox(); });
    bindSwipe(galleryMain, () => nav(1), () => nav(-1), null, galleryMain);
    bindSwipe(lbImg, () => nav(1), () => nav(-1), null, lbImg);
    bindSwipe(lightbox, () => nav(1), () => nav(-1), (e) => { if (e.target === lightbox) closeLightbox(); });
    document.addEventListener('keydown', (e) => {
      if (!lightbox.classList.contains('is-open')) return;
      if (e.key === 'Escape') closeLightbox();
      if (e.key === 'ArrowLeft') nav(-1);
      if (e.key === 'ArrowRight') nav(1);
    });

    setImage(0);
"""


def _esc(value: str) -> str:
    return html.escape(str(value or ""), quote=True)


def _gallery_block(images_rel: list[str], catalog_title: str) -> tuple[str, str]:
    if not images_rel:
        return ("<p>Изображения не найдены</p>", "")
    main = f"../../{images_rel[0]}"
    main_img = (
        f'<img id="mainImg" src="{_esc(main)}" alt="{_esc(catalog_title)}" '
        f'loading="eager" decoding="async" fetchpriority="high">'
    )
    thumbs = []
    for idx, rel in enumerate(images_rel[1:6], start=0):
        src = f"../../{rel}"
        thumbs.append(
            f'<button type="button" class="thumb" data-idx="{idx + 1}">'
            f'<img src="{_esc(src)}" alt="" loading="lazy" decoding="async"></button>'
        )
    return main_img, "".join(thumbs)


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
        "catalog_title": match_entry.get("catalog_title") or product["name"],
        "specs": match_entry.get("specs") or [],
        "images_remote": match_entry.get("images_remote") or [],
        "images_local": images_local,
    }


def render_html(source: dict[str, Any]) -> str:
    name = source["name"]
    catalog_title = source.get("catalog_title") or name
    specs = source.get("specs") or []
    images_rel = source.get("images_local") or []
    images_js = [f"../../{rel}" for rel in images_rel]

    spec_rows = "".join(
        f"<tr><td>{_esc(item['key'])}</td><td>{_esc(item['value'])}</td></tr>"
        for item in specs
    )
    gallery_main, thumbs_html = _gallery_block(images_rel, catalog_title)
    images_literal = json.dumps(images_js, ensure_ascii=False)
    gallery_script = GALLERY_SCRIPT.replace("__IMAGES__", images_literal)

    return f"""<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; base-uri 'self'; form-action 'self'; object-src 'none'; upgrade-insecure-requests; style-src 'self' https://fonts.bunny.net 'unsafe-inline'; font-src https://fonts.bunny.net; img-src 'self' data:; script-src 'self' 'unsafe-inline'; connect-src 'self' https://docs.google.com; frame-src 'none'">
  <title>{_esc(name)} — IRON SERVICE</title>
  <link rel="preconnect" href="https://fonts.bunny.net">
  <link href="https://fonts.bunny.net/css?family=oswald:400,600,700|pt-sans-narrow:400,700" rel="stylesheet">
  <link rel="stylesheet" href="../../css/styles.css">
  <link rel="stylesheet" href="../../css/shop.css">
  <style>
    .detail-wrap {{ max-width: 1200px; margin: 0 auto; padding: 1rem; }}
    .detail-grid {{ display:grid; grid-template-columns: 1fr 1fr; gap:1rem; align-items:start; }}
    .gallery-main {{ position:relative; width:100%; min-height:360px; display:flex; align-items:center; justify-content:center; cursor:grab; }}
    .gallery-main img {{ width:100%; max-height:380px; object-fit:contain; cursor:zoom-in; transition: opacity .32s ease, transform .32s ease; }}
    .gallery-main img.is-fading {{ opacity:.4; transform:scale(.995); }}
    .gallery-main.is-swiping {{ cursor:grabbing; }}
    .gallery-nav {{ position:absolute; top:50%; transform:translateY(-50%); width:38px; height:38px; border:none; background:rgba(0,0,0,.35); color:#fff; cursor:pointer; }}
    .gallery-prev {{ left:10px; }}
    .gallery-next {{ right:10px; }}
    .thumbs {{ display:flex; gap:.45rem; flex-wrap:wrap; margin-top:.6rem; }}
    .thumb {{ border:1px solid rgba(255,255,255,.12); background:rgba(255,255,255,.02); border-radius:10px; padding:0; width:64px; height:64px; cursor:pointer; opacity:.86; overflow:hidden; }}
    .thumb.is-active {{ opacity:1; border-color:#d4a012; box-shadow: 0 0 0 2px rgba(212,160,18,.2); }}
    .thumb img {{ width:100%; height:100%; object-fit:contain; }}
    .meta p {{ margin:.25rem 0; color:var(--text-muted); }}
    .meta b {{ color:var(--cream); }}
    .meta-note {{ margin-top:.2rem; font-size:.78rem; color:var(--text-muted); }}
    table {{ width:100%; border-collapse: collapse; margin-top: .75rem; font-size:.9rem; }}
    td {{ border-bottom:1px solid rgba(255,255,255,.12); padding:.45rem .35rem; vertical-align:top; }}
    td:first-child {{ width:38%; color:var(--text-muted); }}
    .desc {{ margin-top:1rem; color:var(--text-muted); line-height:1.45; font-size:.92rem; }}
    .desc p {{ margin:.45rem 0; }}
    .lightbox {{ position:fixed; inset:0; z-index:9999; display:none; align-items:center; justify-content:center; background:rgba(0,0,0,.92); }}
    .lightbox.is-open {{ display:flex; }}
    .lightbox img {{ max-width:min(94vw,1280px); max-height:88vh; object-fit:contain; transition: opacity .28s ease, transform .28s ease; touch-action: pan-y; cursor:grab; }}
    .lightbox img.is-fading {{ opacity:.45; transform:scale(.995); }}
    .lightbox img.is-swiping {{ cursor:grabbing; }}
    .lightbox-close {{ position:absolute; top:16px; right:16px; width:40px; height:40px; border:none; background:rgba(0,0,0,.35); color:#fff; cursor:pointer; }}
    @media (max-width: 900px) {{ .detail-grid {{ grid-template-columns:1fr; }} }}
  </style>
</head>
<body>
  <header class="site-header">
    <div class="container header-inner">
      <a href="../../index.html" class="logo-link"><img src="../../assets/logo-horizontal.png" alt="IRON SERVICE" class="logo-img"></a>
      <a href="../../magazin.html" class="header-phone">← Назад в Магазин</a>
    </div>
  </header>
  <main class="detail-wrap">
    <h1>{_esc(name)}</h1>
    <div class="detail-grid">
      <section class="price-card">
        <h3 class="price-card__name">{_esc(catalog_title)}</h3>
        <div class="meta">
          <p class="price-line"><b>Цена:</b> <span class="price-card__price" aria-live="polite"></span></p>
          <p class="meta-note">Цена за наличный расчет · из актуального прайса IRON SERVICE</p>
        </div>
        <div class="gallery-main">
          {gallery_main}
          <button type="button" class="gallery-nav gallery-prev" id="galleryPrev">‹</button>
          <button type="button" class="gallery-nav gallery-next" id="galleryNext">›</button>
        </div>
        <div class="thumbs" id="thumbs">{thumbs_html}</div>
        <div class="price-card__footer" style="margin-top:.8rem;">
          <strong class="price-card__price" aria-live="polite"></strong>
          <button type="button" class="price-card__btn" id="pickBtn" data-name="{_esc(name)}" data-country="{_esc(source.get('country') or '')}" data-warehouse="{_esc(source.get('warehouse') or '')}">+ Выбрать</button>
        </div>
      </section>
      <section class="price-card">
        <h3 class="price-card__name">Характеристики</h3>
        <table>{spec_rows}</table>
        <div class="desc">
          <p><strong>IRON SERVICE</strong> — магазин и сервис Apple в Сочи, ул. Московская, 5.</p>
          <p>Заказ: <a href="tel:+79288509404">+7 928 850-94-04</a> · <a href="https://t.me/ironsochi" target="_blank" rel="noopener">Telegram</a> · <a href="https://yandex.ru/profile/1716684342" target="_blank" rel="noopener">Яндекс.Карты</a></p>
        </div>
      </section>
    </div>
  </main>
  <footer class="site-footer hybrid-detail-footer">
    <div class="container footer-bottom">
      <p>© IRON SERVICE · Сочи · <a href="tel:+79288509404">+7 928 850-94-04</a></p>
      <p class="footer-legal">Независимый сервис Apple в Сочи. Не является официальным сайтом Apple Inc.</p>
    </div>
  </footer>
  <div class="lightbox" id="lightbox">
    <img id="lbImg" src="" alt="">
    <button class="lightbox-close" id="lbClose">✕</button>
  </div>
  <script>
{gallery_script}
  </script>
  <script src="../../js/config.js"></script>
  <script src="../../js/hybrid-cart.js?v={HYBRID_CART_VERSION}"></script>
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
    cover = source.get("images_local", [""])[0] if source.get("images_local") else ""

    if write_html:
        out_path = html_path(category, file_slug)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(render_html(source), encoding="utf-8")

    upsert_manifest_entry(
        category,
        product_id,
        {
            "url": rel_url,
            "cover": cover,
            "name": source["name"],
            "warehouse": source.get("warehouse") or "",
            "price": source["price"],
        },
    )
    return {"product_id": product_id, "url": rel_url, "source": str(save_source(source))}
