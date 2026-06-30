from __future__ import annotations

import json
import re
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Any

from .config import SHEET_RANGE, SHEET_TABS, read_sheet_id
from .slug import build_product_id


@dataclass
class Product:
    id: str
    name: str
    warranty: str
    country: str
    qty: str
    warehouse: str
    price: int
    category: str
    section: str
    in_stock: bool


CATEGORY_RULES = [
    {
        "id": "accessories",
        "test": re.compile(
            r"pencil|remax|pitaka|чехол|кейс|ремешк|wallet|сзу|charger|кабель|аксесс|accessories|magic mouse|airtag|smarttag",
            re.I,
        ),
    },
    {"id": "iphone", "test": re.compile(r"iphone", re.I)},
    {"id": "ipad", "test": re.compile(r"ipad", re.I)},
    {"id": "airpods", "test": re.compile(r"airpods", re.I)},
    {
        "id": "gaming",
        "test": re.compile(r"playstation|ps5|ps vr|vr2|gamepad|pulse|xbox|nintendo", re.I),
    },
    {
        "id": "audio",
        "test": re.compile(
            r"galaxy\s*buds|jbl|marshall|акустик|колонк|станци|speaker|street|дуо max|midi|max zigbee",
            re.I,
        ),
    },
    {"id": "dyson", "test": re.compile(r"dyson|\bhs\d{2}\b|\bhd\d{2}\b|\bht\d{2}\b", re.I)},
    {
        "id": "gadgets",
        "test": re.compile(r"whoop|gopro|instax|fujifilm|canon|dji|osmo|apple tv", re.I),
    },
    {"id": "macbook", "test": re.compile(r"macbook", re.I)},
    {
        "id": "samsung",
        "test": re.compile(r"samsung", re.I),
        "exclude": re.compile(r"galaxy\s*buds", re.I),
    },
    {
        "id": "galaxy_watch",
        "test": re.compile(r"galaxy watch|^watch\s*(8|ultra|classic)\b", re.I),
    },
    {"id": "meta", "test": re.compile(r"meta|oakley|wayfarer|skyler", re.I)},
    {
        "id": "watch",
        "test": re.compile(
            r"apple\s*watch|series\s*(?:se\s*\d*|\d+|ultra(?:\s*\d+)?)|^series\s+ultra|^\s*ultra\s*\d+\b|^\s*se\d+\s+\d{2}mm\b|^\s*s\d{1,2}\s+\d{2}mm\b|⌚",
            re.I,
        ),
        "exclude": re.compile(r"galaxy\s*watch|samsung|whoop", re.I),
    },
    {"id": "other", "test": re.compile(r".", re.I)},
]


def parse_price(value: Any) -> int:
    if isinstance(value, (int, float)):
        return int(value)
    digits = re.sub(r"[^\d]", "", str(value or ""))
    return int(digits) if digits else 0


def clean_product_name(name: str) -> str:
    return re.sub(r"(\D)(\d{4,})$", r"\1", str(name or "")).strip()


def normalize_product_fields(qty: str, price_raw: str) -> tuple[str, str]:
    q = str(qty or "").strip()
    p = str(price_raw or "").strip()
    price_num = parse_price(p)
    qty_num = parse_price(q)

    if price_num > 0 and price_num < 1000 and re.search(r"шт", q, re.I):
        return q, ""
    if price_num >= 1000 and qty_num >= 1000 and q == p:
        return "", p
    if (price_num < 1000 or not p) and qty_num >= 1000 and not re.search(r"шт", q, re.I):
        return "", q
    return q, p


def detect_category(text: str) -> str | None:
    for rule in CATEGORY_RULES:
        if rule["id"] == "other":
            continue
        if rule["test"].search(text or ""):
            exclude = rule.get("exclude")
            if exclude and exclude.search(text or ""):
                continue
            return rule["id"]
    return None


def is_category_row(name: str, warranty: str, country: str, qty: str, price_raw: str) -> bool:
    return bool(name and not warranty and not country and not qty and not price_raw)


def normalize_section_label(section: str) -> str:
    s = re.sub(r"\s+", " ", str(section or "")).strip()
    if re.match(r"^📱\s*iPhone Air(?:\s+eSIM)?$", s, re.I):
        return "📱 iPhone Air eSIM"
    return s


def is_watch_like_name(text: str) -> bool:
    t = str(text or "").strip()
    if re.search(r"galaxy\s*watch|samsung|whoop", t, re.I):
        return False
    return bool(
        re.search(
            r"apple\s*watch|series\s*(?:se\s*\d*|\d+|ultra(?:\s*\d+)?)|^series\s+ultra|^\s*ultra\s*\d+\b|⌚|^\s*se\d+\s+\d{2}mm\b|^\s*s\d{1,2}\s+\d{2}mm\b|^\s*ultra\s+\d+\b",
            t,
            re.I,
        )
    )


