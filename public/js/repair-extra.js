/**
 * Техника вне основного прайса + первая помощь при залитии.
 *
 * Данные берутся из data/repair-extra.json, который ГЕНЕРИРУЕТСЯ из базы
 * знаний бота (scripts/build_repair_extra.mjs). Смысл в том, чтобы сайт и бот
 * говорили клиенту одно и то же: цены на iMac и Apple Watch владелец называл
 * голосом, и разъехавшиеся цифры в двух местах — это его разговор с клиентом,
 * а не наша строчка кода.
 *
 * Отдельный файл, а не правка repair-search.js: тот отвечает за подбор по
 * основному прайсу и активно меняется. Здесь дополнение, которое ничего в нём
 * не трогает.
 */
(function () {
  const root = document.getElementById("repair-extra");
  if (!root) return;

  const familiesEl = document.getElementById("rx-families");
  const pricesEl = document.getElementById("rx-prices");
  const waterEl = document.querySelector("#rx-water .rx-water-body");

  // Заполняется после загрузки словаря; до этого используется русский текст.
  let NO_PRICE = "по результатам осмотра";

  function money(n) {
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ") + " ₽";
  }

  function priceLabel(s) {
    if (s.цена != null) return money(s.цена);
    if (s.цена_от != null && s.цена_до != null) return `${money(s.цена_от)} – ${money(s.цена_до)}`;
    return NO_PRICE;
  }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  // Путь от корня: на /en/services.html относительный превратился бы в
  // /en/data/repair-extra.json (18.08.2026, та же ошибка, что уже ловили трижды).
  const EN = (document.documentElement.lang || "ru").slice(0, 2) === "en";
  const версия = (u) => (window.IRON_I18N ? window.IRON_I18N.url(u) : u);

  /** Английские тексты этого раздела: данные генерируются из базы бота и
   *  правкам не подлежат, поэтому перевод лежит в словаре и подставляется по
   *  ключу блока. Нет перевода — показываем русский, а не пустоту. */
  function словарь() {
    if (!EN || !window.IRON_I18N) return Promise.resolve(null);
    return fetch(версия("/data/i18n/services.en.json"))
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => (d && d.repair_extra) || null)
      .catch(() => null);
  }

  Promise.all([
    fetch(версия("/data/repair-extra.json"), { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("HTTP " + r.status)))),
    словарь(),
  ])
    .then(([data, dict]) => {
      const п = (путь, запасной) => {
        if (!dict) return запасной;
        const части = String(путь).split(".");
        let узел = dict;
        for (const ч of части) {
          if (!узел || typeof узел !== "object") return запасной;
          узел = узел[ч];
        }
        return typeof узел === "string" ? узел : запасной;
      };
      NO_PRICE = п("no_price", NO_PRICE);

      // ——— какую технику вообще берём ———
      const unpriced = (data.техника || []).filter((t) => !t.есть_прайс);
      if (familiesEl && unpriced.length) {
        familiesEl.innerHTML = unpriced
          .map((t) => `<span class="rx-chip">${esc(п("devices." + t.название, t.название))}</span>`)
          .join("");
      }

      // ——— цены, которые уже известны ———
      if (pricesEl && (data.услуги || []).length) {
        pricesEl.innerHTML = data.услуги
          .map((s) => {
            const notes = [s.включено ? `${п("included", "включено")}: ${s.включено}` : "", s.примечание]
              .filter(Boolean).join("; ");
            return (
              `<div class="rx-price">` +
              `<div class="rx-price__head">` +
              `<span class="rx-price__device">${esc(s.устройство)}</span>` +
              `<span class="rx-price__sum">${esc(priceLabel(s))}</span>` +
              `</div>` +
              `<div class="rx-price__work">${esc(s.работа)}</div>` +
              (notes ? `<div class="rx-price__note">${esc(notes)}</div>` : "") +
              `</div>`
            );
          })
          .join("");
      }

      // ——— залитие ———
      //
      // Порядок блоков задаётся здесь, а не в JSON: на сайте человек читает
      // сверху вниз и без диалога, поэтому сначала «что сделать руками», а
      // «почему нет цены» — после. В боте порядок другой, там это ответ на
      // вопрос про стоимость.
      if (waterEl && data.залитие) {
        const order = ["общее", "ноутбук", "срочность", "не_включается",
                       "недорогой_исход", "почему_нет_цены", "скрытые_дефекты"];
        const byKey = {};
        (data.залитие.блоки || []).forEach((b) => { byKey[b.ключ] = b.текст; });
        waterEl.innerHTML = order
          .filter((k) => byKey[k])
          .map((k) => `<div class="rx-water-block">${esc(п("water." + k, byKey[k])).replace(/\n/g, "<br>")}</div>`)
          .join("");
      }

      if (data.апгрейд_arm) {
        const note = document.createElement("p");
        note.className = "rx-arm-note";
        note.textContent = п("arm_note", "Апгрейд Mac на Apple Silicon:") + " " +
          п("arm_text", data.апгрейд_arm);
        root.querySelector(".container").appendChild(note);
      }
    })
    .catch((e) => {
      // Блок дополнительный: если данные не приехали, страница услуг должна
      // работать как раньше, а не показывать пустые заголовки.
      console.warn("repair-extra: не загрузилось", e);
      root.hidden = true;
    });
})();
