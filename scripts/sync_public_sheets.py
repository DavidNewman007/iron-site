#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from hybrid.sheet_sync import sync_public_sheets  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description="Sync public Google Sheet price tabs to CSV snapshots.")
    parser.add_argument("--sheet-id", help="Override googleSheetId from config.example.js")
    args = parser.parse_args()
    result = sync_public_sheets(args.sheet_id)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