def is_watch_section_label(section: str) -> bool:
    s = str(section or "").strip()
    if re.search(r"galaxy\s*watch|samsung|whoop", s, re.I):
        return False
    return bool(
        re.search(
            r"⌚|apple\s*watch|series\s*(?:se\s*\d*|\d+|ultra(?:\s*\d+)?)|\bultra\s*\d+|^\s*🔘\s*(?:se\d+|s\d{1,2}|ultra)",
            s,
            re.I,
        )
    )


def is_macbook_section_label(section: str) -> bool:
    return bool(re.match(r"^💻\s*macbook", str(section or "").strip(), re.I))


def resolve_accessory_section(name: str) -> str:
    t = name or ""
    rules = [
        (r"pencil", "✏️ Pencil"),
        (r"magic mouse", "🖱 Apple Mouse"),
        (r"airtag", "📍 AirTag"),
        (r"smarttag", "📍 Galaxy SmartTag"),
        (r"антишпион", "🛡 Стекло 3D Remax Антишпион"),
        (r"remax|защитное стекло", "🛡 Стекло 3D Remax"),
        (r"чехол-бумажник|wallet", "👜 Чехол-бумажник PITAKA"),
        (r"чехол pitaka", "📱 Чехлы PITAKA"),
        (r"ремешк", "⌚ Ремешки PITAKA"),
        (r"сзu|charger|зарядк", "🔌 Зарядки"),
    ]
    for pattern, label in rules:
        if re.search(pattern, t, re.I):
            return label
    return "🔌 Accessories"


def resolve_watch_section(name: str, current_section: str) -> str:
    n = str(name or "").strip()
    s = str(current_section or "").strip()
    if is_watch_section_label(s) and not re.match(r"^📱\s*iPhone\b", s, re.I):
        return normalize_section_label(s)
    for pattern, fmt in [
        (r"^Series\s+Ultra\s+(\d+)\s+(\d{2})mm", "⌚ Ultra {} {}mm"),
        (r"^Series\s+SE\s+(\d+)\s+(\d{2})mm", "⌚ Series SE {} {}mm"),
        (r"^Series\s+(\d+)\s+(\d{2})mm", "⌚ Series {} {}mm"),
        (r"^Ultra\s+(\d+)\s+(\d{2})mm", "⌚ Ultra {} {}mm"),
        (r"^SE(\d+)\s+(\d{2})mm", "⌚ SE{} {}mm"),
        (r"^S(\d{1,2})\s+(\d{2})mm", "⌚ S{} {}mm"),
    ]:
        m = re.match(pattern, n, re.I)
        if m:
            return fmt.format(*m.groups())
    return normalize_section_label(s or "⌚ Apple Watch")


def resolve_macbook_section(name: str, current_section: str) -> str:
    s = str(current_section or "").strip()
    if is_macbook_section_label(s):
        return normalize_section_label(s)
    n = str(name or "").strip()
    for pattern, label in [
        (r"^MacBook\s+Neo", "💻 MacBook Neo"),
        (r"^MacBook\s+Air\s+15", "💻 MacBook Air 15"),
        (r"^MacBook\s+Air\s+13", "💻 MacBook Air 13"),
        (r"^MacBook\s+Pro", "💻 MacBook Pro"),
        (r"^MacBook\s+Air", "💻 MacBook Air"),
    ]:
        if re.match(pattern, n, re.I):
            return label
    return "💻 MacBook"


