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

  function money(n) {
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ") + " ₽";
  }

  function priceLabel(s) {
    if (s.цена != null) return money(s.цена);
    if (s.цена_от != null && s.цена_до != null) return `${money(s.цена_от)} – ${money(s.цена_до)}`;
    return "по результатам осмотра";
  }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  fetch("data/repair-extra.json", { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error("HTTP " + r.status))))
    .then((data) => {
      // ——— какую технику вообще берём ———
      const unpriced = (data.техника || []).filter((t) => !t.есть_прайс);
      if (familiesEl && unpriced.length) {
        familiesEl.innerHTML = unpriced
          .map((t) => `<span class="rx-chip">${esc(t.название)}</span>`)
          .join("");
      }

      // ——— цены, которые уже известны ———
      if (pricesEl && (data.услуги || []).length) {
        pricesEl.innerHTML = data.услуги
          .map((s) => {
            const notes = [s.включено ? `включено: ${s.включено}` : "", s.примечание]
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
          .map((k) => `<div class="rx-water-block">${esc(byKey[k]).replace(/\n/g, "<br>")}</div>`)
          .join("");
      }

      if (data.апгрейд_arm) {
        const note = document.createElement("p");
        note.className = "rx-arm-note";
        note.textContent = "Апгрейд Mac на Apple Silicon: " + data.апгрейд_arm;
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
