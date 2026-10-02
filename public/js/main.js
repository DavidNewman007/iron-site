(function () {
  const config = window.IRON_CONFIG || {};

  // Mobile nav
  const toggle = document.querySelector(".nav-toggle");
  const nav = document.querySelector(".main-nav");
  if (toggle && nav) {
    toggle.addEventListener("click", () => {
      nav.classList.toggle("is-open");
      toggle.setAttribute(
        "aria-expanded",
        nav.classList.contains("is-open") ? "true" : "false"
      );
    });
  }

  // Active nav link
  const path = window.location.pathname.split("/").pop() || "index.html";
  document.querySelectorAll(".main-nav a").forEach((link) => {
    const href = link.getAttribute("href");
    if (href === path || (path === "" && href === "index.html")) {
      link.classList.add("active");
    }
  });

  // Yandex Map embed
  const mapEl = document.getElementById("yandex-map");
  if (mapEl && config.map) {
    const { lat, lon, zoom, orgId } = config.map;
    const z = zoom || 17;
    const src = orgId
      ? `https://yandex.ru/map-widget/v1/?z=${z}&ol=biz&oid=${orgId}&l=map`
      : `https://yandex.ru/map-widget/v1/?ll=${lon}%2C${lat}&z=${z}&pt=${lon}%2C${lat}%2Cpm2rdm&l=map`;
    mapEl.innerHTML = `<iframe src="${src}" allowfullscreen loading="lazy" title="IRON SERVICE на карте"></iframe>`;
  }

  // Contact form
  const form = document.getElementById("contact-form");
  if (!form) return;

  // Подписи формы берутся из data-атрибутов, если они заданы (17.08.2026,
  // английская версия сайта в /en/). Русская форма их не задаёт и получает те
  // же строки, что и раньше, — поэтому на неё эта правка никак не влияет.
  // Через data-атрибуты, а не через отдельный main.en.js: логика формы одна,
  // разъезжаться двум копиям здесь незачем.
  const t = (key, ru) => form.dataset[key] || ru;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const status = document.getElementById("form-status");
    const btn = form.querySelector('button[type="submit"]');
    const data = Object.fromEntries(new FormData(form));

    if (!config.apiUrl) {
      const tel = data.phone || "";
      const text = encodeURIComponent(
        `${t("lead", "Заявка с сайта IRON SERVICE")}\n` +
          `${t("fName", "Имя")}: ${data.name}\n` +
          `${t("fPhone", "Тел")}: ${tel}\n` +
          `${t("fDevice", "Устройство")}: ${data.device}\n` +
          `${t("fProblem", "Проблема")}: ${data.message}`
      );
      window.open(`https://t.me/ironsochi?text=${text}`, "_blank");
      if (status) {
        status.className = "form-status success";
        status.textContent = t(
          "sentNoBackend",
          "Backend не настроен — открыли Telegram. После деплоя укажите apiUrl в config.js."
        );
      }
      return;
    }

    btn.disabled = true;
    if (status) {
      status.className = "form-status";
      status.style.display = "none";
    }

    try {
      const headers = { "Content-Type": "application/json" };
      if (config.apiToken) headers["X-Function-Token"] = config.apiToken;

      const res = await fetch(config.apiUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(data),
      });

      if (!res.ok) throw new Error(await res.text());

      if (status) {
        status.className = "form-status success";
        status.textContent = t("sentOk", "Заявка отправлена. Мы свяжемся с вами в ближайшее время.");
      }
      form.reset();
    } catch (err) {
      if (status) {
        status.className = "form-status error";
        status.textContent = t(
          "sentFail",
          "Не удалось отправить заявку. Позвоните: +7 928 850-94-04"
        );
      }
      console.error(err);
    } finally {
      btn.disabled = false;
    }
  });
})();

