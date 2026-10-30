// Главная — гибрид A+B (план 118): видео-фон мастерской, герой за курсором, проявление блоков, «АКБ iPhone от …».
// Общий для index.html и en/index.html (вынесен из страницы 29.10.2026, чтобы английская главная не держала копию).
// Пути — от data-root на .home-hero__media: "" на русской, "../" на английской.
(function () {
  var media0 = document.querySelector(".home-hero__media"), ROOT = (media0 && media0.getAttribute("data-root")) || "";
  var EN = document.documentElement.lang === "en";
  // Видео-фон: если браузер не запустил автовоспроизведение (энергосбережение, Safari) — пробуем при первом
  // касании или прокрутке.
  var v = document.getElementById("home-video");
  if (v) {
    v.muted = true; v.defaultMuted = true;
    var go = function () { var p = v.play(); if (p && p.catch) p.catch(function () {}); };
    go(); v.addEventListener("loadeddata", go);
    ["pointerdown", "touchstart", "scroll", "keydown"].forEach(function (e) { window.addEventListener(e, go, { once: true, passive: true }); });
  }
  // Сцена проявляется, когда раскодированы и фон (постер видео), и неподвижный герой: иначе первым кадром была
  // мастерская без героя, и герой «выпрыгивал» через долю секунды. Запасной срок — 2,5 с. Класс is-wait ставит
  // строчка сразу после блока сцены (до первой отрисовки).
  (function () {
    var media = media0, still = media && media.querySelector(".home-hero__still");
    if (!media) return;
    var shown = false, show = function () { if (!shown) { shown = true; media.classList.remove("is-wait"); media.dispatchEvent(new Event("hero:shown")); } };
    var dec = function (src, img) { img = img || new Image(); if (!img.src) img.src = src; return img.decode ? img.decode().catch(function () {}) : Promise.resolve(); };
    Promise.all([dec(ROOT + "assets/home/hero-poster.webp"), still ? dec(null, still) : null]).then(show);
    setTimeout(show, 2500);
  })();
  // Герой за курсором: N кадров поворота слева направо (hero-body.webp) и уровни взгляда вверх → прямо → вниз.
  // Геометрия кадра 1280×704 переводится в экран по правилам object-fit: cover того же <video>, поэтому герой стоит ровно
  // там, где на кадре. Свечение знака и глаз — по координатам каждого кадра из hero-grid.json, пульсирует.
  // Изменено 30.10.2026 (атлас v4): тело у всех уровней взгляда ОДНО — кадр ряда «прямо», а уровень меняет только
  // голову (hero-head-*.webp: полоса над шеей высотой M.hh, лицо того же кадра сдвинуто на M.pitch px, шея стоит).
  // Раньше ряды «вверх»/«вниз» были отдельными роликами: корпус в них стоял иначе (знак сдвинут до 16 px), и при
  // смене ряда тело прыгало — владелец 29.10: «сделать нормально с вертикалью без обрывов и дёрганий».
  // Переделано 29.10.2026 по замечаниям владельца («двигается сильно быстро, много движения корпусом; когда стоит —
  // резкость мутнеет, будто двоится; срывы и дёргания»):
  //  — взгляд ведёт пружина по времени с пределом скорости. Раньше за кадр проходилась доля 0,08 оставшегося пути: при
  //    резком движении мыши — 8 кадров атласа за один кадр экрана (это и были «срывы»), а на экране 120 Гц вдвое быстрее;
  //  — размах — половина пути поворота (AMP): поворачиваются голова и плечи, корпус почти на месте;
  //  — в покое рисуется один целый кадр. Смесь двух соседних (сдвиг 2–3 px) вдвое снижала резкость, а покачивание без
  //    мыши шло синусом по кадрам, и смесь не кончалась никогда. Теперь без мыши — редкий короткий взгляд в сторону и
  //    «дыхание»: плечи чуть поднимаются (масштаб от линии кистей), кадр при этом один и резкий;
  //  — ряды выровнены по среднему (atlas-v2: кадр той же позы, совмещены масштаб и положение корпуса, подогнан свет),
  //    крайние ряды убраны, смена ряда — 280 мс с плавным входом и запасом 0,7.
  (function () {
    var cv = document.getElementById("home-head"), video = document.getElementById("home-video"), media = cv && cv.parentNode;
    if (!cv || !video || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    var FW = 1280, FH = 704, HEAD_X = 705, REF_Y = 300, HANDS_Y = 600, fine = matchMedia("(hover: hover) and (pointer: fine)").matches;
    var AMP = .5, BREATH = .0035, BREATH_T = 5200, FADE = 220, HYST = .7, AV = "2026-10-30a";   // AV — версия атласов: кэш браузера и Pages
    var M = null, body = null, heads = [], LV = [];   // LV — сдвиги лица уровней в работе; heads[k] = null у «прямо» (голова из body)
    var geo = null, H = { x: 0, v: 0 }, V = { x: 0, v: 0 }, th = 0, tv = 0, lastMove = 0, ready = false, last = 0;
    var D = null, detent = null, moving = 0, nextGlance = 0, t0 = 0;
    var DBG = /[?&]herodebug=1/.test(location.search) ? (window.__hero = []) : null;   // замеры плавности (tools/hero-motion.mjs)
    function layout() {
      var r = video.getBoundingClientRect(), m = cv.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, 2);
      // Размер холста — только если изменился: присваивание width стирает холст и заново выделяет память, а
      // layout зовётся на каждое событие прокрутки (до 29.10.2026 так и было).
      var W = Math.round(m.width * dpr), Hh = Math.round(m.height * dpr);
      if (cv.width !== W) cv.width = W;
      if (cv.height !== Hh) cv.height = Hh;
      var s = Math.max(r.width / FW, r.height / FH), pos = getComputedStyle(video).objectPosition.split(" ").map(parseFloat);
      var ox = (r.width - FW * s) * (isNaN(pos[0]) ? .5 : pos[0] / 100), oy = (r.height - FH * s) * (isNaN(pos[1]) ? .5 : pos[1] / 100);
      // Взгляд по вертикали считается от груди, а не от головы: курсор почти всегда ниже головы, и герой раньше всё
      // время смотрел вниз, а на средний ряд переходил при каждом подъёме мыши.
      geo = { s: s, x: r.left - m.left + ox, y: r.top - m.top + oy, d: dpr, hx: r.left + ox + HEAD_X * s, hy: r.top + oy + REF_Y * s };
    }
    var rowCur = -1, rowPrev = -1, fadeAt = 0;
    function frameRect(i, h) { return [(i % M.cols) * M.cw, Math.floor(i / M.cols) * h]; }
    function lerp(a, b, k) { return a + (b - a) * k; }
    function clamp1(x) { return Math.max(-1, Math.min(1, x)); }
    function glow(c, x, y, r, a) {
      var g = c.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, "rgba(255,200,130," + a + ")"); g.addColorStop(1, "rgba(255,170,90,0)");
      c.fillStyle = g; c.beginPath(); c.arc(x, y, r, 0, 6.2832); c.fill();
    }
    // Взгляд → кадр: гладкая монотонная кривая (PCHIP) через −1→0, 0→mid, 1→N−1. Кадры ряда стоят равномерно по всему
    // пути поворота, а кадр «прямо» (M.mid) — где пришёлся: путь влево у роликов длиннее пути вправо. Две прямые с изломом
    // в mid давали скачок скорости на «прямо» в 2,7 раза (замер 26.10).
    function curve(hh, mid) {
      var L = mid, R = M.N - 1 - mid, m1 = L > 0 && R > 0 ? 2 * L * R / (L + R) : 0;
      var m0 = Math.max(0, Math.min(3 * L, (3 * L - R) / 2)), m2 = Math.max(0, Math.min(3 * R, (3 * R - L) / 2));
      var t = hh < 0 ? hh + 1 : hh, a = hh < 0 ? 0 : mid, b = hh < 0 ? mid : M.N - 1, sa = hh < 0 ? m0 : m1, sb = hh < 0 ? m1 : m2;
      var t2 = t * t, t3 = t2 * t;
      return (2 * t3 - 3 * t2 + 1) * a + (t3 - 2 * t2 + t) * sa + (-2 * t3 + 3 * t2) * b + (t3 - t2) * sb;
    }
    // Кадр, который рисуется (D), — своё плавное состояние: в движении он идёт за положением взгляда (рисуется смесь двух
    // соседних кадров — без ступенек), в покое за ~0,5 с доходит до ближайшего целого кадра (рисуется один резкий кадр).
    // Отдельное состояние, а не «положение + доводка»: первая проба 29.10 шагала целым кадром в начале движения.
    // Кадры у всех уровней взгляда общие (v4), поэтому D при смене уровня не пересчитывается и покой не сбивается.
    function fOf() { return Math.max(0, Math.min(M.N - 1, curve(AMP * clamp1(H.x), M.mid))); }
    function follow(dt) {
      var f = fOf(), calm = moving < .08;
      if (D == null) D = f;
      if (calm && detent != null && Math.abs(f - detent) > .6) detent = null;     // медленный дрейф мыши — к соседнему кадру
      if (calm) { if (detent == null) detent = Math.round(D); }
      else detent = null;
      D += ((calm ? detent : f) - D) * (1 - Math.exp(-dt / (calm ? .25 : .035)));
    }
    // Уровень по вертикали взгляда — с запасом HYST, чтобы на границе уровней не дребезжало.
    function pickRow(t) {
      var rows = LV.length, fv = rows > 1 ? (clamp1(V.x) + 1) / 2 * (rows - 1) : 0, n = Math.round(fv);
      if (rowCur < 0) { rowCur = n; return; }
      if (Math.abs(fv - rowCur) > HYST && n !== rowCur) { rowPrev = rowCur; rowCur = n; fadeAt = t; }
    }
    function draw(t) {
      var c = cv.getContext("2d"), d = geo.d, s = geo.s; c.imageSmoothingEnabled = true; c.imageSmoothingQuality = "high";
      // «Дыхание»: масштаб по вертикали от линии кистей — кисти на столе стоят, плечи и голова поднимаются на ~2 px.
      var A = (geo.y + HANDS_Y * s) * d, sy = 1 + BREATH * (.5 - .5 * Math.cos((t - t0) / BREATH_T * 6.2832));
      function X(x) { return (geo.x + x * s) * d; }
      function Y(y) { return A + ((geo.y + y * s) * d - A) * sy; }
      var dx = X(M.x), dy = Y(M.y), dw = M.w * s * d, dh = M.h * s * d * sy;
      var kr = rowPrev >= 0 ? Math.min(1, (t - fadeAt) / FADE) : 1, k = kr * kr * (3 - 2 * kr);
      // Смесь соседних кадров — только в середине перехода (fi 0,2…0,8): до и после — один целый кадр. Полная смесь
      // по всему переходу в движении «двоила» (владелец 29.10, вечер); узкое окно вдвое сокращает время двоения, а
      // кадры v3 и так в 1,6 раза ближе друг к другу.
      function mixK(fi) { var x = Math.max(0, Math.min(1, (fi - .2) / .6)); return x * x * (3 - 2 * x); }
      // Строки y0…y1 ячейки дробного кадра f из атласа img (высота ячейки h, голова в ней начинается со строки off).
      // Тело и голова — две полосы одного кадра: граница M.hh лежит ниже шеи, где голова уровня и тело совпадают
      // побайтно, поэтому шва не видно (tools/seam-check.mjs: разница у границы ≤ 2 из 255).
      function part(img, h, off, f, y0, y1, a) {
        var i0 = Math.min(M.N - 2, Math.floor(f)), fi = mixK(f - i0), f0 = frameRect(i0, h), f1 = frameRect(i0 + 1, h);
        var ty = Y(M.y + y0), ph = Y(M.y + y1) - ty;
        c.globalAlpha = a; c.drawImage(img, f0[0], f0[1] + off + y0, M.cw, y1 - y0, dx, ty, dw, ph);
        if (fi > .01) { c.globalAlpha = a * fi; c.drawImage(img, f1[0], f1[1] + off + y0, M.cw, y1 - y0, dx, ty, dw, ph); }
        c.globalAlpha = 1;
      }
      function head(r, a, f) { if (heads[r]) part(heads[r], M.hc, M.ht, f, 0, M.hh, a); else part(body, M.ch, 0, f, 0, M.hh, a); }
      function at(list, f) {                              // координаты знака/глаз в дробном кадре f
        var i0 = Math.min(M.N - 2, Math.floor(f)), fi = mixK(f - i0), a = list[i0], b = list[i0 + 1];
        return a && b ? a.map(function (x, j) { return lerp(x, b[j], fi); }) : a || b;
      }
      var fc = Math.max(0, Math.min(M.N - 1, D));
      if (DBG) DBG.push([Math.round(t), +H.x.toFixed(4), +V.x.toFixed(4), detent != null ? 1 : 0, rowCur, +kr.toFixed(3), +fc.toFixed(3)]);
      c.clearRect(0, 0, cv.width, cv.height);
      part(body, M.ch, 0, fc, M.hh, M.ch, 1);
      // Переход между уровнями: прежняя голова целиком, новая проявляется ПОВЕРХ. Раньше прежний ряд гас (1−k), а новый
      // проявлялся (k) — посередине герой был прозрачен на четверть и сквозь него мигал фон (владелец 26.10: «моргает»).
      if (kr < 1) head(rowPrev, 1, fc);
      head(rowCur, kr < 1 ? k : 1, fc);
      var b = at(M.badge, fc), e = at(M.eyes, fc), lift = kr < 1 ? lerp(LV[rowPrev], LV[rowCur], k) : LV[rowCur];
      if (kr >= 1) rowPrev = -1;
      if (e) e = [e[0], e[1] + lift, e[2], e[3] + lift];   // глаза идут за лицом уровня, свечение без скачка
      var pulse = .5 - .5 * Math.cos(t / 5200 * 6.2832);
      c.globalCompositeOperation = "lighter";
      // Свечение знака слабее и шире (было .10 + .32): яркое пятно поверх размывало сам знак («знак нечётко», 29.10).
      if (b) glow(c, X(b[0]), Y(b[1]), b[2] * s * d * 1.35, .05 + .14 * pulse);
      if (e) { glow(c, X(e[0]), Y(e[1]), 9 * s * d, .15 + .25 * pulse); glow(c, X(e[2]), Y(e[3]), 9 * s * d, .15 + .25 * pulse); }
      c.globalCompositeOperation = "source-over";
    }
    // Пружина без перелёта (критическое затухание) с пределом скорости: w — жёсткость, vmax — доля размаха в секунду.
    function spring(st, to, w, vmax, dt) {
      st.v += (w * w * (to - st.x) - 2 * w * st.v) * dt;
      if (st.v > vmax) st.v = vmax; else if (st.v < -vmax) st.v = -vmax;
      st.x += st.v * dt;
    }
    function tick(t) {
      requestAnimationFrame(tick);
      // До включения слежения взгляд стоит «прямо» (= неподвижный герой hero-still): раньше он копил движение мыши
      // во время загрузки, и при включении герой перескакивал из центра в сторону (29.10.2026).
      if (!ready || !geo) { last = t; return; }
      var dt = Math.min(.05, Math.max(0, (t - last) / 1000)), now = Date.now(); last = t;
      // Без мыши — изредка короткий взгляд в сторону, и снова покой (раньше — непрерывный синус по кадрам).
      if (now - lastMove > 4000 && now > nextGlance) { th = (Math.random() * 2 - 1) * .3; tv = 0; nextGlance = now + 5000 + Math.random() * 4000; }
      spring(H, th, 4, 1.3, dt / 2); spring(H, th, 4, 1.3, dt / 2);
      spring(V, tv, 2.6, .9, dt / 2); spring(V, tv, 2.6, .9, dt / 2);
      // Покой — когда герой почти дошёл до цели и почти не движется; дрожание мыши на пару пикселей покой не сбивает,
      // а короткий выход из покоя (< 80 мс) не размывает кадр.
      moving = Math.abs(H.v) < .04 && Math.abs(th - H.x) < .025 ? 0 : moving + dt;
      pickRow(t); follow(dt);
      draw(t);
    }
    function aim(px, py) {
      if (!geo) return; lastMove = Date.now();
      th = clamp1((px - geo.hx) / Math.max(innerWidth * .35, 180));
      tv = fine ? clamp1((py - geo.hy) / Math.max(innerHeight * .36, 180)) : 0;
    }
    addEventListener("pointermove", function (e) { aim(e.clientX, e.clientY); }, { passive: true });
    addEventListener("touchmove", function (e) { if (e.touches[0]) aim(e.touches[0].clientX, e.touches[0].clientY); }, { passive: true });
    addEventListener("resize", layout); addEventListener("scroll", function () { if (geo) layout(); }, { passive: true });
    function start() {
      fetch(ROOT + "assets/home/hero-grid.json?v=" + AV).then(function (r) { return r.json(); }).then(function (meta) {
        M = meta;
        // телефон — только уровень «прямо»; ?ryad=1 — так же на компьютере (для сравнения)
        var one = !fine || /[?&]ryad=1/.test(location.search);
        LV = one ? [0] : M.pitch.slice(); if (M.amp != null) AMP = M.amp;   // атлас лежит только на рабочей половине пути: amp = 1
        // Кадры разжимаются заранее (createImageBitmap) и лишь потом включается слежение: иначе первые секунды
        // браузер раскодировал атласы прямо во время движения и кадры подвисали (замер 26.10: 7 задержек > 25 мс).
        function load(name, put) {
          var im = new Image(); im.src = ROOT + "assets/home/" + name + "?v=" + AV; put(im);
          return (im.decode ? im.decode() : new Promise(function (ok) { im.onload = ok; })).then(function () {
            return window.createImageBitmap ? createImageBitmap(im).then(put) : null;
          });
        }
        var jobs = [load("hero-body.webp", function (x) { body = x; })], j = 0;
        M.pitch.forEach(function (A) {
          if (!A) return;
          var file = "hero-head-" + j++ + ".webp", k = LV.indexOf(A);
          if (k >= 0) jobs.push(load(file, function (x) { heads[k] = x; }));
        });
        LV.forEach(function (A, k) { if (!A) heads[k] = null; });
        return Promise.all(jobs);
      }).then(function () {
        // Прогрев: по одному атласу за кадр рисуется пиксель в САМ видимый холст — загрузка в видеокарту случается
        // сейчас, пока на экране неподвижный герой, а не при первом взгляде в новый ряд. Прежний прогрев в отдельный
        // холст 2×2 не помогал (тот холст считается без видеокарты): все атласы грузились разом в первом кадре
        // слежения — заминка 0,35 с (замер 26.10).
        var c = cv.getContext("2d"), k = 0, all = [body].concat(heads.filter(Boolean));
        (function warm() {
          if (k < all.length) { c.drawImage(all[k++], 0, 0, 1, 1, 0, 0, 1, 1); requestAnimationFrame(warm); return; }
          // Первый кадр холста рисуется в том же кадре, где прячется неподвижный герой, — иначе между ними один
          // пустой кадр (мелькала мастерская без героя).
          c.clearRect(0, 0, cv.width, cv.height); layout(); pickRow(performance.now()); follow(0); nextGlance = Date.now() + 3000;
          ready = true; last = t0 = performance.now(); draw(last); media.classList.add("is-live");
        })();
      }).catch(function () {});
      requestAnimationFrame(tick);
    }
    // Атласы (3,2 МБ; до 30.10 — 5,4) — когда первый экран уже проявился (фон и неподвижный герой раскодированы): раньше они
    // качались сразу и отбирали канал у первого экрана, на 1,5 Мбит/с событие load не наступало за 30 с. Ждать само
    // load тоже плохо: его держит карта Яндекса внизу страницы. Запасной срок — 4 с.
    var begun = false;
    function idle() { if (begun) return; begun = true; if ("requestIdleCallback" in window) requestIdleCallback(start, { timeout: 1500 }); else setTimeout(start, 300); }
    if (media && !media.classList.contains("is-wait")) idle(); else if (media) media.addEventListener("hero:shown", idle, { once: true });
    setTimeout(idle, 4000);
  })();
  // Блоки проявляются при прокрутке. «АКБ iPhone от …» — из прайса ремонта, когда карточка дошла до экрана
  // (services.json тяжёлый, на первый экран его не тянем).
  var akb = document.getElementById("home-akb");
  function price() {
    fetch(ROOT + "data/services.json").then(function (r) { return r.json(); }).then(function (d) {
      var min = Infinity;
      (d.services || []).forEach(function (s) {
        if (/^iPhone/.test(s.device) && /аккумулятор/i.test(s.operation) && s.price > 0 && s.price < min) min = s.price;
      });
      if (akb && isFinite(min)) akb.textContent = (EN ? "iPhone battery from " : "АКБ iPhone от ") + min.toLocaleString("ru-RU") + " ₽";
    }).catch(function () {});
  }
  if (!("IntersectionObserver" in window)) { document.querySelectorAll(".home-reveal").forEach(function (e) { e.classList.add("is-in"); }); price(); return; }
  var io = new IntersectionObserver(function (es) {
    es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add("is-in"); io.unobserve(e.target); } });
  }, { threshold: 0.15 });
  document.querySelectorAll(".home-reveal").forEach(function (e) { io.observe(e); });
  if (akb) { var io2 = new IntersectionObserver(function (es) { if (es[0].isIntersecting) { io2.disconnect(); price(); } }); io2.observe(akb); }
})();
