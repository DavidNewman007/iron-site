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
