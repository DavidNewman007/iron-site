// Галерея карточки товара hybrid-products: листание, миниатюры, лайтбокс, свайпы.
//
// Вынесено из встроенного <script> каждой карточки 10.10.2026 (план 105, ST-С5):
// 4,8 КБ одного и того же кода повторялись в 13 796 файлах — около 64 МБ из
// предела GitHub Pages в 1 ГБ. В карточке осталась одна строка
// `const IMAGES = [...];` — список картинок именно этого товара. Её же читают
// аудит галерей (scripts/hybrid/audit_images.py), source_repair.py,
// recover_sources_from_html.py и patch_hybrid_covers.js, поэтому формат строки
// менять нельзя. Скрипт классический, не модуль: IMAGES — общая глобальная
// константа двух скриптов страницы.

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
