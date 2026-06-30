from __future__ import annotations

import csv
import json
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

from .config import ROOT, SHEET_TABS, SNAPSHOTS_DIR, read_sheet_id
from .price_parser import fetch_sheet_json, parse_sheet_json


def _snapshot_path(tab: str) -> Path:
    SNAPSHOTS_DIR.mkdir(parents=True, exist_ok=True)
    safe = tab.replace("/", "-")
    return SNAPSHOTS_DIR / f"Prices-{safe}.csv" if tab != "Prices" else SNAPSHOTS_DIR / "Prices.csv"


def _rows_to_csv(json_data: dict) -> list[list[str]]:
    rows = json_data.get("table", {}).get("rows") or []
    csv_rows: list[list[str]] = []
    for row in rows:
        cells = row.get("c") or []
        line: list[str] = []
        for cell in cells[:6]:
            if not cell:
                line.append("")
                continue
            if cell.get("f"):
                line.append(str(cell["f"]).strip())
            elif cell.get("v") is None:
                line.append("")
            else:
                line.append(str(cell["v"]).strip())
        csv_rows.append(line)
    return csv_rows


def sync_public_sheets(sheet_id: str | None = None) -> dict:
    sheet_id = sheet_id or read_sheet_id()
    if not sheet_id:
        raise RuntimeError("googleSheetId not found in public/js/config.example.js")

    result = {
        "sheet_id": sheet_id,
        "synced_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "tabs": {},
    }

    for tab in SHEET_TABS:
        json_data = fetch_sheet_json(sheet_id, tab)
        csv_rows = _rows_to_csv(json_data)
        path = _snapshot_path(tab)
        with path.open("w", encoding="utf-8", newline="") as fh:
            writer = csv.writer(fh)
            writer.writerows(csv_rows)
        products, updated_at = parse_sheet_json(json_data)
        result["tabs"][tab] = {
            "path": str(path.relative_to(ROOT)),
            "rows": len(csv_rows),
            "products": len(products),
            "updated_at": updated_at,
        }

    meta_path = SNAPSHOTS_DIR / "sync-meta.json"
    meta_path.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return result
