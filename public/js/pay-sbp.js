/**
 * Страница оплаты по СБП. Заведено 18.09.2026.
 *
 * Зачем она нужна. Раньше кнопка «Оплатить по СБП» вела прямо на qr.nspk.ru.
 * На телефоне это хорошо — открывается приложение банка. А на компьютере та
 * страница статическая: человек платит с телефона, а перед ним так и висит QR,
 * и понять, прошёл платёж или нет, невозможно (поймал владелец в первый же день).
 *
 * Здесь тот же QR (картинку рисует банк, поэтому никаких сторонних библиотек),
 * но страница сама спрашивает у функции статус заказа и, как только деньги
 * пришли, уходит на «Оплата прошла». На телефоне сразу открывает приложение
 * банка, не заставляя сканировать собственный экран.
 */
(function () {
  "use strict";

  var cfg = window.IRON_CONFIG || {};
  var PAY_URL = String(cfg.payApiUrl || "").trim();
  var order = new URLSearchParams(location.search).get("order") || "";
  var $ = function (id) { return document.getElementById(id); };

  if (!order || !PAY_URL) {
    location.replace("magazin.html");
    return;
  }

  function деньги(n) { return (Number(n) || 0).toLocaleString("ru-RU") + " ₽"; }

  function телефон() {
    return /Android|iPhone|iPad|iPod|Opera Mini|IEMobile/i.test(navigator.userAgent);
  }

  function запрос(параметр) {
    return fetch(PAY_URL + (PAY_URL.indexOf("?") >= 0 ? "&" : "?") + параметр, { cache: "no-store" })
      .then(function (r) { return r.json(); });
  }

  запрос("sbpinfo=" + encodeURIComponent(order))
    .then(function (d) {
      if (d.сумма) $("sbp-sum").textContent = "К оплате " + деньги(d.сумма);
      if (d.image) {
        var img = new Image();
        // Картинка приходит от банка в base64 — подставляем как есть, внешних
        // запросов не делаем, поэтому CSP трогать не пришлось.
        img.src = d.image.indexOf("data:") === 0 ? d.image : "data:image/png;base64," + d.image;
        img.alt = "QR-код для оплаты по СБП";
        img.width = 260;
        img.height = 260;
        $("sbp-qr").appendChild(img);
      }
      if (d.payload) {
        var a = $("sbp-open");
        a.href = d.payload;
        a.hidden = false;
        if (телефон()) {
          // На телефоне сканировать свой же экран нечем — сразу в приложение банка.
          $("sbp-lead").textContent = "Открываем приложение банка…";
          location.href = d.payload;
        }
      }
      if (!d.image && !d.payload) {
        $("sbp-status").textContent = "Не удалось показать код. Позвоните нам — поможем оплатить.";
      }
    })
    .catch(function () {
      $("sbp-status").textContent = "Не удалось показать код. Позвоните нам — поможем оплатить.";
    });

  var попыток = 0;
  (function следить() {
    попыток++;
    // Платёж по СБП проходит за секунды, но человек может отвлечься: спрашиваем
    // раз в три секунды примерно полчаса — столько же живёт сам заказ.
    if (попыток > 600) {
      $("sbp-status").textContent = "Время ожидания вышло. Если деньги списались, заказ у нас — мы позвоним.";
      return;
    }
    запрос("check=" + encodeURIComponent(order))
      .then(function (d) {
        if (d && d.оплачен === true) {
          try { localStorage.setItem("iron_cart", "[]"); } catch (e) { /* не страшно */ }
          location.replace("pay-success.html?order=" + encodeURIComponent(order));
          return;
        }
        setTimeout(следить, 3000);
      })
      .catch(function () { setTimeout(следить, 5000); });
  })();
})();
