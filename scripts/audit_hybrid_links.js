#!/usr/bin/env node
/**
 * Audit hybrid card manifests vs public price sheet rows.
 *
 * Usage:
 *   node scripts/audit_hybrid_links.js
 *   node scripts/audit_hybrid_links.js --category iphone
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const reportPath = path.join(root, "public/hybrid-products/audit-report.json");

const args = process.argv.slice(2);
const categoryIdx = args.indexOf("--category");
const category = categoryIdx >= 0 ? args[categoryIdx + 1] : "";

const py = spawnSync(
  "python3",
  [
    "-c",
    `
import json, sys
sys.path.insert(0, "${path.join(root, "scripts")}")
from hybrid.audit import audit_all, save_audit_report
report = audit_all()
path = save_audit_report(report)
print(json.dumps({"report": str(path), "summary": report["summary"]}, ensure_ascii=False))
`,
  ],
  { encoding: "utf-8" }
);

if (py.status !== 0) {
  console.error(py.stderr || py.stdout);
  process.exit(py.status || 1);
}

const payload = JSON.parse(py.stdout.trim());
const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));

console.log("Hybrid audit summary:");
console.log(`  ok: ${payload.summary.ok}`);
console.log(`  missing_meta: ${payload.summary.missing_meta}`);
console.log(`  broken_file: ${payload.summary.broken_file}`);
console.log(`  report: ${path.relative(root, reportPath)}`);

const categories = category ? [category] : Object.keys(report.categories);
for (const cat of categories) {
  const catReport = report.categories[cat];
  if (!catReport) continue;
  console.log(`\n[${cat}] price=${catReport.price_rows} manifest=${catReport.manifest_rows}`);
  for (const item of catReport.missing_meta.slice(0, 20)) {
    console.log(`  no-meta  ${item.product_id}  ${item.name}`);
  }
  for (const item of catReport.broken_file.slice(0, 20)) {
    console.log(`  404      ${item.product_id}  ${item.manifest_url || item.expected_url}`);
  }
}
