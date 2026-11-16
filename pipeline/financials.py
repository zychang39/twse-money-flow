"""季財報：MOPS 綜合損益表（t163sb04）、資產負債表（t163sb05）、現金流量表（t163sb20）彙總（GET 帶參數，Actions 實測可用）。

損益項目為「年初至該季」累計（YTD），單季值 = 本季 YTD − 上季 YTD（Q1 即 YTD）。
儲存：financials/{YYYY}/{YYYY}{季末月}01.csv.gz（Q1=03、Q2=06、Q3=09、Q4=12）。
"""

from __future__ import annotations

import re
from datetime import date
from typing import Any

import pandas as pd

from pipeline.core.normalize import clean_code, clean_name, strip_tags, to_num
from pipeline.sources.base import ParseError

MOPS = "https://mopsov.twse.com.tw/mops/web/ajax_{sb}?encodeURIComponent=1&step=1&firstin=1&off=1&isQuery=Y&TYPEK={typek}&year={roc}&season={season:02d}"
# 2026-11（生意體質）：損益多留營業利益、稅前淨利、所得稅；資產負債多留資產總計、流動／非流動負債、負債總計、權益總計、庫藏股票。
# 這些欄位原本就在同一份彙總表裡（不增加請求）。金融業格式沒有營業利益或流動負債 → 空值（前端顯示「金融業改看 ROE」）。
BASE_COLS = [
    "code",
    "name",
    "market",
    "year",
    "quarter",
    "revenue",
    "gross_profit",
    "ni_parent",
    "eps",
    "equity_parent",
]
INCOME_EXTRA = ["op_income", "pretax", "tax"]
BALANCE_EXTRA = ["total_assets", "cur_liab", "noncur_liab", "total_liab", "equity_total", "treasury"]
# 現金流量表彙總（t163sb20；2026-11-16 以 Actions 抓回的真實樣本確認格式）：營業活動、投資活動的淨現金流（累計值）
CASH_EXTRA = ["cfo", "cfi"]
FIN_COLS = [*BASE_COLS, *INCOME_EXTRA, *BALANCE_EXTRA, *CASH_EXTRA]
# 舊檔（2026-11 以前寫入）沒有這個欄位 → run_history／upgrade_stale 會重抓
UPGRADE_MARK = "total_assets"
_TABLE = re.compile(r"<table class='hasBorder'.*?</table>", re.S)
_HEAD = re.compile(r"<tr class='tblHead'>(.*?)</tr>", re.S)
_ROW = re.compile(r"<tr class='(?:even|odd)'>(.*?)</tr>", re.S)
_CELL = re.compile(r"<t[hd][^>]*>(.*?)</t[hd]>", re.S)


def _find(cols: list[str], *preds: Any) -> int | None:
    for pred in preds:
        for i, c in enumerate(cols):
            if pred(c):
                return i
    return None


def parse_statement(html: bytes | str, kind: str) -> pd.DataFrame:
    """kind：income（損益）、balance（資產負債）或 cash（現金流量）。回傳 code 與關鍵欄位（跨產業格式）。"""
    text = html.decode("utf-8", errors="replace") if isinstance(html, bytes) else html
    tables = _TABLE.findall(text)
    if not tables:
        if "查無" in text or "無資料" in text:
            return pd.DataFrame()
        raise ParseError("MOPS 財報：找不到資料表")
    rows = []
    for tb in tables:
        head = _HEAD.search(tb)
        if not head:
            continue
        cols = [strip_tags(c) for c in _CELL.findall(head.group(1))]
        if kind == "income":
            i_rev = _find(cols, lambda c: c == "營業收入", lambda c: c in ("淨收益", "收益", "收入"))
            i_gp = _find(cols, lambda c: c == "營業毛利（毛損）淨額", lambda c: c == "營業毛利（毛損）")
            i_ni = _find(cols, lambda c: c.startswith("淨利") and "歸屬於母公司業主" in c)
            i_eps = _find(cols, lambda c: c.startswith("基本每股盈餘"))
            i_op = _find(cols, lambda c: c in ("營業利益（損失）", "營業利益"))
            i_pre = _find(cols, lambda c: c.startswith("稅前淨利"), lambda c: c.startswith("繼續營業單位稅前"))
            i_tax = _find(cols, lambda c: c.startswith("所得稅"))
        elif kind == "cash":
            i_cfo = _find(cols, lambda c: c.startswith("營業活動之淨現金流入"))
            i_cfi = _find(cols, lambda c: c.startswith("投資活動之淨現金流入"))
        else:
            i_eq = _find(cols, lambda c: "歸屬於母公司業主" in c and "權益" in c and "合計" in c)
            i_bal = {
                "total_assets": _find(cols, lambda c: c in ("資產總計", "資產總額")),
                "cur_liab": _find(cols, lambda c: c == "流動負債"),
                "noncur_liab": _find(cols, lambda c: c == "非流動負債"),
                "total_liab": _find(cols, lambda c: c in ("負債總計", "負債總額")),
                "equity_total": _find(cols, lambda c: c in ("權益總計", "權益總額")),
                "treasury": _find(cols, lambda c: c == "庫藏股票"),
            }
        for r in _ROW.findall(tb):
            cells = [strip_tags(c) for c in _CELL.findall(r)]
            if len(cells) < 3:
                continue
            rec: dict[str, Any] = {"code": clean_code(cells[0]), "name": clean_name(cells[1])}
            if kind == "income":
                rec["revenue"] = to_num(cells[i_rev]) if i_rev is not None else None
                rec["gross_profit"] = to_num(cells[i_gp]) if i_gp is not None else None
                rec["ni_parent"] = to_num(cells[i_ni]) if i_ni is not None else None
                rec["eps"] = to_num(cells[i_eps]) if i_eps is not None else None
                rec["op_income"] = to_num(cells[i_op]) if i_op is not None else None
                rec["pretax"] = to_num(cells[i_pre]) if i_pre is not None else None
                rec["tax"] = to_num(cells[i_tax]) if i_tax is not None else None
            elif kind == "cash":
                rec["cfo"] = to_num(cells[i_cfo]) if i_cfo is not None and i_cfo < len(cells) else None
                rec["cfi"] = to_num(cells[i_cfi]) if i_cfi is not None and i_cfi < len(cells) else None
            else:
                rec["equity_parent"] = to_num(cells[i_eq]) if i_eq is not None else None
                for name, i in i_bal.items():
                    rec[name] = to_num(cells[i]) if i is not None and i < len(cells) else None
            rows.append(rec)
    return pd.DataFrame(rows).drop_duplicates("code") if rows else pd.DataFrame()