def fetch_sheet_json(sheet_id: str, tab: str) -> dict[str, Any]:
    query = urllib.parse.urlencode(
        {
            "tqx": "out:json",
            "sheet": tab,
            "range": SHEET_RANGE,
        }
    )
    url = f"https://docs.google.com/spreadsheets/d/{sheet_id}/gviz/tq?{query}"
    req = urllib.request.Request(url, headers={"User-Agent": "iron-hybrid-pipeline/1.0"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        text = resp.read().decode("utf-8")
    match = re.search(r"setResponse\(([\s\S]*)\);?\s*$", text)
    if not match:
        raise RuntimeError(f"Invalid Google Sheets response for tab {tab}")
    return json.loads(match.group(1))


def resolve_sheet_layout(rows: list[dict[str, Any]]) -> tuple[dict[str, int], list[dict[str, Any]]]:
    col_map = {"name": 0, "warranty": 1, "country": 2, "qty": 3, "price": 4, "warehouse": 5}
    data_rows = rows
    if rows:
        header_cells = rows[0].get("c") or []
        header = [str((cell or {}).get("v") or "").strip().lower() for cell in header_cells]
        if any("назван" in h or "наимен" in h for h in header):
            mapping = {}
            for idx, label in enumerate(header):
                if "назван" in label or "наимен" in label or label == "name":
                    mapping["name"] = idx
                elif "гарант" in label:
                    mapping["warranty"] = idx
                elif "стран" in label or "country" in label:
                    mapping["country"] = idx
                elif "кол" in label or "qty" in label or "остат" in label:
                    mapping["qty"] = idx
                elif "цен" in label or "price" in label:
                    mapping["price"] = idx
                elif "склад" in label or "warehouse" in label:
                    mapping["warehouse"] = idx
            if "name" in mapping and "price" in mapping:
                col_map = mapping
                data_rows = rows[1:]
    return col_map, data_rows


def parse_sheet_row(row: dict[str, Any], col_map: dict[str, int]) -> dict[str, str]:
    cells = row.get("c") or []

    def pick(key: str) -> str:
        idx = col_map.get(key, -1)
        if idx < 0 or idx >= len(cells):
            return ""
        value = cells[idx]
        if value is None:
            return ""
        if "f" in value and value["f"]:
            return str(value["f"]).strip()
        if value.get("v") is None:
            return ""
        return str(value["v"]).strip()

    return {
        "name": clean_product_name(pick("name")),
        "warranty": pick("warranty"),
        "country": pick("country"),
        "qty": pick("qty"),
        "priceRaw": pick("price"),
        "warehouse": pick("warehouse"),
    }


def parse_sheet_json(json_data: dict[str, Any]) -> tuple[list[Product], str]:
    rows = json_data.get("table", {}).get("rows") or []
    col_map, data_rows = resolve_sheet_layout(rows)

    products: list[Product] = []
    updated_at = ""
    current_category = "other"
    current_section = ""

    for row in data_rows:
        parsed = parse_sheet_row(row, col_map)
        name = parsed["name"]
        if not name:
            continue

        updated_match = re.match(r"^обновлено:\s*(.+)$", name, re.I)
        if updated_match:
            updated_at = updated_match.group(1).strip()
            continue

        if is_category_row(
            name,
            parsed["warranty"],
            parsed["country"],
            parsed["qty"],
            parsed["priceRaw"],
        ):
            current_section = normalize_section_label(re.sub(r"\s*🆕\s*$", "", name).strip())
            cat = detect_category(current_section)
            if cat:
                current_category = cat
            elif is_watch_section_label(current_section):
                current_category = "watch"
            elif is_macbook_section_label(current_section):
                current_category = "macbook"
            continue

        qty, price_raw = normalize_product_fields(parsed["qty"], parsed["priceRaw"])
        if not price_raw:
            continue
        price = parse_price(price_raw)
        if not price or price < 100:
            continue

        detected = detect_category(name)
        product_category = detected or current_category
        if product_category == "iphone" and (
            is_watch_like_name(name) or is_watch_like_name(current_section)
        ):
            product_category = "watch"
        if is_watch_like_name(name) and is_watch_section_label(current_section):
            product_category = "watch"

        product_section = current_section
        if product_category == "accessories":
            product_section = resolve_accessory_section(name)
        elif product_category == "watch":
            product_section = resolve_watch_section(name, current_section)
        elif product_category == "macbook":
            product_section = resolve_macbook_section(name, current_section)

        product_id = build_product_id(
            name, parsed["country"], parsed["warehouse"], price
        )
        products.append(
            Product(
                id=product_id,
                name=name,
                warranty=parsed["warranty"] or "",
                country=parsed["country"] or "",
                qty=qty or "",
                warehouse=parsed["warehouse"] or "",
                price=price,
                category=product_category,
                section=product_section,
                in_stock=not re.search(r"0\s*шт", qty or "", re.I),
            )
        )

    return products, updated_at


def load_products_from_sheet(sheet_id: str | None = None) -> tuple[list[Product], str]:
    sheet_id = sheet_id or read_sheet_id()
    if not sheet_id:
        raise RuntimeError("googleSheetId not found in public/js/config.example.js")

    merged: list[Product] = []
    seen: set[str] = set()
    updated_at = ""

    for tab in SHEET_TABS:
        json_data = fetch_sheet_json(sheet_id, tab)
        tab_products, tab_updated = parse_sheet_json(json_data)
        if not updated_at and tab_updated:
            updated_at = tab_updated
        for product in tab_products:
            if product.id in seen:
                continue
            seen.add(product.id)
            merged.append(product)

    return merged, updated_at
