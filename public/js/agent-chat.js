/**
 * Окно помощника IRON SERVICE (план 123). Подключение:
 *   <script src="js/agent-chat.js" data-api="https://iron-site-agent.4489530.workers.dev" data-sitekey="…" defer></script>
 *
 * Без сборки и библиотек, как весь сайт. Ответы рисуются только текстом (textContent), ссылки — кнопками и только
 * на свои адреса: даже если сервер или модель вернут что-то не то, разметка и чужая ссылка на страницу не попадут.
 * Turnstile грузится при первом открытии окна, а не со страницей — посетителям, которые чат не открывают, он не мешает.
 */
(() => {
  const script = document.currentScript;
  const API = script && script.dataset.api;
  const SITEKEY = script && script.dataset.sitekey;
  if (!API || !SITEKEY || document.getElementById("iac-launcher")) return;

  const LANG = (document.documentElement.lang || "ru").startsWith("en") ? "en" : "ru";
  const T = {
    ru: {
      launcher: "Спросить мастера",
      title: "Помощник IRON SERVICE",
      close: "Закрыть",
      placeholder: "Модель и что случилось…",
      send: "Отправить",
      checking: "Проверяем, что вы не робот…",
      typing: "печатает…",
      failed: "Не получилось связаться с помощником. Напишите мастеру напрямую:",
      restart: "Начнём заново — прошлый разговор закрыт.",
    },
    en: {
      launcher: "Ask a technician",
      title: "IRON SERVICE assistant",
      close: "Close",
      placeholder: "Device and what happened…",
      send: "Send",
      checking: "Checking that you are not a robot…",
      typing: "typing…",
      failed: "Couldn't reach the assistant. Message us directly:",
      restart: "Starting over — the previous chat has ended.",
    },
  }[LANG];

  const SAFE_LINK = /^(?:https:\/\/(?:www\.)?1iron\.ru(?:\/|$)|https:\/\/t\.me\/IRON_SERVICE_ORDER_bot(?:\?|$)|https:\/\/wa\.me\/79288509404(?:\?|$)|tel:\+79288509404$)/;
  const FALLBACK = [
    { type: "link", text: "Telegram", url: "https://t.me/IRON_SERVICE_ORDER_bot" },
    { type: "link", text: "WhatsApp", url: "https://wa.me/79288509404" },
    { type: "link", text: "+7 928 850-94-04", url: "tel:+79288509404" },
  ];
  const KEY = "ironAgentToken";
  const store = {
    get() { try { return localStorage.getItem(KEY); } catch { return null; } },
    set(v) { try { localStorage.setItem(KEY, v); } catch { /* приватный режим — живём без памяти */ } },
    del() { try { localStorage.removeItem(KEY); } catch { /* то же */ } },
  };

  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  const launcher = el("button", "iac-launcher");
  launcher.id = "iac-launcher";
  launcher.type = "button";
  launcher.setAttribute("aria-expanded", "false");
  launcher.setAttribute("aria-controls", "iac-panel");
  launcher.append(el("span", "iac-launcher-icon", "💬"), el("span", "iac-launcher-text", T.launcher));

  const panel = el("section", "iac-panel");
  panel.id = "iac-panel";
  panel.hidden = true;
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", T.title);
  const head = el("header", "iac-head");
  const closeBtn = el("button", "iac-close", "×");
  closeBtn.type = "button";
  closeBtn.setAttribute("aria-label", T.close);
  head.append(el("strong", "iac-title", T.title), closeBtn);
  const log = el("div", "iac-log");
  log.setAttribute("aria-live", "polite");
  const tsBox = el("div", "iac-turnstile");
  const form = el("form", "iac-form");
  const input = el("textarea", "iac-input");
  input.rows = 1;
  input.maxLength = 1000;
  input.placeholder = T.placeholder;
  input.setAttribute("aria-label", T.placeholder);
  const sendBtn = el("button", "iac-send", "➤");
  sendBtn.type = "submit";
  sendBtn.setAttribute("aria-label", T.send);
  form.append(input, sendBtn);
  panel.append(head, log, tsBox, form);
  document.body.append(launcher, panel);

  let token = store.get();
  let started = false;
  let busy = false;
  let widgetId = null;
  let tsResolve = null;

  function scrollDown() { log.scrollTop = log.scrollHeight; }

  // Картинки — только свои схемы помощника (сервер проверяет так же, guard.js cleanImage).
  const SAFE_IMAGE = /^\/assets\/agent\/[\w-]{1,60}\.(?:svg|png|jpg|webp)$/;

  function addMessage(role, text, buttons, image) {
    const box = el("div", `iac-msg iac-${role === "user" ? "user" : "agent"}`);
    box.append(el("p", "iac-text", String(text || "")));
    if (image && SAFE_IMAGE.test(String(image.src || ""))) {
      const img = el("img", "iac-image");
      img.src = image.src;
      img.alt = String(image.alt || "");
      img.loading = "lazy";
      img.addEventListener("load", scrollDown);
      box.append(img);
    }
    const btns = (buttons || []).filter((b) => b && b.text);
    if (btns.length) {
      const row = el("div", "iac-buttons");
      for (const b of btns.slice(0, 8)) {
        if (b.type === "reply") {
          const x = el("button", "iac-chip", b.text);
          x.type = "button";
          x.addEventListener("click", () => send(b.send || b.text));
          row.append(x);
        } else if (b.type === "link" && SAFE_LINK.test(String(b.url || ""))) {
          const a = el("a", "iac-chip iac-link", b.text);
          a.href = b.url;
          if (!b.url.startsWith("tel:")) { a.target = "_blank"; a.rel = "noopener noreferrer"; }
          row.append(a);
        }
      }
      if (row.childNodes.length) box.append(row);
    }
    log.append(box);
    scrollDown();
    return box;
  }

  async function api(path, method, body) {
    const headers = { "Content-Type": "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;
    try {
      const r = await fetch(API + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
      let data = {};
      try { data = await r.json(); } catch { /* пустой ответ */ }
      return { status: r.status, data };
    } catch {
      return { status: 0, data: {} };
    }
  }

  function loadTurnstile() {
    if (window.turnstile) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error("turnstile"));
      document.head.append(s);
    });
  }

  let tsError = null;

  /** Одноразовый пропуск Turnstile. Обычно проверка проходит незаметно; окошко появляется, только если нужно.
   *  Не пустил (ошибка, скрипт не загрузился, молчит 45 с) — null, и дальше запасной вход задачкой. */
  async function turnstileToken() {
    try { await loadTurnstile(); } catch { tsError = "script"; return null; }
    return new Promise((resolve) => {
      const done = (v) => { if (tsResolve) { tsResolve(v); tsResolve = null; } };
      tsResolve = resolve;
      setTimeout(() => { if (tsResolve === resolve) { tsError = tsError || "timeout"; done(null); } }, 45000);
      if (widgetId !== null) {
        window.turnstile.reset(widgetId);
        return;
      }
      widgetId = window.turnstile.render(tsBox, {
        sitekey: SITEKEY,
        appearance: "interaction-only",
        language: LANG,
        retry: "never",
        // Пройдено — окошко убираем: оно висело в окне чата и после проверки (владелец 26.10.2026).
        callback: (t) => { done(t); hideTurnstile(); },
        "error-callback": (code) => { tsError = String(code || "error"); done(null); return true; },
        "expired-callback": () => {},
      });
    });
  }

  function hideTurnstile() {
    try { if (widgetId !== null) window.turnstile.remove(widgetId); } catch { /* уже нет */ }
    widgetId = null;
    tsBox.replaceChildren();
  }

  /** Запасной вход (26.10.2026): Turnstile ругается на VPN и некоторые браузеры (600010 — «похоже на бота»), а живой
   *  человек не должен упираться в стену. Сервер даёт задачку, браузер ищет nonce: SHA-256(salt + nonce) с нужным
   *  числом нулевых бит в начале — 1–3 секунды. Такому диалогу сервер ставит пределы строже. */
  async function solvePow() {
    const { status, data } = await api("/chat/challenge", "GET");
    if (status !== 200 || !data.salt) return null;
    const enc = new TextEncoder();
    const zeroBits = (b) => { let n = 0; for (const x of b) { if (x === 0) { n += 8; continue; } return n + Math.clz32(x) - 24; } return n; };
    for (let i = 0; i < 5000000; i++) {
      const nonce = i.toString(36);
      const h = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(data.salt + nonce)));
      if (zeroBits(h) >= data.bits) return { ...data, nonce };
    }
    return null;
  }

  async function startNew() {
    const wait = addMessage("agent", T.checking);
    let ts = null;
    try { ts = await turnstileToken(); } catch { ts = null; }
    let pow = null;
    if (!ts) {
      hideTurnstile(); // окошко «сбой проверки» больше не нужно
      try { pow = await solvePow(); } catch { pow = null; }
    }
    wait.remove();
    if (!ts && !pow) { addMessage("agent", T.failed, FALLBACK); return false; }
    const { status, data } = await api("/chat/start", "POST", ts
      ? { turnstile: ts, lang: LANG, page: location.pathname }
      : { pow, turnstileError: tsError, lang: LANG, page: location.pathname });
    if (status !== 200 || !data.token) {
      const reply = data.reply || { text: T.failed, buttons: FALLBACK };
      addMessage("agent", reply.text, reply.buttons);
      return false;
    }
    token = data.token;
    store.set(token);
    addMessage("agent", data.reply.text, data.reply.buttons);
    return true;
  }

  async function resume() {
    if (token) {
      const { status, data } = await api("/chat/history", "GET");
      if (status === 200 && Array.isArray(data.messages)) {
        for (const m of data.messages) addMessage(m.role, m.text, m.buttons, m.image);
        return;
      }
      token = null;
      store.del();
    }
    await startNew();
  }

  async function send(raw) {
    const text = String(raw || "").trim().slice(0, 1000);
    if (!text || busy) return;
    busy = true;
    sendBtn.disabled = true;
    try {
      if (!token && !(await startNew())) return;
      addMessage("user", text);
      input.value = "";
      autosize();
      const typing = addMessage("agent", T.typing);
      typing.classList.add("iac-typing");
      let res = await api("/chat/message", "POST", { text });
      if (res.status === 401 || res.status === 410) {
        token = null;
        store.del();
        typing.remove();
        addMessage("agent", T.restart);
        if (!(await startNew())) return;
        res = await api("/chat/message", "POST", { text });
      } else {
        typing.remove();
      }
      const reply = res.data.reply || { text: T.failed, buttons: FALLBACK };
      addMessage("agent", reply.text, reply.buttons, reply.image);
    } finally {
      busy = false;
      sendBtn.disabled = false;
      input.focus();
    }
  }

  function autosize() {
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 120)}px`;
  }

  async function open() {
    panel.hidden = false;
    launcher.setAttribute("aria-expanded", "true");
    document.documentElement.classList.add("iac-open");
    input.focus();
    if (!started) {
      started = true;
      await resume();
    }
  }

  function close() {
    panel.hidden = true;
    launcher.setAttribute("aria-expanded", "false");
    document.documentElement.classList.remove("iac-open");
    launcher.focus();
  }

  launcher.addEventListener("click", () => (panel.hidden ? open() : close()));
  closeBtn.addEventListener("click", close);
  panel.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
  form.addEventListener("submit", (e) => { e.preventDefault(); send(input.value); });
  input.addEventListener("input", autosize);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(input.value); }
  });
})();