/* >>> IRON-SUBBAR START — полоса акции «Подарок подписчикам канала» (план 100, 01.10.2026; v2 — 02.10.2026) >>> */
/*
 * Вставлено скриптом scripts/podpiska/применить-сайт.sh (репозиторий iron-automation).
 * v2 (02.10.2026): у кода два подарка на выбор — −3000 ₽ на новый iPhone/MacBook или стекло с
 * поклейкой к ремонту (решение владельца: за первые сутки код не взял никто, а приходят чиниться).
 * Ключ закрытия сменён на «-v2»: кто закрыл полосу первой версии, увидит новое предложение один раз.
 * Править блок там, в сайт/main-js-вставка.js, и применять заново: скрипт заменяет
 * всё между маркерами START/END, повторный запуск ничего не дублирует.
 *
 * Отдельный IIFE в конце файла, а не внутри основного: основной выходит по
 * `if (!form) return;` на всех страницах без формы заявки, и код после этой
 * строки там бы не выполнился.
 *
 * Где полоса НЕ показывается:
 *  - после SUBBAR_UNTIL (дата строкой, по локальному времени посетителя) — сама,
 *    без нового деплоя; заодно прячет строки акции, вписанные в страницы
 *    (элементы с атрибутом data-promo-sub, например в табло magazin.html);
 *  - в Telegram mini-app (magazin.html, открытая кнопкой бота): там корзина бота
 *    и так под рукой. Признаки те же, что у js/telegram-miniapp.js, плюс правило
 *    CSS на класс .tg-miniapp — SDK Telegram может догрузиться позже main.js;
 *  - на самой podpiska.html и на страницах, где строка акции уже есть в разметке
 *    (data-promo-sub), — чтобы не повторяться;
 *  - на английской версии (<html lang="en">): текст акции только русский;
 *  - если посетитель закрыл полосу крестиком (localStorage, ключ с месяцем акции).
 * Внешних ресурсов нет: стиль — <style> из этого же скрипта (style-src
 * 'unsafe-inline' есть на всех 110 страницах с main.js, проверено 01.10.2026).
 */
