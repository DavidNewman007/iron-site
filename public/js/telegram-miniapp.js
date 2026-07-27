/**
 * Определяет, открыта ли страница как Telegram Mini App (кнопка бота
 * @IRON_SERVICE_ORDER_bot), и если да — ставит класс "tg-miniapp" на <html>.
 * Визуальная зачистка (шапка/подвал/крупный заголовок/промо/запасные способы
 * брони) — в css/shop.css по этому классу; здесь: детект, переименование
 * кнопки заказа и штатная кнопка «назад» на страницах карточек товара —
 * Telegram Mini App не даёт браузерного «назад», нужно явно включать через
 * Telegram.WebApp.BackButton.
 *
 * Подключается с двух сторон: <script> в <head> у magazin.html, и динамически
 * из hybrid-cart.js на страницах карточек товара (их ~1200, редактировать
 * каждую нет смысла).
 *
 * НЕ подключается при обычном заходе в браузере — класс появляется только
 * когда открытие внутри Telegram подтверждено.
 */
(function () {
  function isDetailPage() {
    return !!document.getElementById("pickBtn");
  }

  // На листинге (magazin.html) кнопка — это уже финальный чекаут (корзина и
  // так видна на той же странице) — «Оформить заказ». На карточке товара это
  // должен быть переход В корзину (посмотреть все товары, оформить там), а
  // не мгновенный чекаут текущего товара — поэтому текст и клик там другие.
  function relabelOrderButton() {
    var run = function () {
      var tgBtn = document.getElementById("cart-telegram") || document.getElementById("hybrid-cart-telegram");
      if (!tgBtn) return;
      tgBtn.textContent = isDetailPage() ? "🛒 Корзина" : "✅ Оформить заказ";
    };
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", run);
    } else {
      run();
    }
  }

  // На карточке товара перехватываем клик ДО обработчика hybrid-cart.js
  // (capture-фаза срабатывает раньше) — вместо мгновенного чекаута просто
  // ведём в корзину на magazin.html, товар при этом уже добавлен кнопкой
  // «+ Выбрать» на самой карточке.
  function setupDetailCartButtonNav() {
    if (!isDetailPage()) return;
    document.addEventListener(
      "click",
      function (e) {
        var btn = e.target.closest && e.target.closest("#hybrid-cart-telegram, #cart-telegram");
        if (!btn) return;
        e.preventDefault();
        e.stopPropagation();
        window.location.href = "../../magazin.html";
      },
      true
    );
  }

  // Полоса корзины внизу — кликабельна целиком, не только сама кнопка внутри
  // (легче попасть пальцем). Клик по остальной части полосы делегируем на
  // главную кнопку (переключатель корзины на листинге, «Корзина»/«Оформить
  // заказ» на карточке).
  function makeCartBarFullyClickable() {
    var run = function () {
      document.querySelectorAll(".cart-mobile-bar").forEach(function (bar) {
        bar.addEventListener("click", function (e) {
          if (e.target.closest("button")) return;
          var primary =
            bar.querySelector("#cart-toggle") ||
            bar.querySelector("#hybrid-cart-telegram") ||
            bar.querySelector("#cart-telegram");
          if (primary) primary.click();
        });
      });
    };
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", run);
    } else {
      run();
    }
  }

  // На странице карточки товара (есть #pickBtn) — показываем кнопку «назад»,
  // на magazin.html (списке) — прячем (это «домашний» экран мини-аппа).
  function setupBackButton(twa) {
    if (!twa || !twa.BackButton) return;
    var run = function () {
      var isDetailPage = !!document.getElementById("pickBtn");
      if (!isDetailPage) {
        twa.BackButton.hide();
        return;
      }
      twa.BackButton.show();
      twa.BackButton.onClick(function () {
        if (window.history.length > 1) {
          window.history.back();
        } else {
          // Прямой заход на карточку (без истории) — тот же запасной путь,
          // что уже использует hybrid-cart.js для пустой корзины.
          window.location.href = "../../magazin.html";
        }
      });
    };
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", run);
    } else {
      run();
    }
  }

  function markMiniApp(twa) {
    if (!document.documentElement.classList.contains("tg-miniapp")) {
      document.documentElement.classList.add("tg-miniapp");
      relabelOrderButton();
      setupDetailCartButtonNav();
      makeCartBarFullyClickable();
    }
    if (twa) setupBackButton(twa);
  }

  // Не полагаемся на одно только initData (неясно, всегда ли оно заполняется
  // для web_app-кнопки reply-клавиатуры/кнопки меню) — берём любой из
  // достоверных признаков.
  function isRealTelegramContext(twa) {
    if (!twa) return false;
    if (twa.initData) return true;
    if (twa.platform && twa.platform !== "unknown") return true;
    if (twa.initDataUnsafe && Object.keys(twa.initDataUnsafe).length) return true;
    return false;
  }

  // Быстрая синхронная догадка по hash — не ждём загрузки SDK, чтобы меньше
  // мигало (класс/текст кнопки можно проставить сразу; BackButton — только
  // когда появится реальный twa ниже).
  var hash = window.location.hash || "";
  if (/tgWebAppData|tgWebAppPlatform/.test(hash)) {
    markMiniApp(null);
  }

  if (window.Telegram && window.Telegram.WebApp && isRealTelegramContext(window.Telegram.WebApp)) {
    window.IRON_TG_WEBAPP = window.Telegram.WebApp;
    markMiniApp(window.Telegram.WebApp);
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
      markMiniApp(twa);
    }
  };
  document.head.appendChild(s);
})();