def quarter_key(year: int, quarter: int) -> date:
    return date(year, quarter * 3, 1)


def fetch_quarter(ctx: Any, year: int, quarter: int) -> pd.DataFrame:
    from pipeline.tasks import SOURCE_ERRORS, _fetch

    frames = []
    for market, typek in (("twse", "sii"), ("tpex", "otc")):
        inc = parse_statement(
            _fetch(ctx, MOPS.format(sb="t163sb04", typek=typek, roc=year - 1911, season=quarter)), "income"
        )
        bal = parse_statement(
            _fetch(ctx, MOPS.format(sb="t163sb05", typek=typek, roc=year - 1911, season=quarter)), "balance"
        )
        if inc.empty:
            continue
        bal_cols = ["equity_parent", *BALANCE_EXTRA]
        df = (
            inc.merge(bal[["code", *bal_cols]], on="code", how="left")
            if not bal.empty
            else inc.assign(**dict.fromkeys(bal_cols))
        )
        # 現金流量表：取不到（來源暫時失敗或該市場沒有這張表）不影響損益與資產負債，欄位留空
        try:
            cash = parse_statement(
                _fetch(ctx, MOPS.format(sb="t163sb20", typek=typek, roc=year - 1911, season=quarter)), "cash"
            )
        except SOURCE_ERRORS:
            cash = pd.DataFrame()
        df = (
            df.merge(cash[["code", *CASH_EXTRA]], on="code", how="left")
            if not cash.empty
            else df.assign(**dict.fromkeys(CASH_EXTRA))
        )
        df["market"] = market
        df["year"] = year
        df["quarter"] = quarter
        frames.append(df)
    if not frames:
        return pd.DataFrame(columns=FIN_COLS)
    return pd.concat(frames, ignore_index=True)[FIN_COLS]


def run_quarter(ctx: Any, year: int, quarter: int) -> bool:
    from pipeline.tasks import SOURCE_ERRORS, err_text

    try:
        df = fetch_quarter(ctx, year, quarter)
    except SOURCE_ERRORS as exc:
        ctx.note("financials", "failed", data_date=quarter_key(year, quarter), message=err_text(exc)[:300])
        return False
    if df.empty:
        ctx.note("financials", "no_data", data_date=quarter_key(year, quarter), message="該季尚未公布")
        return False
    ctx.store.write("financials", quarter_key(year, quarter), df)
    ctx.note("financials", "ok", data_date=quarter_key(year, quarter), rows=len(df))
    return True


def latest_due_quarter(today: date) -> tuple[int, int]:
    """已過法定期限的最近一季。"""
    y = today.year
    cands = [(y, 4, date(y + 1, 3, 31))] + [
        (y, q, date(y, *md)) for q, md in ((1, (5, 15)), (2, (8, 14)), (3, (11, 14)))
    ]
    cands += [(y - 1, 4, date(y, 3, 31)), (y - 1, 3, date(y - 1, 11, 14))]
    due = [(yy, q) for yy, q, dl in cands if dl <= today]
    return max(due)


def is_stale(ctx: Any, year: int, quarter: int) -> bool:
    """已存在、但缺 2026-11 新增欄位（營業利益、資產總計…）的舊檔。"""
    df = ctx.store.read("financials", quarter_key(year, quarter))
    return df is not None and UPGRADE_MARK not in df.columns


def upgrade_stale(ctx: Any, limit: int = 4) -> int:
    """把缺新欄位的舊季別重抓（由近到遠，每次最多 limit 季；時間預算用完就停）。回傳重抓成功的季數。"""
    done = 0
    for key in sorted(ctx.store.dates("financials"), reverse=True):
        if done >= limit or ctx.out_of_time():
            break
        y, q = key.year, (key.month - 1) // 3 + 1
        if is_stale(ctx, y, q) and run_quarter(ctx, y, q):
            done += 1
    return done


def run_latest(ctx: Any) -> None:
    y, q = latest_due_quarter(ctx.today)
    run_quarter(ctx, y, q)
    upgrade_stale(ctx)


def run_history(ctx: Any, start: date, end: date) -> None:
    y, q = latest_due_quarter(end)
    while (y, q) >= (start.year, (start.month - 1) // 3 + 1):
        if ctx.out_of_time():
            break
        if not ctx.store.exists("financials", quarter_key(y, q)) or is_stale(ctx, y, q):
            run_quarter(ctx, y, q)
        y, q = (y, q - 1) if q > 1 else (y - 1, 4)
