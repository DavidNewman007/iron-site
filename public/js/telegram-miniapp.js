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
