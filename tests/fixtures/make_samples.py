"""把真實樣本裁切成測試用的代表性片段（保留原始欄位結構，只減少列數）。

用法：python tests/fixtures/make_samples.py
來源：tests/fixtures/raw（Actions 抓取）與 tests/fixtures/local（本環境抓取，未 commit 的完整檔）
輸出：tests/fixtures/samples
"""

from __future__ import annotations

import json
import re
from pathlib import Path

HERE = Path(__file__).parent
KEEP_CODES = {
    "2330", "2317", "2454", "0050", "00400A", "00403A", "1101", "1102", "2618", "2305",
    "2455", "6488", "1240", "1259", "2221", "22211", "3064", "3191", "00679B", "006201",
    "00411A", "8455", "3432", "2911", "1722", "2729", "00907", "3356", "6918", "2892",
}
HEAD_ROWS = 25


def _row_code(row: object) -> str | None:
    if isinstance(row, list):
        for cell in row[:4]:
            if isinstance(cell, str) and cell.strip() in KEEP_CODES:
                return cell.strip()
        return None
    if isinstance(row, dict):
        for key in ("Code", "公司代號", "SecuritiesCompanyCode", "股票代號"):
            val = row.get(key)
            if isinstance(val, str) and val.strip() in KEEP_CODES:
                return val.strip()
    return None


def _trim_rows(rows: list) -> list:
    return [r for i, r in enumerate(rows) if i < HEAD_ROWS or _row_code(r)]


def trim_json(src: Path, dst: Path) -> None:
    data = json.loads(src.read_text(encoding="utf-8"))
    if isinstance(data, list):
        data = _trim_rows(data)
    elif isinstance(data, dict):
        if isinstance(data.get("data"), list):
            data["data"] = _trim_rows(data["data"])
        for table in data.get("tables", []) or []:
            if isinstance(table, dict) and isinstance(table.get("data"), list):
                table["data"] = _trim_rows(table["data"])
    dst.write_text(json.dumps(data, ensure_ascii=False, indent=0), encoding="utf-8")


def trim_csv(src: Path, dst: Path, encoding: str) -> None:
    raw = src.read_bytes()
    text = raw.decode(encoding, errors="replace")
    lines = text.splitlines(keepends=True)
    kept = []
    for i, line in enumerate(lines):
        cells = [c.strip().strip('"') for c in line.split(",")[:3]]
        if i <= HEAD_ROWS * 3 or any(c in KEEP_CODES for c in cells):
            kept.append(line)
    dst.write_bytes("".join(kept).encode(encoding, errors="replace"))


def trim_html(src: Path, dst: Path, limit: int = 40000) -> None:
    raw = src.read_bytes()
    if len(raw) <= limit:
        dst.write_bytes(raw)
        return
    cut = raw[:limit]
    end = cut.rfind(b"</tr>")
    dst.write_bytes(cut[: end + 5] + b"</table></td></tr></table></body></html>")


def main() -> None:
    out = HERE / "samples"
    out.mkdir(exist_ok=True)
    for folder in ("raw", "local"):
        for src in sorted((HERE / folder).glob("*")):
            if src.name.startswith("_") or src.stat().st_size == 0 or "swagger" in src.name:
                continue
            dst = out / src.name
            if src.suffix == ".json":
                try:
                    trim_json(src, dst)
                except json.JSONDecodeError:
                    trim_csv(src, dst, "utf-8")  # 例如 rwd STOCK_DAY_ALL 實際回傳 CSV
            elif src.suffix == ".csv":
                enc = "big5" if src.name.startswith("taifex_") else "utf-8-sig"
                trim_csv(src, dst, enc if enc != "utf-8-sig" else "utf-8")
            elif src.suffix == ".html":
                trim_html(src, dst)
    # 詮釋資料
    for meta in ("raw/_meta.txt", "local/_meta_local.txt"):
        p = HERE / meta
        if p.exists():
            (out / Path(meta).name).write_text(p.read_text(encoding="utf-8"), encoding="utf-8")
    sizes = sum(p.stat().st_size for p in out.glob("*"))
    print(f"samples: {len(list(out.glob('*')))} files, {sizes / 1024:.0f} KB")
    _ = re  # 保留 import 供未來擴充


if __name__ == "__main__":
    main()
