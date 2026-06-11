import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

const TG_FUNC_URL = process.env.TG_FUNC_URL || "";
const TG_FUNC_TOKEN = process.env.TG_FUNC_TOKEN || "";
const NOTIFY_PHONE = process.env.NOTIFY_PHONE || "+79288509404";
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "*";
const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID || "";
const GOOGLE_SHEET_TAB = process.env.GOOGLE_SHEET_TAB || "Prices";

app.use(
  cors({
    origin: ALLOWED_ORIGIN === "*" ? true : ALLOWED_ORIGIN.split(","),
  })
);
app.use(express.json());

app.get("/api/prices", async (_req, res) => {
  const sheetId = GOOGLE_SHEET_ID;
  if (!sheetId) {
    return res.status(503).json({ error: "GOOGLE_SHEET_ID не задан в .env" });
  }

  const url =
    `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq` +
    `?tqx=out:json&sheet=${encodeURIComponent(GOOGLE_SHEET_TAB)}&range=A2:E800`;

  try {
    const r = await fetch(url);
    if (!r.ok) {
      return res.status(502).json({ error: "Google Sheets: HTTP " + r.status });
    }
    const text = await r.text();
    const json = JSON.parse(text.replace(/^.*setResponse\(/, "").replace(/\);?\s*$/, ""));
    res.json(json);
  } catch (e) {
    console.error("[prices]", e);
    res.status(502).json({ error: "Не удалось загрузить прайс" });
  }
});

app.post("/api/contact", async (req, res) => {
  const { name, phone, device, message } = req.body || {};

  if (!name || !phone || !message) {
    return res.status(400).json({ error: "Заполните имя, телефон и описание" });
  }

  const text = [
    "<b>Заявка с сайта IRON SERVICE</b>",
    "",
    `Имя: ${escapeHtml(name)}`,
    `Телефон: ${escapeHtml(phone)}`,
    `Устройство: ${escapeHtml(device || "—")}`,
    "",
    escapeHtml(message),
  ].join("\n");

  if (!TG_FUNC_URL || !TG_FUNC_TOKEN) {
    console.log("[contact] Backend без Telegram:", { name, phone, device, message });
    return res.json({
      ok: true,
      mode: "log_only",
      hint: "Задайте TG_FUNC_URL и TG_FUNC_TOKEN в .env",
    });
  }

  try {
    const tgRes = await fetch(TG_FUNC_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Function-Token": TG_FUNC_TOKEN,
      },
      body: JSON.stringify({
        phone: NOTIFY_PHONE,
        message: text,
        contact_name: name,
      }),
    });

    if (!tgRes.ok) {
      const errText = await tgRes.text();
      console.error("Telegram function error:", tgRes.status, errText);
      return res.status(502).json({ error: "Не удалось отправить уведомление" });
    }

    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Ошибка сервера" });
  }
});

app.use(express.static(path.join(__dirname, "..", "public")));

app.listen(PORT, () => {
  console.log(`IRON SERVICE: http://localhost:${PORT}`);
});

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