(function () {
  "use strict";
  var SUBBAR_UNTIL = "2026-10-15"; // последний день показа (выдача кодов — до 15.10 включительно); с 16.10 полосы нет
  var STORE_KEY = "iron-subbar-2026-10-v2";
  var HREF = "/podpiska.html?src=site";

  function pad(n) {
    return (n < 10 ? "0" : "") + n;
  }
  var now = new Date();
  var today = now.getFullYear() + "-" + pad(now.getMonth() + 1) + "-" + pad(now.getDate());
  var doc = document.documentElement;

  if (today > SUBBAR_UNTIL) {
    var rows = document.querySelectorAll("[data-promo-sub]");
    // style.display, а не только hidden: у строки в табло magazin.html свой display:flex
    // из shop.css, и атрибут hidden его не перебивает.
    for (var i = 0; i < rows.length; i++) {
      rows[i].hidden = true;
      rows[i].style.display = "none";
    }
    return;
  }
  if ((doc.getAttribute("lang") || "ru").slice(0, 2) !== "ru") return;
  if (/\/podpiska(\.html)?$/.test(window.location.pathname)) return;
  if (document.querySelector("[data-promo-sub]")) return;
  if (document.getElementById("iron-subbar")) return;

  function isMiniApp() {
    if (doc.classList.contains("tg-miniapp")) return true;
    if (/tgWebAppData|tgWebAppPlatform/.test(window.location.hash || "")) return true;
    var twa = window.Telegram && window.Telegram.WebApp;
    if (!twa) return false;
    if (twa.initData) return true;
    if (twa.platform && twa.platform !== "unknown") return true;
    return false;
  }
  if (isMiniApp()) return;

  try {
    if (window.localStorage.getItem(STORE_KEY) === "closed") return;
  } catch (e) {
    /* хранилище недоступно (приватный режим, запрет) — просто показываем */
  }

  var css =
    ".iron-subbar{position:relative;z-index:101;background:linear-gradient(90deg,#8f2e2e,#c22c2c 45%,#8f2e2e);" +
    "border-bottom:1px solid rgba(212,160,18,.6);color:#f5e6c8;" +
    "font-family:Oswald,'Arial Narrow',sans-serif;font-size:14px;line-height:1.3;letter-spacing:.02em}" +
    ".iron-subbar__inner{box-sizing:border-box;max-width:1200px;margin:0 auto;min-height:36px;" +
    "padding:6px 40px 6px 12px;display:flex;align-items:center;justify-content:center}" +
    ".iron-subbar__link{display:flex;flex-wrap:nowrap;align-items:center;justify-content:center;" +
    "gap:10px;color:#f5e6c8;text-decoration:none;text-align:center;min-width:0}" +
    ".iron-subbar__text{min-width:0}" +
    ".iron-subbar__link:hover,.iron-subbar__link:focus-visible{color:#fff}" +
    ".iron-subbar__cta{display:inline-block;background:#d4a012;color:#141414;border-radius:999px;" +
    "padding:2px 10px;font-weight:600;white-space:nowrap;flex:none}" +
    ".iron-subbar__link:hover .iron-subbar__cta{background:#f5e6c8}" +
    ".iron-subbar__close{position:absolute;top:50%;right:6px;transform:translateY(-50%);" +
    "width:30px;height:30px;padding:0;border:0;border-radius:50%;background:transparent;" +
    "color:#f5e6c8;font:20px/30px Arial,sans-serif;cursor:pointer;opacity:.85}" +
    ".iron-subbar__close:hover,.iron-subbar__close:focus-visible{opacity:1;background:rgba(0,0,0,.2)}" +
    // На телефоне — не больше двух строк: текст слева переносится, кнопка справа не переносится
    // (замер 01.10.2026 на 375px: по центру с переносом полоса выходила в три строки, 72px).
    ".iron-subbar__short{display:none}" +
    // На телефоне — короткий текст: длинный с двумя подарками выходил в три строки.
    "@media (max-width:600px){.iron-subbar{font-size:13px;line-height:1.25}" +
    ".iron-subbar__long{display:none}.iron-subbar__short{display:inline}" +
    ".iron-subbar__inner{padding:6px 38px 6px 10px}" +
    ".iron-subbar__link{width:100%;justify-content:space-between;text-align:left;gap:8px}" +
    ".iron-subbar__cta{padding:3px 9px}}" +
    ".tg-miniapp .iron-subbar{display:none!important}";

  function mount() {
    if (!document.body || document.getElementById("iron-subbar")) return;
    var style = document.createElement("style");
    style.id = "iron-subbar-css";
    style.textContent = css;
    document.head.appendChild(style);

    var bar = document.createElement("div");
    bar.id = "iron-subbar";
    bar.className = "iron-subbar";
    bar.setAttribute("role", "region");
    bar.setAttribute("aria-label", "Акция для подписчиков канала");
    bar.innerHTML =
      '<div class="iron-subbar__inner">' +
      '<a class="iron-subbar__link" href="' + HREF + '">' +
      '<span class="iron-subbar__text">' +
      '<span class="iron-subbar__long">🎁 Подписчикам канала: −3000 ₽ на iPhone/MacBook или стекло в подарок к ремонту</span>' +
      '<span class="iron-subbar__short">🎁 Подписчикам: −3000 ₽ на iPhone/MacBook или стекло к ремонту</span>' +
      "</span>" +
      '<span class="iron-subbar__cta">Получить код →</span>' +
      "</a>" +
      '<button type="button" class="iron-subbar__close" aria-label="Скрыть">×</button>' +
      "</div>";
    bar.querySelector(".iron-subbar__close").addEventListener("click", function () {
      bar.parentNode && bar.parentNode.removeChild(bar);
      try {
        window.localStorage.setItem(STORE_KEY, "closed");
      } catch (e) {
        /* не запомнили — полоса вернётся на следующей странице, это не поломка */
      }
    });
    document.body.insertBefore(bar, document.body.firstChild);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }
})();
/* <<< IRON-SUBBAR END <<< */
