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
    Promise.all([dec(ROOT + "assets/home/hero-poster.webp?v=2026-10-30e"), still ? dec(null, still) : null]).then(show);
    setTimeout(show, 2500);
  })();
  // Герой за курсором — атлас v6 (30.10.2026, план 118), приём образца «лягушка» (канал «Вечно перспективный»): ОДИН
  // ролик, в котором голова героя проходит полный круг (влево → вверх → вправо → вниз → влево), корпус чуть следует за
  // головой; направление курсора от головы выбирает момент этого ролика. Ролик снят MiniMax H3 «по образцам» по превизу
  // Blender (серый манекен ведёт голову по кругу), петля — M.n целых кадров героя равным шагом по движению головы, угол
  // взгляда каждого кадра — M.angle (0° — вправо, 90° — вверх, ±180° — влево); знак на груди — наклейка с прежнего героя
  // (MiniMax его перерисовывал), свечение знака — по его месту в каждом кадре (M.badge). Атласы: компьютер — M.files по
  // M.per кадров, телефон — M.mobile (половина размера). Геометрия кадра 1280×704 — по правилам object-fit: cover <video>.
  // Изменено 30.10.2026 тем же днём, раньше (v5): неподвижное тело и голова каждого кадра, вклеенная по воротнику, —
  // владелец: «в этих областях идёт сшивка двух слоёв… сделать целостным бесшовным, пусть слегка двигается корпус»;
  // «движения слишком плавные, как будто замедленные» — пружина жёстче и быстрее (W_ 4,5 → 8, предел ~135 → 360°/с; при 425°/с бросок мыши
  // давал шаг до 1,9 кадра петли за кадр экрана — на грани «срыва»).
  // Изменено 30.10.2026, раньше (атласы v3/v4): поворот влево-вправо — ролик LTX с поворотом корпуса, вверх-вниз —
  // отдельные ряды, потом выгибание головы; оси из разных источников, корпус ездил. Владелец: «выглядит так себе; у того,
  // кто делал лягушку, почему так плавно?» — там ровно этот приём. Что осталось из правок 29.10: пружина по времени с
  // пределом скорости (без «срывов»), в покое один целый кадр (без «двоения»), смесь соседних кадров только в середине
  // перехода, «дыхание» от линии кистей, кадры разжаты и прогреты до включения слежения.
  (function () {
    var cv = document.getElementById("home-head"), video = document.getElementById("home-video"), media = cv && cv.parentNode;
    if (!cv || !video || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    var FW = 1280, FH = 704, HEAD_X = 705, HEAD_Y = 150, HANDS_Y = 600, fine = matchMedia("(hover: hover) and (pointer: fine)").matches;
    var BREATH = .0035, BREATH_T = 5200, W_ = 8, VMAX_DEG = 360, DEAD = 70, IDLE = 6000, AV = "2026-10-30v6e";   // AV — версия атласов: кэш браузера и Pages
    var M = null, atl = [], badgeImg = null, CWc = 0, CHc = 0, COLc = 0, PER = 0, n = 0, VMAX = 0;
    var geo = null, P = 0, Vp = 0, T = 0, D = 0, detent = null, moving = 0, lastMove = 0, nextGlance = 0, glanceEnd = 0, ready = false, last = 0, t0 = 0;
    var DBG = /[?&]herodebug=1/.test(location.search) ? (window.__hero = []) : null;   // замеры плавности (tools/hero-motion.mjs)
    function layout() {
      var r = video.getBoundingClientRect(), m = cv.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, 2);
      // Размер холста — только если изменился: присваивание width стирает холст и заново выделяет память, а
      // layout зовётся на каждое событие прокрутки (до 29.10.2026 так и было).
      var Wd = Math.round(m.width * dpr), Hd = Math.round(m.height * dpr);
      if (cv.width !== Wd) cv.width = Wd;
      if (cv.height !== Hd) cv.height = Hd;
      var s = Math.max(r.width / FW, r.height / FH), pos = getComputedStyle(video).objectPosition.split(" ").map(parseFloat);
      var ox = (r.width - FW * s) * (isNaN(pos[0]) ? .5 : pos[0] / 100), oy = (r.height - FH * s) * (isNaN(pos[1]) ? .5 : pos[1] / 100);
      geo = { s: s, x: r.left - m.left + ox, y: r.top - m.top + oy, d: dpr, hx: r.left + ox + HEAD_X * s, hy: r.top + oy + HEAD_Y * s };
    }
    function wrap(a) { return ((a % n) + n) % n; }
    function cdiff(a, b) { var x = wrap(b - a); return x > n / 2 ? x - n : x; }      // кратчайший путь по кругу от a к b
    function lerp(a, b, k) { return a + (b - a) * k; }
    function glow(c, x, y, r, a) {
      var g = c.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, "rgba(255,200,130," + a + ")"); g.addColorStop(1, "rgba(255,170,90,0)");
      c.fillStyle = g; c.beginPath(); c.arc(x, y, r, 0, 6.2832); c.fill();
    }
    // Угол взгляда → дробный кадр петли. Углы в M.angle убывают от 180° до −180° (перемычка в конце — тоже «влево»).
    function frameOf(deg) {
      var a = M.angle;
      if (deg >= a[0]) return 0;
      for (var i = 1; i < n; i++) if (a[i] <= deg) return a[i - 1] === a[i] ? i : i - 1 + (a[i - 1] - deg) / (a[i - 1] - a[i]);
      return n - 1;
    }
    // Кадр, который рисуется (D), идёт за пружиной (P): в движении — смесь двух соседних кадров, в покое за ~0,5 с
    // доходит до ближайшего целого кадра (один резкий кадр). Всё по кругу: от последнего кадра — к первому.
    function follow(dt) {
      var calm = moving < .08;
      if (calm && detent != null && Math.abs(cdiff(detent, P)) > .6) detent = null;
      if (calm) { if (detent == null) detent = wrap(Math.round(P)); }
      else detent = null;
      var goal = calm ? detent : P;
      D = wrap(D + cdiff(D, goal) * (1 - Math.exp(-dt / (calm ? .25 : .035))));
    }
    function draw(t) {
      var c = cv.getContext("2d"), d = geo.d, s = geo.s; c.imageSmoothingEnabled = true; c.imageSmoothingQuality = "high";
      // «Дыхание»: масштаб по вертикали от линии кистей — кисти на столе стоят, плечи и голова поднимаются на ~2 px.
      var A = (geo.y + HANDS_Y * s) * d, sy = 1 + BREATH * (.5 - .5 * Math.cos((t - t0) / BREATH_T * 6.2832));
      function X(x) { return (geo.x + x * s) * d; }
      function Y(y) { return A + ((geo.y + y * s) * d - A) * sy; }
      // Смесь соседних кадров — только в середине перехода (fi 0,2…0,8): до и после — один целый кадр (29.10, «двоит»).
      function mixK(fi) { var x = Math.max(0, Math.min(1, (fi - .2) / .6)); return x * x * (3 - 2 * x); }
      function frameAt(i, a) {                                  // целый кадр героя i петли
        var q = i % PER, img = atl[Math.floor(i / PER)];
        c.globalAlpha = a; c.drawImage(img, (q % COLc) * CWc, Math.floor(q / COLc) * CHc, CWc, CHc, X(M.x), Y(M.y), M.w * s * d, Y(M.y + M.h) - Y(M.y));
      }
      var i0 = Math.floor(D) % n, i1 = (i0 + 1) % n, fi = mixK(D - Math.floor(D));
      if (DBG) DBG.push([Math.round(t), +P.toFixed(3), +T.toFixed(3), detent != null ? 1 : 0, 0, 1, +D.toFixed(3)]);
      c.clearRect(0, 0, cv.width, cv.height);
      frameAt(i0, 1); if (fi > .01) frameAt(i1, fi); c.globalAlpha = 1;
      // Знак — отдельным слоем в ×2 поверх кадра, по месту груди в этом кадре: запечённый в ячейку знак на большом
      // экране расплывался (владелец 30.10: «доделать значок нормально»).
      if (badgeImg && M.emblem) {
        var p0 = M.emblem.pos[i0], p1 = M.emblem.pos[i1], ex = lerp(p0[0], p1[0], fi), ey = lerp(p0[1], p1[1], fi);
        c.drawImage(badgeImg, X(ex), Y(ey), M.emblem.w * s * d, Y(ey + M.emblem.h) - Y(ey));
      }
      var pulse = .5 - .5 * Math.cos(t / 5200 * 6.2832), b0 = M.badge[i0], b1 = M.badge[i1];
      var b = [lerp(b0[0], b1[0], fi), lerp(b0[1], b1[1], fi), b0[2]];
      c.globalCompositeOperation = "lighter";
      // Свечение знака слабое и широкое: яркое пятно поверх размывало сам знак («знак нечётко», 29.10).
      if (b) glow(c, X(b[0]), Y(b[1]), b[2] * s * d * 1.35, .05 + .14 * pulse);
      c.globalCompositeOperation = "source-over";
    }
    function tick(t) {
      requestAnimationFrame(tick);
      // До включения слежения взгляд стоит «прямо» (= неподвижный герой hero-still): движение мыши во время загрузки
      // не копится, герой не перескакивает при включении (29.10.2026).
      if (!ready || !geo) { last = t; return; }
      var dt = Math.min(.05, Math.max(0, (t - last) / 1000)), now = Date.now(); last = t;
      // Без мыши — через IDLE снова «прямо», потом изредка короткий взгляд в сторону и обратно.
      if (now - lastMove > IDLE) {
        if (glanceEnd && now > glanceEnd) { T = M.straight; glanceEnd = 0; }
        else if (!glanceEnd && now > nextGlance) {
          T = frameOf([180, 150, 120, 90, 60, 30, 0, -150][Math.floor(Math.random() * 8)]);
          glanceEnd = now + 1400 + Math.random() * 800; nextGlance = now + 7000 + Math.random() * 4000;
        } else if (!glanceEnd) T = M.straight;
      }
      // Пружина по кругу (критическое затухание) с пределом скорости, в кадрах петли за секунду; два полушага за кадр.
      for (var h = 0; h < 2; h++) {
        var e = cdiff(P, T); Vp += (W_ * W_ * e - 2 * W_ * Vp) * dt / 2;
        if (Vp > VMAX) Vp = VMAX; else if (Vp < -VMAX) Vp = -VMAX;
        P = wrap(P + Vp * dt / 2);
      }
      // Покой — когда герой почти дошёл до цели и почти не движется; короткий выход из покоя (< 80 мс) не размывает кадр.
      moving = Math.abs(Vp) < .6 && Math.abs(cdiff(P, T)) < .4 ? 0 : moving + dt;
      follow(dt);
      draw(t);
    }
    function aim(px, py) {
      if (!geo || !M) return; lastMove = Date.now(); glanceEnd = 0;
      var dx = px - geo.hx, dy = py - geo.hy;
      if (Math.hypot(dx, dy) < DEAD) return;                       // курсор на самом герое — взгляд не дёргается
      T = frameOf(Math.atan2(-dy, dx) * 57.2958);
    }
    addEventListener("pointermove", function (e) { aim(e.clientX, e.clientY); }, { passive: true });
    addEventListener("touchmove", function (e) { if (e.touches[0]) aim(e.touches[0].clientX, e.touches[0].clientY); }, { passive: true });
    addEventListener("resize", layout); addEventListener("scroll", function () { if (geo) layout(); }, { passive: true });
    function start() {
      fetch(ROOT + "assets/home/hero-grid.json?v=" + AV).then(function (r) { return r.json(); }).then(function (meta) {
        M = meta; n = M.n; P = D = T = M.straight; VMAX = VMAX_DEG * n / 360;
        // Телефон — один атлас в половину размера: на экране герой ~250 px шириной, полный размер не нужен, а три атласа
        // по 9,5 Мп — лишние ~115 МБ памяти.
        var mob = !fine || innerWidth < 700, files = mob ? [M.mobile.file] : M.files;
        CWc = mob ? M.mobile.cw : M.cw; CHc = mob ? M.mobile.ch : M.ch; COLc = mob ? M.mobile.cols : M.cols; PER = mob ? n : M.per;
        // Кадры разжимаются заранее (createImageBitmap) и лишь потом включается слежение: иначе первые секунды
        // браузер раскодировал атласы прямо во время движения и кадры подвисали (замер 26.10: 7 задержек > 25 мс).
        function load(name, put) {
          var im = new Image(); im.src = ROOT + "assets/home/" + name + "?v=" + AV; put(im);
          return (im.decode ? im.decode() : new Promise(function (ok) { im.onload = ok; })).then(function () {
            return window.createImageBitmap ? createImageBitmap(im).then(put) : null;
          });
        }
        var jobs = files.map(function (f, k) { return load(f, function (x) { atl[k] = x; }); });
        if (M.emblem) jobs.push(load(M.emblem.file, function (x) { badgeImg = x; }));
        return Promise.all(jobs);
      }).then(function () {
        // Прогрев: по одному атласу за кадр рисуется пиксель в САМ видимый холст — загрузка в видеокарту случается
        // сейчас, пока на экране неподвижный герой, а не при первом движении (замер 26.10: заминка 0,35 с).
        var c = cv.getContext("2d"), k = 0, all = atl.concat(badgeImg ? [badgeImg] : []);
        (function warm() {
          if (k < all.length) { c.drawImage(all[k++], 0, 0, 1, 1, 0, 0, 1, 1); requestAnimationFrame(warm); return; }
          // Первый кадр холста рисуется в том же кадре, где прячется неподвижный герой, — без пустого кадра между ними.
          c.clearRect(0, 0, cv.width, cv.height); layout(); follow(0); nextGlance = Date.now() + 3000;
          ready = true; last = t0 = performance.now(); draw(last); media.classList.add("is-live");
        })();
      }).catch(function () {});
      requestAnimationFrame(tick);
    }
    // Атласы (компьютер 3,6 МБ, телефон 1,5 МБ; v4 — 3,2, v3 — 5,4) — когда первый экран уже проявился (фон и неподвижный герой раскодированы):
    // раньше они качались сразу и отбирали канал у первого экрана. Ждать само load тоже плохо: его держит карта
    // Яндекса внизу страницы. Запасной срок — 4 с.
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
