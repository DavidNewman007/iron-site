#!/usr/bin/env node
/**
 * Patch hybrid manifest covers from first gallery image in card HTML/source.
 *
 * Usage:
 *   node scripts/patch_hybrid_covers.js
 *   node scripts/patch_hybrid_covers.js --category iphone
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const hybridRoot = path.join(root, "public/hybrid-products");

const categories = [
  "iphone",
  "ipad",
  "macbook",
  "watch",
  "airpods",
  "samsung",
  "accessories",
];

const args = process.argv.slice(2);
const categoryIdx = args.indexOf("--category");
const selected = categoryIdx >= 0 ? [args[categoryIdx + 1]] : categories;

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function coverFromSource(category, productId) {
  const sourcePath = path.join(hybridRoot, "_sources", category, `${productId}.json`);
  if (!fs.existsSync(sourcePath)) return "";
  const source = readJson(sourcePath);
  return source.images_local?.[0] || "";
}

function coverFromHtml(relUrl) {
  const htmlPath = path.join(root, "public", relUrl);
  if (!fs.existsSync(htmlPath)) return "";
  const html = fs.readFileSync(htmlPath, "utf8");
  const imagesMatch = html.match(/const IMAGES = (\[[^\]]*\])/);
  if (!imagesMatch) return "";
  try {
    const images = JSON.parse(imagesMatch[1].replace(/'/g, '"'));
    const first = images[0] || "";
    return first.replace(/^\.\.\/\.\.\//, "");
  } catch {
    const imgMatch = html.match(/id="mainImg" src="\.\.\/\.\.\/([^"]+)"/);
    return imgMatch?.[1] || "";
  }
}

let patched = 0;
for (const category of selected) {
  const manifestPath = path.join(hybridRoot, `${category}-cards.json`);
  if (!fs.existsSync(manifestPath)) continue;
  const manifest = readJson(manifestPath);
  const byId = manifest.byId || {};

  for (const [productId, meta] of Object.entries(byId)) {
    const fromSource = coverFromSource(category, productId);
    const fromHtml = coverFromHtml(meta.url || "");
    const nextCover = fromSource || fromHtml;
    if (!nextCover || meta.cover === nextCover) continue;
    meta.cover = nextCover;
    patched += 1;
  }

  manifest.generated_at = new Date().toISOString();
  writeJson(manifestPath, manifest);
}

console.log(JSON.stringify({ patched, categories: selected }, null, 2));
