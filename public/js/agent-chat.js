/**
 * Окно помощника IRON SERVICE (план 123). Подключение — одной строкой, стили окно подтянет само:
 *   <script src="js/agent-chat.js?v=…" defer></script>
 * data-api / data-sitekey у тега переопределяют адрес воркера и ключ Turnstile (по умолчанию — боевые).
 *
 * С 28.10.2026 окно на всём русском сайте (этап 6): главные страницы и статьи — тегом, карточки товаров — через
 * hybrid-cart.js (их 27 тыс., как и telegram-miniapp.js). Странице нужен CSP с воркером в connect-src и
 * challenges.cloudflare.com в script-src/frame-src, иначе окно откроется, но не достучится до помощника.
 * В мини-приложении Telegram окно спрятано стилем (html.tg-miniapp): там человек и так в боте, а кнопка
 * закрывала бы полосу корзины.
 *
 * Без сборки и библиотек, как весь сайт. Ответы рисуются только текстом (textContent), ссылки — кнопками и только
 * на свои адреса: даже если сервер или модель вернут что-то не то, разметка и чужая ссылка на страницу не попадут.
 * Turnstile грузится при первом открытии окна, а не со страницей — посетителям, которые чат не открывают, он не мешает.
 */
(() => {
  const script = document.currentScript;
  const API = (script && script.dataset.api) || "https://iron-site-agent.4489530.workers.dev";
  const SITEKEY = (script && script.dataset.sitekey) || "0x4AAAAAAFmWn9pHdjQRBOU9";
  if (document.getElementById("iac-launcher")) return;

  // Стили: если страница не подключила agent-chat.css сама — берём из той же папки сайта и той же версии, что скрипт.
  // Кнопку показываем после загрузки стилей, иначе на миг мелькнёт голая кнопка внизу страницы.
  let cssReady = null;
  if (script && script.src && !document.querySelector('link[href*="agent-chat.css"]')) {
    const css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = script.src.replace(/js\/agent-chat\.js/, "css/agent-chat.css");
    cssReady = new Promise((resolve) => { css.onload = css.onerror = resolve; });
    document.head.append(css);
  }

  const LANG = (document.documentElement.lang || "ru").startsWith("en") ? "en" : "ru";
  const T = {
    ru: {
      launcher: "Спросить мастера",
      title: "Помощник IRON SERVICE",
      close: "Закрыть",
      wide: "Развернуть окно",
      zoom: "Нажмите, чтобы увеличить",
      placeholder: "Модель и что случилось…",
      send: "Отправить",
      checking: "Проверяем, что вы не робот…",
      typing: "печатает…",
      failed: "Не получилось связаться с помощником. Напишите мастеру напрямую:",
      restart: "Начнём заново — прошлый разговор закрыт.",
      attach: "Прислать фото или видео поломки",
      looking: "смотрю фото…",
      badFile: "Не получилось открыть файл. Пришлите фото (JPG, PNG) или видео до 2 минут.",
      mic: "Сказать голосом",
      micStop: "Остановить и отправить",
      listening: "Говорите… нажмите ■, когда закончите",
      hearing: "расшифровываю…",
      noMic: "Нет доступа к микрофону. Разрешите его в настройках браузера или напишите текстом.",
      tooShort: "Запись слишком короткая — нажмите 🎤 и говорите.",
    },
    en: {
      launcher: "Ask a technician",
      title: "IRON SERVICE assistant",
      close: "Close",
      wide: "Expand chat",
      zoom: "Tap to enlarge",
      placeholder: "Device and what happened…",
      send: "Send",
      checking: "Checking that you are not a robot…",
      typing: "typing…",
      failed: "Couldn't reach the assistant. Message us directly:",
      restart: "Starting over — the previous chat has ended.",
      attach: "Send a photo or video of the problem",
      looking: "looking at the photo…",
      badFile: "Couldn't open the file. Send a photo (JPG, PNG) or a video up to 2 minutes.",
      mic: "Speak",
      micStop: "Stop and send",
      listening: "Listening… tap ■ when done",
      hearing: "transcribing…",
      noMic: "No microphone access. Allow it in the browser settings or type your message.",
      tooShort: "The recording is too short — tap 🎤 and speak.",
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
  // Развернуть окно (владелец 26.10.2026: «очень мелко, не видно»): шире и выше; на телефоне окно и так во весь экран.
  const wideBtn = el("button", "iac-wide", "⤢");
  wideBtn.type = "button";
  wideBtn.setAttribute("aria-label", T.wide);
  wideBtn.setAttribute("aria-pressed", "false");
  const headBtns = el("div", "iac-head-btns");
  headBtns.append(wideBtn, closeBtn);
  head.append(el("strong", "iac-title", T.title), headBtns);
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
  // Фото и видео поломки (этап 3, 26.10.2026): кадры ужимает браузер, видео на сервер не уходит — только 6 кадров.
  const attachBtn = el("button", "iac-attach", "📎");
  attachBtn.type = "button";
  attachBtn.setAttribute("aria-label", T.attach);
  attachBtn.title = T.attach;
  const fileInput = el("input");
  fileInput.type = "file";
  fileInput.accept = "image/*,video/*";
  fileInput.hidden = true;
  // Голос (план 123 §14, 26.10.2026: владелец — «чтобы принимал голосовой ввод»): запись в браузере, расшифровка —
  // whisper на Маке, как голосовые в личке. Нет записи звука в браузере — кнопки нет.
  const canRecord = Boolean(window.MediaRecorder && navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  const micBtn = el("button", "iac-attach iac-mic", "🎤");
  micBtn.type = "button";
  micBtn.setAttribute("aria-label", T.mic);
  micBtn.title = T.mic;
  micBtn.hidden = !canRecord;
  form.append(attachBtn, fileInput, micBtn, input, sendBtn);
  panel.append(head, log, tsBox, form);
  if (cssReady) {
    launcher.hidden = true;
    cssReady.then(() => { launcher.hidden = false; });
  }
  document.body.append(launcher, panel);

  let token = store.get();
  let started = false;
  let busy = false;
  let widgetId = null;
  let tsResolve = null;

  function scrollDown() { log.scrollTop = log.scrollHeight; }

  // Картинки — только свои схемы помощника (сервер проверяет так же, guard.js cleanImage).
  const SAFE_IMAGE = /^\/assets\/agent\/[\w-]{1,60}\.(?:svg|png|jpg|webp)(?:\?v=\d{1,6})?$/; // ?v= — против кэша

  function addMessage(role, text, buttons, image) {
    const box = el("div", `iac-msg iac-${role === "user" ? "user" : "agent"}`);
    box.append(el("p", "iac-text", String(text || "")));
    if (image && SAFE_IMAGE.test(String(image.src || ""))) {
      const img = el("img", "iac-image");
      img.src = image.src;
      img.alt = String(image.alt || "");
      img.loading = "lazy";
      img.addEventListener("load", scrollDown);
      img.title = T.zoom;
      img.tabIndex = 0;
      img.addEventListener("click", () => zoomImage(image));
      img.addEventListener("keydown", (e) => { if (e.key === "Enter") zoomImage(image); });
      box.classList.add("iac-has-image");
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

  /** Картинка на весь экран: нажать — увеличить, нажать ещё раз или Esc — закрыть. */
  function zoomImage(image) {
    const layer = el("div", "iac-zoom");
    layer.setAttribute("role", "dialog");
    layer.setAttribute("aria-label", String(image.alt || ""));
    const big = el("img", "iac-zoom-img");
    big.src = image.src;
    big.alt = String(image.alt || "");
    layer.append(big);
    const shut = () => { layer.remove(); document.removeEventListener("keydown", onKey, true); };
    const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); shut(); } };
    layer.addEventListener("click", shut);
    document.addEventListener("keydown", onKey, true);
    document.body.append(layer);
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
      tsBox.hidden = false;
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
        // Turnstile после успеха ещё дорисовывает «Успешно» и может вернуть окошко — убираем с задержкой и прячем блок.
        callback: (t) => { done(t); hideTurnstile(); setTimeout(hideTurnstile, 800); },
        "error-callback": (code) => { tsError = String(code || "error"); done(null); return true; },
        "expired-callback": () => {},
      });
    });
  }

  function hideTurnstile() {
    try { if (widgetId !== null) window.turnstile.remove(widgetId); } catch { /* уже нет */ }
    widgetId = null;
    tsBox.replaceChildren();
    tsBox.hidden = true;
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

  /** Картинка → JPEG не больше max px по длинной стороне. */
  function toJpeg(source, w, h, max, quality) {
    const k = Math.min(1, max / Math.max(w, h));
    const c = document.createElement("canvas");
    c.width = Math.round(w * k);
    c.height = Math.round(h * k);
    c.getContext("2d").drawImage(source, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", quality);
  }

  function loadImage(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = url;
    });
  }

  /** 6 кадров видео по всей длине — модели этого хватает понять, что происходит (мерцает, перезагружается…). */
  async function videoFrames(url) {
    const v = document.createElement("video");
    v.muted = true;
    v.playsInline = true;
    v.preload = "auto";
    v.src = url;
    await new Promise((resolve, reject) => { v.onloadedmetadata = resolve; v.onerror = reject; });
    if (!v.duration || v.duration > 125) throw new Error("long");
    const frames = [];
    for (const part of [0.08, 0.25, 0.42, 0.58, 0.75, 0.92]) {
      v.currentTime = v.duration * part;
      await new Promise((resolve) => { v.onseeked = resolve; });
      frames.push(toJpeg(v, v.videoWidth, v.videoHeight, 960, 0.8));
    }
    return frames;
  }

  function addPreview(url, isVideo) {
    const box = el("div", "iac-msg iac-user iac-has-image");
    const img = el("img", "iac-image iac-preview");
    img.src = url;
    img.alt = isVideo ? "видео" : "фото";
    box.append(img);
    log.append(box);
    scrollDown();
  }

  async function sendMedia(file) {
    if (!file || busy) return;
    const isVideo = file.type.startsWith("video/");
    const url = URL.createObjectURL(file);
    let images;
    try {
      if (isVideo) {
        images = await videoFrames(url);
        addPreview(images[2], true);
      } else {
        const img = await loadImage(url);
        images = [toJpeg(img, img.naturalWidth, img.naturalHeight, 1280, 0.85)];
        addPreview(images[0], false);
      }
    } catch {
      addMessage("agent", T.badFile);
      return;
    } finally {
      URL.revokeObjectURL(url);
    }
    busy = true;
    sendBtn.disabled = true;
    attachBtn.disabled = true;
    try {
      if (!token && !(await startNew())) return;
      const caption = input.value.trim().slice(0, 1000);
      input.value = "";
      autosize();
      const typing = addMessage("agent", T.looking);
      typing.classList.add("iac-typing");
      const payload = { kind: isVideo ? "video" : "photo", images, text: caption };
      let res = await api("/chat/media", "POST", payload);
      if (res.status === 401 || res.status === 410) {
        token = null;
        store.del();
        if (await startNew()) res = await api("/chat/media", "POST", payload);
      }
      typing.remove();
      const reply = res.data.reply || { text: T.failed, buttons: FALLBACK };
      addMessage("agent", reply.text, reply.buttons, reply.image);
    } finally {
      busy = false;
      sendBtn.disabled = false;
      attachBtn.disabled = false;
    }
  }

  // ---- Голос ----
  const VOICE_MAX_MS = 60000;
  const VOICE_TYPES = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4", "audio/webm"];
  let rec = null;

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
  }

  async function startVoice() {
    if (busy || rec) return;
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch {
      addMessage("agent", T.noMic);
      return;
    }
    const mimeType = VOICE_TYPES.find((t) => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) || "";
    const recorder = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: 32000 });
    const chunks = [];
    const started = Date.now();
    rec = { recorder, stream, started, timer: setTimeout(() => stopVoice(), VOICE_MAX_MS) };
    recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    recorder.onstop = () => {
      stream.getTracks().forEach((t) => t.stop()); // микрофон отпускаем сразу — значок записи в браузере гаснет
      const ms = Date.now() - started;
      const blob = new Blob(chunks, { type: recorder.mimeType || mimeType || "audio/webm" });
      if (ms < 800 || blob.size < 1500) {
        addMessage("agent", T.tooShort);
        return;
      }
      sendVoice(blob);
    };
    recorder.start();
    micBtn.textContent = "■";
    micBtn.classList.add("iac-rec");
    micBtn.setAttribute("aria-label", T.micStop);
    micBtn.title = T.micStop;
    input.placeholder = T.listening;
    attachBtn.disabled = true;
    sendBtn.disabled = true;
  }

  function stopVoice() {
    if (!rec) return;
    clearTimeout(rec.timer);
    const { recorder } = rec;
    rec = null;
    micBtn.textContent = "🎤";
    micBtn.classList.remove("iac-rec");
    micBtn.setAttribute("aria-label", T.mic);
    micBtn.title = T.mic;
    input.placeholder = T.placeholder;
    attachBtn.disabled = false;
    sendBtn.disabled = false;
    if (recorder.state !== "inactive") recorder.stop();
  }

  async function sendVoice(blob) {
    if (busy) return;
    busy = true;
    sendBtn.disabled = true;
    attachBtn.disabled = true;
    micBtn.disabled = true;
    try {
      if (!token && !(await startNew())) return;
      const mine = addMessage("user", "🎤 …");
      const typing = addMessage("agent", T.hearing);
      typing.classList.add("iac-typing");
      const payload = { audio: await blobToDataUrl(blob), mime: blob.type };
      let res = await api("/chat/voice", "POST", payload);
      if (res.status === 401 || res.status === 410) {
        token = null;
        store.del();
        if (await startNew()) res = await api("/chat/voice", "POST", payload);
      }
      typing.remove();
      const said = String(res.data.transcript || "").trim();
      mine.querySelector(".iac-text").textContent = said ? `🎤 ${said}` : "🎤";
      const reply = res.data.reply || { text: T.failed, buttons: FALLBACK };
      addMessage("agent", reply.text, reply.buttons, reply.image);
    } finally {
      busy = false;
      sendBtn.disabled = false;
      attachBtn.disabled = false;
      micBtn.disabled = false;
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
    stopVoice();
    panel.hidden = true;
    launcher.setAttribute("aria-expanded", "false");
    document.documentElement.classList.remove("iac-open");
    launcher.focus();
  }

  launcher.addEventListener("click", () => (panel.hidden ? open() : close()));
  wideBtn.addEventListener("click", () => {
    const on = panel.classList.toggle("iac-panel-wide");
    wideBtn.setAttribute("aria-pressed", on ? "true" : "false");
    scrollDown();
  });
  closeBtn.addEventListener("click", close);
  panel.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
  form.addEventListener("submit", (e) => { e.preventDefault(); send(input.value); });
  attachBtn.addEventListener("click", () => fileInput.click());
  micBtn.addEventListener("click", () => (rec ? stopVoice() : startVoice()));
  fileInput.addEventListener("change", () => { const f = fileInput.files && fileInput.files[0]; fileInput.value = ""; sendMedia(f); });
  input.addEventListener("input", autosize);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(input.value); }
  });
})();
