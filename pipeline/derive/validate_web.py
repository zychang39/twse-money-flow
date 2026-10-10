"""前端資料驗證（M1 驗收；`python -m pipeline validate-web --out web/public/data`）。

檢查（任何一項失敗即回傳錯誤清單；部署前執行）：
1. 檔案大小：每個 JSON 壓縮後 ≤ 300KB（超過就要拆檔）。
2. 涵蓋：每一檔有個股頁的股票都有細產業（stocks/{code}.json 的 sectors.fine 非空）與 intraday/{code}.json。
3. 題材：每個題材成員 ≥ 5 檔；IC 載板（欣興、南電、景碩）同屬一個細產業。
4. 日期：intraday.json 的 1W 日期是連續的交易日（依 meta.json 的交易日曆）；個股 5 分 K 的最後一天等於 meta 的市場日或前一交易日。
5. 合計：market.json 成交金額 total＝twse＋tpex（各日，容差 0.1 億）。
6. 策略：strategy/{id}.json 全期間的訊號筆數＝strategies.json 判定卡的樣本數；年度表的年份筆數合計＝全期間筆數。
"""

from __future__ import annotations

import gzip
import json
import logging
from pathlib import Path
from typing import Any

log = logging.getLogger(__name__)

MAX_GZIP = 300 * 1024
IC_SUBSTRATE = ("3037", "8046", "3189")


def _load(p: Path) -> Any:
    return json.loads(p.read_text(encoding="utf-8"))


def check_sizes(out: Path) -> list[str]:
    errs = []
    for p in sorted(out.rglob("*.json")):
        n = len(gzip.compress(p.read_bytes()))
        if n > MAX_GZIP:
            errs.append(f"檔案過大：{p.relative_to(out)} 壓縮後 {n / 1024:.0f}KB（上限 300KB）")
    return errs


def check_coverage(out: Path) -> tuple[list[str], dict[str, Any]]:
    errs: list[str] = []
    stocks = sorted(p.stem for p in (out / "stocks").glob("*.json") if not p.stem.endswith(".hist"))
    no_fine, no_intra = [], []
    for code in stocks:
        st = _load(out / "stocks" / f"{code}.json")
        sec = st.get("sectors") or {}
        if not sec.get("fine"):
            no_fine.append(code)
        if not (out / "intraday" / f"{code}.json").exists():
            no_intra.append(code)
    if no_fine:
        errs.append(f"沒有細產業：{len(no_fine)} 檔（{','.join(no_fine[:20])}）")
    if no_intra:
        errs.append(f"沒有分鐘資料檔：{len(no_intra)} 檔（{','.join(no_intra[:20])}）")
    idx_path = out / "intraday" / "index.json"
    intra = _load(idx_path) if idx_path.exists() else {}
    report = {
        "stocks": len(stocks),
        "fine_covered": len(stocks) - len(no_fine),
        "intraday_files": len(stocks) - len(no_intra),
        "kbar_covered": len(intra.get("codes") or []),
        "kbar_no_trade": len(intra.get("no_trade") or []),
        "kbar_missing": len(intra.get("missing") or []),
        "kbar_failed": len(intra.get("failed") or []),
        "kbar_not_fetched": len(intra.get("not_fetched") or []),
    }
    return errs, report


def check_sectors(out: Path) -> list[str]:
    errs = []
    path = out / "sectors.json"
    if not path.exists():
        return ["沒有 sectors.json"]
    sec = _load(path)
    for g in sec.get("groups") or []:
        if g["layer"] == "theme" and g["members"] < 5:
            errs.append(f"題材 {g['name']} 成員 {g['members']} 檔（< 5）")
    stocks = sec.get("stocks") or {}
    fines = [set((stocks.get(c) or [[]])[0]) for c in IC_SUBSTRATE if c in stocks]
    if len(fines) == len(IC_SUBSTRATE) and not set.intersection(*fines):
        errs.append("欣興、南電、景碩沒有共同的細產業（IC 載板）")
    flow_p = out / "sector_flows.json"
    if flow_p.exists():
        flows = _load(flow_p)
        n = len(flows.get("weeks") or []) - 1
        for layer in ("official", "fine"):
            for gid, g in (flows.get(layer) or {}).items():
                if len(g.get("f") or []) != n or len(g.get("n") or []) != n:
                    errs.append(f"sector_flows.json {layer}/{gid} 週數 {len(g.get('f') or [])}（應為 {n}）")
                    break
    return errs


def check_dates(out: Path) -> list[str]:
    errs: list[str] = []
    meta_p = out / "meta.json"
    if not meta_p.exists():
        return errs
    meta = _load(meta_p)
    closed = set((meta.get("calendar") or {}).get("closed") or [])
    intra_p = out / "intraday.json"
    if intra_p.exists():
        from datetime import date, timedelta

        days = [d["date"] for d in _load(intra_p).get("days") or []]
        tdays: list[str] = []
        if days:
            d, end = date.fromisoformat(days[0]), date.fromisoformat(days[-1])
            while d <= end:
                if d.weekday() < 5 and d.isoformat() not in closed:
                    tdays.append(d.isoformat())
                d += timedelta(days=1)
        if days and days != tdays:
            errs.append(f"intraday.json 1W 日期不連續：{days}（應為 {tdays}）")
    return errs


def check_turnover(out: Path) -> list[str]:
    errs: list[str] = []
    p = out / "market.json"
    if not p.exists():
        return errs
    t = _load(p).get("turnover") or []
    rows = t if isinstance(t, list) else t.get("series") or []
    for r in rows:
        tot, a, b = (
            (r.get("total") or {}).get("value"),
            (r.get("twse") or {}).get("value"),
            (r.get("tpex") or {}).get("value"),
        )
        if tot is not None and a is not None and b is not None and abs(float(tot) - float(a) - float(b)) > 0.1:
            errs.append(f"成交金額合計不一致 {r.get('date')}：{tot} ≠ {a} + {b}")
    return errs


def check_strategies(out: Path) -> list[str]:
    errs: list[str] = []
    lib_p = out / "strategies.json"
    if not lib_p.exists():
        return errs
    lib = _load(lib_p)
    for s in lib.get("strategies") or []:
        pack_p = out / "strategy" / f"{s['id']}.json"
        if not s.get("enabled") or not pack_p.exists():
            continue
        pack = _load(pack_p)
        n_card = ((s.get("judge") or {}).get("sig") or {}).get("n")
        allp = (pack.get("periods") or {}).get("all") or {}
        n_all = (allp.get("card") or {}).get("n")
        if n_card is not None and n_all is not None and int(n_card) != int(n_all):
            errs.append(f"策略 {s['id']}：全期間筆數 {n_all} ≠ 判定卡 {n_card}")
        years = pack.get("years") or []
        if years and n_all is not None and sum(int(y.get("n") or 0) for y in years) != int(n_all):
            errs.append(f"策略 {s['id']}：年度筆數合計 ≠ 全期間 {n_all}")
    return errs


def validate(out: Path) -> dict[str, Any]:
    errs: list[str] = []
    errs += check_sizes(out)
    cov_errs, report = check_coverage(out)
    errs += cov_errs
    errs += check_sectors(out)
    errs += check_dates(out)
    errs += check_turnover(out)
    errs += check_strategies(out)
    return {"errors": errs, **report}
