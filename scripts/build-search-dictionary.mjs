#!/usr/bin/env node
/**
 * Пересборка search-dictionary.js из списка товаров.
 *
 * Использование:
 *   node scripts/build-search-dictionary.mjs
 *   node scripts/build-search-dictionary.mjs "../Товары список.txt"
 *
 * Базовые словари дополняются новыми токенами из файла; ручные правки
 * в BASE_TRANSLIT / BASE_TRANSLATE сохраняются при пересборке.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultInput = path.resolve(__dirname, "../../Товары список.txt");
const outputFile = path.resolve(__dirname, "../public/js/search-dictionary.js");
const inputFile = process.argv[2] ? path.resolve(process.argv[2]) : defaultInput;

const BASE_TRANSLIT = {
  iphone: ["айфон", "аифон", "айфоон", "ифон"],
  ipad: ["айпад", "айпэд", "айпед", "ипад"],
  macbook: ["макбук", "мак бук", "мэкбук"],
  airpods: ["аирподс", "эирподс", "эйрподс", "аир подс", "эир подс"],
  airpod: ["аирпод", "эирпод", "эйрпод"],
  air: ["аир", "эир", "эйр"],
  watch: ["вотч", "воуч", "часы", "ватч"],
  watches: ["вотчес", "часы", "ватчи"],
  ultra: ["ультра", "ульта"],
  series: ["сериес", "серия", "серии", "сириес"],
  samsung: ["самсунг", "самсум", "сасунг"],
  pencil: ["пенсил", "пэнсил", "пенсель", "пэнсиль"],
  skyler: ["скайлер", "скилер", "скйлер", "скиллер"],
  oakley: ["оакли", "оакле", "оукли", "окли", "оуклей"],
  wayfarer: ["вейфарер", "уэйфарер", "вайфарер", "вейферер", "уейфарер"],
  meta: ["мета", "мэта"],
  hstn: ["хстн", "эйчэстэн", "хстен"],
};

// Импорт полного translate из текущего файла при пересборке — оставляем вручную в output.
// Скрипт дополняет translit новыми латинскими токенами из прайса.

function normalizeLine(line) {
  return line
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractLatinTokens(lines) {
  const tokens = new Set();
  for (const raw of lines) {
    const line = normalizeLine(raw).toLowerCase();
    if (!line) continue;
    const words = line.match(/[a-z][a-z0-9+./-]*/gi) || [];
    for (const w of words) {
      if (w.length >= 2 && !/^\d+$/.test(w)) tokens.add(w.replace(/\./g, ""));
    }
  }
  return [...tokens].sort();
}

if (!fs.existsSync(inputFile)) {
  console.error("Файл не найден:", inputFile);
  process.exit(1);
}

const lines = fs.readFileSync(inputFile, "utf8").split(/\r?\n/);
const tokens = extractLatinTokens(lines);

const translit = { ...BASE_TRANSLIT };
for (const token of tokens) {
  if (!translit[token] && /^[a-z]/.test(token)) {
    translit[token] = [token];
  }
}

const existing = fs.readFileSync(outputFile, "utf8");
const translateMatch = existing.match(/translate:\s*(\[[\s\S]*?\n  \]),/);
if (!translateMatch) {
  console.error("Не удалось прочитать translate из", outputFile);
  process.exit(1);
}

const header = `/**
 * Словари поиска магазина IRON SERVICE.
 * Сгенерировано: ${new Date().toISOString().slice(0, 10)} из ${path.basename(inputFile)}
 * Пересборка: node scripts/build-search-dictionary.mjs
 */
window.IRON_SEARCH_DICT = {
  translit: ${JSON.stringify(translit, null, 4).replace(/^/gm, "  ")},
  translate: ${translateMatch[1]},
};
`;

fs.writeFileSync(outputFile, header, "utf8");
console.log("OK:", outputFile);
console.log("Токенов translit:", Object.keys(translit).length);
console.log("Строк в источнике:", lines.length);
