/**
 * Определяет, открыта ли страница как Telegram Mini App (кнопка бота
 * @IRON_SERVICE_ORDER_bot — «Каталог» в меню или инлайн-кнопка «🌐 Каталог
 * на сайте»), и если да — ставит класс "tg-miniapp" на <html>. Вся визуальная
 * зачистка (шапка/подвал/крупный заголовок/промо/запасные способы брони) —
 * в css/shop.css по этому классу; здесь только детект + переименование
 * кнопки заказа (текст нужно менять через JS, CSS тут не поможет).
 *
 * НЕ подключается при обычном заходе в браузере — класс появляется только
 * когда открытие внутри Telegram подтверждено (по hash сразу при заходе,
 * либо позже через сам SDK). Подтверждено логами: hash содержит
 * tgWebAppData/tgWebAppPlatform уже на входе, детект отрабатывает надёжно.
 */
(function () {
  function relabelOrderButton() {
    var run = function () {
      var tgBtn = document.getElementById("cart-telegram") || document.getElementById("hybrid-cart-telegram");
      if (tgBtn) tgBtn.textContent = "✅ Оформить заказ";
    };
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", run);
    } else {
      run();
    }
  }

  // Telegram Mini App не даёt штатной кнопки «назад» между страницами (это
  // не браузерная вкладка — «Закрыть» закрывает весь мини-апп целиком). Раз
  // добавить товар в корзину можно прямо из списка на magazin.html, просто не
  // пускаем на отдельные страницы карточек — там и стрипинг ещё не работает
  // (CSP не пускает Telegram SDK, см. ARCHITECTURE/план), и деваться некуда.
  function blockDetailPageNavigation() {
    document.addEventListener(
      "click",
      function (e) {
        if (!document.documentElement.classList.contains("tg-miniapp")) return;
        var link = e.target.closest && e.target.closest("a.price-card__name-link, a.price-card__media");
        if (link) e.preventDefault();
      },
      true
    );
  }

  function markMiniApp() {
    if (document.documentElement.classList.contains("tg-miniapp")) return;
    document.documentElement.classList.add("tg-miniapp");
    relabelOrderButton();
    blockDetailPageNavigation();
  }

  // Не полагаемся на одно только initData (неясно, всегда ли оно заполняется
  // для web_app-кнопки/кнопки меню, а не только для полноценных Mini Apps
  // через t.me/bot/app) — берём любой из достоверных признаков.
  function isRealTelegramContext(twa) {
    if (!twa) return false;
    if (twa.initData) return true;
    if (twa.platform && twa.platform !== "unknown") return true;
    if (twa.initDataUnsafe && Object.keys(twa.initDataUnsafe).length) return true;
    return false;
  }

  // Быстрая синхронная догадка по hash — не ждём загрузки SDK, чтобы меньше
  // мигало на первой странице (там, где реально открыл бот).
  var hash = window.location.hash || "";
  if (/tgWebAppData|tgWebAppPlatform/.test(hash)) {
    markMiniApp();
  }

  if (window.Telegram && window.Telegram.WebApp && isRealTelegramContext(window.Telegram.WebApp)) {
    window.IRON_TG_WEBAPP = window.Telegram.WebApp;
    markMiniApp();
    return;
  }

  var s = document.createElement("script");
  s.src = "https://telegram.org/js/telegram-web-app.js";
  s.onload = function () {
    var twa = window.Telegram && window.Telegram.WebApp;
    if (isRealTelegramContext(twa)) {
      window.IRON_TG_WEBAPP = twa;
      try {
        twa.ready();
      } catch (e) {
        /* не критично */
      }
      try {
        twa.expand();
      } catch (e) {
        /* не критично */
      }
      markMiniApp();
    }
  };
  document.head.appendChild(s);
})();
