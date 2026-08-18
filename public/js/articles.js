(function () {
  const grid = document.getElementById("articles-grid");
  const empty = document.getElementById("articles-empty");
  if (!grid) return;

  // Манифест один на обе версии и лежит в корне: путь обязан быть корневым,
  // иначе на /en/articles.html он превратится в /en/articles.json (18.08.2026).
  const EN = (document.documentElement.lang || "ru").slice(0, 2) === "en";

  fetch("/articles.json", { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : []))
    .then((items) => {
      // На английской странице показываем только переведённые статьи: карточка
      // с русским текстом в английском списке выглядит как поломка, а не как
      // «перевода пока нет».
      const список = Array.isArray(items)
        ? EN ? items.filter((i) => i.url_en && i.title_en) : items
        : [];
      if (!список.length) {
        if (empty) empty.style.display = "";
        return;
      }
      grid.innerHTML = список.map(renderCard).join("");
    })
    .catch(() => {
      if (empty) empty.style.display = "";
    });

  function renderCard(item) {
    const date = item.date ? formatDate(item.date) : "";
    const url = EN ? item.url_en : item.url;
    const title = EN ? item.title_en : item.title;
    const excerpt = (EN ? item.excerpt_en : item.excerpt) || "";
    return (
      '<a class="card article-card" href="/' + escapeHtml(url) + '">' +
      '<img src="/' + escapeHtml(item.image) + '" alt="" class="article-card-image" loading="lazy" width="400" height="260">' +
      "<h3>" + escapeHtml(title) + "</h3>" +
      (date ? '<p class="article-meta">' + date + "</p>" : "") +
      "<p>" + escapeHtml(excerpt) + "</p>" +
      "</a>"
    );
  }

  function formatDate(iso) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleDateString(EN ? "en-GB" : "ru-RU", { day: "numeric", month: "long", year: "numeric" });
  }

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
})();
