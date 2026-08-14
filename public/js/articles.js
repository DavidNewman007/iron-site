(function () {
  const grid = document.getElementById("articles-grid");
  const empty = document.getElementById("articles-empty");
  if (!grid) return;

  fetch("articles.json", { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : []))
    .then((items) => {
      if (!Array.isArray(items) || !items.length) {
        if (empty) empty.style.display = "";
        return;
      }
      grid.innerHTML = items.map(renderCard).join("");
    })
    .catch(() => {
      if (empty) empty.style.display = "";
    });

  function renderCard(item) {
    const date = item.date ? formatDate(item.date) : "";
    return (
      '<a class="card article-card" href="' + escapeHtml(item.url) + '">' +
      '<img src="' + escapeHtml(item.image) + '" alt="" class="article-card-image" loading="lazy" width="400" height="260">' +
      "<h3>" + escapeHtml(item.title) + "</h3>" +
      (date ? '<p class="article-meta">' + date + "</p>" : "") +
      "<p>" + escapeHtml(item.excerpt || "") + "</p>" +
      "</a>"
    );
  }

  function formatDate(iso) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
  }

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
})();
