/**
 * Страница оформления заказа: контакты, способ получения, расчёт доставки СДЭК.
 * Заведено 15.09.2026 (план 71).
 *
 * Зачем эта страница вообще. Раньше из корзины уходили сразу на оплату, и о
 * покупателе не оставалось НИЧЕГО: ни имени, ни телефона, ни адреса — владелец
 * видел только сумму и состав. Оформить доставку по такому заказу нельзя:
 * телефон получателя в API СДЭК обязателен, без него накладная не создаётся.
 *
 * Что здесь считается, а что нет. Доставку клиент платит ПРИ ПОЛУЧЕНИИ (решение
 * владельца), поэтому её сумма здесь — справочная: в платёж она не входит и на
 * наценку не влияет. В банк уходит только стоимость товаров с налогом и
 * комиссией, как и раньше.
 *
 * Данные оформления уходят POST-ом в функцию оплаты и получают короткий id;
 * в адресной строке едет только он. Телефон и адрес через query не передаём:
 * URL оседает в логах, истории браузера и заголовке Referer.
 */
(function () {
  "use strict";

  var CART_KEY = "iron_cart";
  var cfg = window.IRON_CONFIG || {};
  var PAY_URL = String(cfg.payApiUrl || "").trim();
  var CDEK_URL = String(cfg.cdekApiUrl || "").trim();

  var $ = function (id) { return document.getElementById(id); };
  var состояние = {
    город: null,        // {code, name}
    пункты: [],
    доставка: null,     // {tariff_code, sum, period_min, period_max}
    занят: false,
  };

  // --- корзина -----------------------------------------------------------
  function корзина() {
    try { return JSON.parse(localStorage.getItem(CART_KEY) || "[]"); }
    catch (e) { return []; }
  }

  function деньги(n) { return (Number(n) || 0).toLocaleString("ru-RU") + " ₽"; }

  function отрисоватьЗаказ() {
    var items = корзина();
    if (!items.length) {
      location.replace("magazin.html");
      return 0;
    }
    var сумма = items.reduce(function (s, p) { return s + (Number(p.price) || 0); }, 0);
    $("checkout-items").innerHTML = items.map(function (p) {
      return "<li><span>" + экранировать(p.name || "Товар") + "</span><b>" + деньги(p.price) + "</b></li>";
    }).join("");
    $("checkout-goods").textContent = деньги(сумма);

    if (window.IRON_PAY) {
      window.IRON_PAY.load().then(function (rates) {
        var b = window.IRON_PAY.breakdown(сумма, rates);
        $("checkout-pay-note").textContent =
          "К оплате: по СБП " + деньги(b.способы.сбп.итог) +
          ", картой " + деньги(b.способы.карта.итог) +
          " — с налогом и комиссией банка. Доставка оплачивается отдельно при получении.";
        $("pay-sbp").textContent = "Оплатить по СБП · " + деньги(b.способы.сбп.итог);
        $("pay-card").textContent = "Оплатить картой · " + деньги(b.способы.карта.итог);
      });
    }
    return сумма;
  }

  function экранировать(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  // --- СДЭК ---------------------------------------------------------------
  function cdek(params) {
    if (!CDEK_URL) return Promise.reject(new Error("доставка не настроена"));
    var qs = Object.keys(params).map(function (k) {
      return encodeURIComponent(k) + "=" + encodeURIComponent(params[k]);
    }).join("&");
    return fetch(CDEK_URL + (CDEK_URL.indexOf("?") >= 0 ? "&" : "?") + qs, { cache: "no-store" })
      .then(function (r) { return r.json(); });
  }

  var таймерПодсказок = null;
  function искатьГород(текст) {
    clearTimeout(таймерПодсказок);
    if (текст.length < 2) { $("city-suggest").hidden = true; return; }
    // Подсказки дёргаются на каждой букве, поэтому ждём паузу в наборе —
    // иначе на «Краснодар» ушло бы девять запросов вместо одного.
    таймерПодсказок = setTimeout(function () {
      cdek({ action: "suggest", q: текст }).then(function (d) {
        var список = (d && d.cities) || [];
        var ul = $("city-suggest");
        if (!список.length) { ul.hidden = true; return; }
        ul.innerHTML = список.map(function (c) {
          return '<li data-code="' + c.code + '">' + экранировать(c.name) + "</li>";
        }).join("");
        ul.hidden = false;
      }).catch(function () { $("city-suggest").hidden = true; });
    }, 350);
  }

  function выбратьГород(code, name) {
    состояние.город = { code: code, name: name };
    $("f-city").value = name;
    $("city-suggest").hidden = true;
    состояние.доставка = null;
    if (режим() === "pvz") загрузитьПункты();
    посчитатьДоставку();
  }

  function загрузитьПункты() {
    if (!состояние.город) return;
    var sel = $("f-point");
    sel.innerHTML = "<option value=''>— загружаем пункты… —</option>";
    cdek({ action: "points", city_code: состояние.город.code }).then(function (d) {
      состояние.пункты = (d && d.points) || [];
      if (!состояние.пункты.length) {
        sel.innerHTML = "<option value=''>— в этом городе нет пунктов, выберите курьера —</option>";
        return;
      }
      sel.innerHTML = состояние.пункты.map(function (p) {
        return '<option value="' + экранировать(p.code) + '">' + экранировать(p.address || p.code) + "</option>";
      }).join("");
    }).catch(function () {
      sel.innerHTML = "<option value=''>— не удалось загрузить пункты —</option>";
    });
  }

  function посчитатьДоставку() {
    var m = режим();
    if (m !== "pvz" && m !== "door") { $("delivery-result").textContent = ""; return; }
    if (!состояние.город) {
      $("delivery-result").textContent = "Выберите город — посчитаем доставку.";
      return;
    }
    var сумма = корзина().reduce(function (s, p) { return s + (Number(p.price) || 0); }, 0);
    $("delivery-result").textContent = "Считаем доставку…";
    cdek({
      action: "calc",
      to_code: состояние.город.code,
      mode: m,
      cost: сумма,
      insurance: $("f-insurance").checked ? 1 : 0,
    }).then(function (d) {
      var v = (d && d.variants) || [];
      if (!v.length) {
        состояние.доставка = null;
        $("delivery-result").textContent = "Не удалось посчитать доставку — оформим и уточним по телефону.";
        return;
      }
      состояние.доставка = v[0];
      $("delivery-result").textContent =
        "Доставка " + деньги(v[0].sum) + " · " + v[0].period_min + "–" + v[0].period_max +
        " дней. Оплачивается при получении.";
    }).catch(function () {
      состояние.доставка = null;
      $("delivery-result").textContent = "Доставку посчитаем при подтверждении заказа.";
    });
  }

  function режим() {
    var el = document.querySelector('input[name="mode"]:checked');
    return el ? el.value : "pvz";
  }

  function обновитьФормуПодРежим() {
    var m = режим();
    $("cdek-block").hidden = (m !== "pvz" && m !== "door");
    $("pvz-block").hidden = m !== "pvz";
    $("door-block").hidden = m !== "door";
    $("own-block").hidden = m !== "own";
    $("self-hint").hidden = m !== "self";
    if (m === "pvz" && состояние.город && !состояние.пункты.length) загрузитьПункты();
    посчитатьДоставку();
  }

  // --- отправка -----------------------------------------------------------
  function собратьДанные() {
    var m = режим();
    var phone = $("f-phone").value.trim();
    if (phone.replace(/\D/g, "").length < 10) {
      return { ошибка: "Укажите телефон — без него заказ не оформить." };
    }
    var delivery = { mode: m };
    if (m === "pvz" || m === "door") {
      if (!состояние.город) return { ошибка: "Выберите город доставки." };
      delivery.city_code = состояние.город.code;
      delivery.city_name = состояние.город.name;
      delivery.insurance = $("f-insurance").checked;
      if (состояние.доставка) {
        delivery.tariff_code = состояние.доставка.tariff_code;
        delivery.sum = состояние.доставка.sum;
      }
      if (m === "pvz") {
        var code = $("f-point").value;
        if (!code) return { ошибка: "Выберите пункт выдачи." };
        delivery.point_code = code;
        var p = состояние.пункты.filter(function (x) { return x.code === code; })[0];
        delivery.point_address = p ? p.address : "";
      } else {
        var addr = $("f-address").value.trim();
        if (addr.length < 5) return { ошибка: "Укажите адрес доставки." };
        delivery.address = addr;
      }
    } else if (m === "own") {
      delivery.comment = $("f-own").value.trim();
      if (!delivery.comment) return { ошибка: "Напишите, какой компанией и куда везти." };
    }
    return {
      данные: {
        recipient: { name: $("f-name").value.trim(), phone: phone },
        delivery: delivery,
      },
    };
  }

  function оплатить(способ) {
    if (состояние.занят) return;
    var res = собратьДанные();
    var err = $("checkout-error");
    if (res.ошибка) {
      err.textContent = res.ошибка;
      err.hidden = false;
      return;
    }
    err.hidden = true;
    if (!PAY_URL) { err.textContent = "Онлайн-оплата временно выключена."; err.hidden = false; return; }

    состояние.занят = true;
    fetch(PAY_URL + (PAY_URL.indexOf("?") >= 0 ? "&" : "?") + "action=checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(res.данные),
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d || !d.id) throw new Error(d && d.error ? d.error : "не сохранить заказ");
        var ids = корзина().map(function (p) { return p.id; }).filter(Boolean).join(",");
        location.assign(PAY_URL + (PAY_URL.indexOf("?") >= 0 ? "&" : "?") +
          "ids=" + encodeURIComponent(ids) +
          "&method=" + encodeURIComponent(способ) +
          "&checkout=" + encodeURIComponent(d.id));
      })
      .catch(function (e) {
        состояние.занят = false;
        err.textContent = "Не удалось оформить: " + e.message + ". Попробуйте ещё раз или позвоните нам.";
        err.hidden = false;
      });
  }

  // --- запуск -------------------------------------------------------------
  отрисоватьЗаказ();
  обновитьФормуПодРежим();

  $("f-city").addEventListener("input", function () { искатьГород(this.value.trim()); });
  $("city-suggest").addEventListener("click", function (e) {
    var li = e.target.closest("li[data-code]");
    if (li) выбратьГород(Number(li.dataset.code), li.textContent);
  });
  document.querySelectorAll('input[name="mode"]').forEach(function (r) {
    r.addEventListener("change", обновитьФормуПодРежим);
  });
  $("f-insurance").addEventListener("change", посчитатьДоставку);
  $("pay-sbp").addEventListener("click", function () { оплатить("sbp"); });
  $("pay-card").addEventListener("click", function () { оплатить("card"); });
})();
