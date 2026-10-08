"""進階資料任務：期交所（POST）、匯率、美債、集保（週）。"""

from __future__ import annotations

import logging
import os
import re
import time
from datetime import date, timedelta
from typing import Any
from urllib.parse import quote

import pandas as pd

from pipeline.core import config
from pipeline.core.dates import month_start, next_month, slash
from pipeline.core.http import CircuitOpenError, FetchError
from pipeline.registry import build_url
from pipeline.sources import advanced
from pipeline.sources.base import ParseError, ParseResult
from pipeline.tasks import SOURCE_ERRORS, RunContext, _fetch, err_text

log = logging.getLogger(__name__)


def _upsert_by_month(ctx: RunContext, source: str, df: pd.DataFrame, keys: list[str]) -> None:
    if df.empty:
        return
    for key, part in df.groupby(pd.to_datetime(df["date"]).dt.to_period("M")):
        ctx.store.upsert(source, key.to_timestamp().date(), part.reset_index(drop=True), keys)


def _post(ctx: RunContext, source: str, start: date, end: date, commodity: str | None = None) -> bytes:
    cfg = config.source(source)
    values = {"start_slash": slash(start), "end_slash": slash(end), "commodity": commodity or ""}
    form = {k: str(v).format(**values) for k, v in cfg["form"].items()}
    return _fetch(ctx, str(cfg["url"]), method="POST", form=form)


def taifex_query_end(ctx: RunContext, end: date) -> date:
    """E-07：期交所對「迄日＝今天、但今天還沒有資料」的查詢回傳 DateTime error；迄日夾到最近一個已收盤的交易日。"""
    from pipeline.tasks import target_trading_date

    return min(end, target_trading_date(ctx))


def _listed(source: str, commodity: str, end: date) -> date | None:
    """商品在 end 之前（含）已上市 → 回傳上市日（沒有設定為 date.min）；尚未上市 → None。"""
    since = (config.source(source).get("listed_since") or {}).get(commodity)
    first = date.fromisoformat(str(since)) if since else date.min
    return first if first <= end else None


def _max_date(df: pd.DataFrame) -> date | None:
    """Q-08：區間型來源的最後成功日＝實際資料的最新日期，不是查詢迄日。"""
    if df.empty or "date" not in df.columns:
        return None
    s = df["date"].dropna()
    return date.fromisoformat(str(s.max())[:10]) if len(s) else None


def run_taifex(ctx: RunContext, start: date, end: date) -> None:
    """三大法人期貨（TXF/MXF/TMF）、全市場未平倉（TX/MTX/TMF）、美元兌台幣；以月為單位查詢。

    D-03：每個商品各自處理——單一商品失敗（例：TMF 上市前）不會連帶丟掉同月已抓到的其他商品；
    查詢區間早於 config listed_since 的商品直接略過。
    D-04：區間內有交易日、但某商品回傳 0 筆（查無資料）記為失敗，不記成 ok。
    """
    end = taifex_query_end(ctx, end)
    if end < start:
        return
    jobs: list[tuple[str, Any, list[str]]] = [
        ("taifex_insti", advanced.parse_taifex_insti, ["date", "contract", "party"]),
        ("taifex_oi", advanced.parse_taifex_oi, ["date", "contract"]),
    ]
    m = month_start(start)
    while m <= end:
        a, b = max(m, start), min(next_month(m) - timedelta(days=1), end)
        has_trading = bool(ctx.calendar.trading_days(a, b))
        for source, parse, keys in jobs:
            frames, failed = [], []
            for commodity in config.source(source)["commodities"]:
                listed = _listed(source, commodity, b)
                if listed is None:
                    continue
                try:
                    res: ParseResult = parse(_post(ctx, source, max(a, listed), b, commodity))
                except SOURCE_ERRORS as exc:
                    failed.append(f"{commodity}：{err_text(exc)[:120]}")
                    continue
                if res.df.empty:
                    if has_trading:
                        failed.append(f"{commodity}：查無資料")
                    continue
                frames.append(res.df)
            df = pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()
            _upsert_by_month(ctx, source, df, keys)
            if failed:
                kept = f"；已保存其他商品 {len(df)} 列" if len(df) else ""
                ctx.note(source, "failed", data_date=b, message="；".join(failed)[:300] + kept)
            elif df.empty:
                ctx.note(source, "no_data", data_date=b, message="區間內沒有交易日")
            else:
                ctx.note(source, "ok", data_date=_max_date(df), rows=len(df))
        # 單一區間查詢（不分商品）：匯率、選擇權 Put/Call 比（M2 2026-10-03）
        for source, parse in (("fx_usdtwd", advanced.parse_fx), ("taifex_pc", advanced.parse_taifex_pc)):
            try:
                df = parse(_post(ctx, source, a, b)).df
                if df.empty and has_trading:
                    ctx.note(source, "failed", data_date=b, message="查無資料（區間內有交易日但 0 筆）")
                else:
                    _upsert_by_month(ctx, source, df, ["date"])
                    ctx.note(source, "ok", data_date=_max_date(df), rows=len(df))
            except SOURCE_ERRORS as exc:
                ctx.note(source, "failed", data_date=b, message=err_text(exc)[:300])
        m = next_month(m)


def run_ust(ctx: RunContext, year: int) -> None:
    try:
        raw = _fetch(ctx, build_url("ust_10y", date(year, 1, 1)))
        df = advanced.parse_treasury(raw).df
        ctx.store.upsert("ust_10y", date(year, 1, 1), df, ["date"])
        ctx.note(
            "ust_10y", "ok", data_date=date.fromisoformat(df["date"].max()) if not df.empty else None, rows=len(df)
        )
    except SOURCE_ERRORS as exc:
        ctx.note("ust_10y", "failed", message=err_text(exc)[:300])


def run_tdcc(ctx: RunContext) -> None:
    try:
        res = advanced.parse_tdcc(_fetch(ctx, build_url("tdcc_holders")))
    except SOURCE_ERRORS as exc:
        ctx.note("tdcc_holders", "failed", message=err_text(exc)[:300])
        return
    if res.no_data or res.response_date is None:
        ctx.note("tdcc_holders", "failed", message="集保資料為空")
        return
    if ctx.store.exists("tdcc_holders", res.response_date):
        ctx.note("tdcc_holders", "ok", data_date=res.response_date, rows=len(res.df), message="本週已存在")
        return
    ctx.store.write("tdcc_holders", res.response_date, res.df)
    ctx.note("tdcc_holders", "ok", data_date=res.response_date, rows=len(res.df))


# ------------------------------------------------------------------ 集保個股歷史（大戶／散戶持股的過去一年）
def tdcc_focus_codes(ctx: RunContext) -> list[str]:
    """要補集保歷史的股票：config/ui.yml holders.history 的 codes ＋ 範例自選 ＋ 最近交易日成交值前 N 名（不含 ETF）。"""
    ui = config.ui()
    cfg = ui.get("holders", {}).get("history", {})
    codes = [str(c) for c in cfg.get("codes", [])] + [str(c) for c in ui.get("sample_watchlist", {}).get("codes", [])]
    top = int(cfg.get("top_value", 0))
    if top:
        frames = []
        for sid in ("twse_quotes", "tpex_quotes"):
            ds = ctx.store.dates(sid)
            df = ctx.store.read(sid, ds[-1]) if ds else None
            if df is not None and {"code", "value"} <= set(df.columns):
                frames.append(df[["code", "value"]])
        if frames:
            q = pd.concat(frames)
            q = q[~q["code"].astype(str).str.startswith("00")]
            q["value"] = pd.to_numeric(q["value"], errors="coerce")
            codes += q.sort_values("value", ascending=False)["code"].astype(str).head(top).tolist()
    seen: dict[str, None] = {}
    for c in codes:
        seen.setdefault(c, None)
    return list(seen)[: int(cfg.get("max_codes", 60))]


def _tdcc_have(ctx: RunContext) -> tuple[set[str], set[tuple[str, str]]]:
    """已有的資料：開放資料的週別（整週全部股票）與歷史查詢已補的（週別, 代號）。"""
    weeks = {d.strftime("%Y%m%d") for d in ctx.store.dates("tdcc_holders")}
    pairs: set[tuple[str, str]] = set()
    for d in ctx.store.dates("tdcc_history"):
        df = ctx.store.read("tdcc_history", d)
        if df is not None and "code" in df.columns:
            pairs.update((d.strftime("%Y%m%d"), str(c)) for c in df["code"].unique())
    return weeks, pairs


def tdcc_bad_dates(new: pd.DataFrame, today: date) -> pd.Series:
    """集保個股歷史查詢偶爾回傳錯誤的資料日期（例：2022-10-23 週日、2035-02-28 未來）；
    集保資料日一定是營業日（週一～週五）且不晚於今天。回傳壞日期的布林遮罩（2026-10-02 第二輪：寫入前就擋下，不只在載入時過濾）。"""
    d = pd.to_datetime(new["date"], errors="coerce")
    return d.isna() | (d.dt.weekday >= 5) | (d > pd.Timestamp(today))


def _tdcc_upsert(ctx: RunContext, frames: list[pd.DataFrame]) -> None:
    """依週別寫入 tdcc_history（同一週、同一檔以新資料取代）；壞日期的列不寫入並記在 manifest。"""
    if not frames:
        return
    new = pd.concat(frames, ignore_index=True)
    bad = tdcc_bad_dates(new, ctx.today)
    if bad.any():
        dates = sorted(set(new.loc[bad, "date"].astype(str)))
        log.warning("tdcc_history：%d 列壞日期不寫入（%s）", int(bad.sum()), "、".join(dates[:5]))
        ctx.note("tdcc_history_bad_dates", "skipped", rows=int(bad.sum()), message="、".join(dates[:10]))
        new = new[~bad.to_numpy()]
        if new.empty:
            return
    for iso, part in new.groupby("date"):
        d = date.fromisoformat(str(iso))
        old = ctx.store.read("tdcc_history", d)
        if old is not None and not old.empty:
            old = old[~old["code"].astype(str).isin(set(part["code"].astype(str)))]
            part = pd.concat([old, part], ignore_index=True)
        ctx.store.write("tdcc_history", d, part.sort_values(["code", "level"]).reset_index(drop=True))


def run_tdcc_history(ctx: RunContext, codes: list[str] | None = None) -> None:
    """集保「股權分散表查詢」逐檔逐週補過去一年（官方只保存一年；開放資料只有最新一週）。

    禮貌爬取：沿用 PoliteClient 的間隔與退避；每次執行有請求上限（holders.history.max_requests）；
    可中斷續跑（已有的週別與股票略過）。只在回補時手動執行，不排入每週排程——每週的新資料由開放資料取得。
    """
    cfg = config.ui().get("holders", {}).get("history", {})
    budget = int(cfg.get("max_requests", 1500))
    url = str(config.source("tdcc_history")["url"])
    headers = {"Referer": url, "Origin": "https://www.tdcc.com.tw"}
    codes = codes or tdcc_focus_codes(ctx)
    try:
        token, weeks = advanced.parse_tdcc_form(ctx.client.get_bytes(url))
    except SOURCE_ERRORS as exc:
        ctx.note("tdcc_history", "failed", message=err_text(exc)[:300])
        return
    have_weeks, have_pairs = _tdcc_have(ctx)
    todo = [(c, w) for c in codes for w in weeks if w not in have_weeks and (w, c) not in have_pairs]
    done = 0
    rows = 0
    failed: list[str] = []
    for code in codes:
        frames: list[pd.DataFrame] = []
        for c, week in todo:
            if c != code:
                continue
            if done >= budget or ctx.out_of_time():
                break
            body = {
                "SYNCHRONIZER_TOKEN": token,
                "SYNCHRONIZER_URI": "/portal/zh/smWeb/qryStock",
                "method": "submit",
                "firDate": weeks[0],
                "scaDate": week,
                "sqlMethod": "StockNo",
                "stockNo": code,
                "stockName": "",
            }
            done += 1
            try:
                payload = ctx.client.post_bytes(url, body, headers=headers)
                res = advanced.parse_tdcc_stock(payload, code)
                token = advanced.parse_tdcc_form(payload)[0]
            except CircuitOpenError as exc:
                failed.append(f"{code} {week}：{exc}")
                _tdcc_upsert(ctx, frames)
                ctx.note("tdcc_history", "failed", rows=rows, message="；".join(failed)[:300])
                return
            except SOURCE_ERRORS as exc:
                failed.append(f"{code} {week}：{exc}"[:120])
                try:  # 重新取得表單（token 可能已失效）
                    token = advanced.parse_tdcc_form(ctx.client.get_bytes(url))[0]
                except SOURCE_ERRORS:
                    break
                continue
            if res.no_data:
                break  # 這檔查無資料（例：未掛牌、代號不存在），不再查其他週
            frames.append(res.df)
            rows += len(res.df)
        _tdcc_upsert(ctx, frames)
        if done >= budget or ctx.out_of_time():
            break
    remaining = len(todo) - done
    status = "ok" if not failed or rows else "failed"
    message = f"{len(codes)} 檔、{done} 次查詢；剩餘 {max(0, remaining)} 次" + (
        f"；失敗：{'；'.join(failed[:3])}" if failed else ""
    )
    ctx.note("tdcc_history", status, rows=rows, message=message[:300])


# ------------------------------------------------------------------ 集保個股歷史：全市場回補（M0）
FULL_KEY = "holders_backfill"


def tdcc_full_codes(ctx: RunContext, days: int = 370) -> list[str]:
    """全市場普通股：近 days 天內任一交易日出現在上市／上櫃收盤行情的 4 碼普通股（含之後下市者，避免存活者偏差）。

    依最近一日成交值由大到小排序（同一週內先查流動性高的股票）。ETF、ETN、存託憑證、受益證券不查。
    """
    from pipeline.core.normalize import is_common_stock

    value: dict[str, float] = {}
    cutoff = ctx.today - timedelta(days=days)
    for sid in ("twse_quotes", "tpex_quotes"):
        for d in ctx.store.dates(sid):
            if d < cutoff:
                continue
            df = ctx.store.read(sid, d)
            if df is None or "code" not in df.columns:
                continue
            vals = pd.to_numeric(df["value"], errors="coerce") if "value" in df.columns else None
            for i, code in enumerate(df["code"].astype(str)):
                if is_common_stock(code):
                    v = float(vals.iloc[i]) if vals is not None and vals.iloc[i] == vals.iloc[i] else 0.0
                    value[code] = v  # 日期由舊到新，最後留下最近一日
    return sorted(value, key=lambda c: (-value[c], c))


def full_progress(
    state: dict[str, Any], total: int, remaining: int, per_query: float, now: Any, lanes: int = 1
) -> dict[str, Any]:
    """回補進度與預估完成時間（寫入 manifest[holders_backfill]）。

    預估：剩餘查詢 × 每次實測秒數 ÷ 道數 ÷ 可用比例。可用比例＝(一週 168 小時 − 5 個交易日 × 9 小時的暫停時段) ÷ 168
    × 分段銜接損耗 0.9 ≈ 0.66（交易日 13:30–22:30 不開始新的一段）。
    """
    avail = (168 - 5 * 9) / 168 * 0.9
    hours = remaining * per_query / 3600 / max(1, lanes)
    eta = now + timedelta(hours=hours / avail) if remaining else now
    return {
        **state,
        "total": total,
        "remaining": remaining,
        "done": total - remaining,
        "per_query_sec": round(per_query, 2),
        "runtime_hours_left": round(hours, 1),
        "eta": eta.isoformat(timespec="minutes"),
        "updated_at": now.isoformat(timespec="minutes"),
    }


def parse_lane(source: str | None) -> tuple[int, int] | None:
    """holders_backfill 的 source 輸入：「lane=k/n」→ (k, n)；其他（空白、「lanes=n」）→ None（由分派者處理）。"""
    m = re.fullmatch(r"\s*lane=(\d+)/(\d+)\s*", source or "")
    if not m:
        return None
    k, n = int(m.group(1)), int(m.group(2))
    return (k, n) if 0 <= k < n else None


def parse_lanes(source: str | None, default: int) -> int:
    """分派者的 source：「lanes=n」→ n；空白 → default（main 的 22:40 接續與停擺重啟都送空白）。"""
    m = re.fullmatch(r"\s*lanes=(\d+)\s*", source or "")
    return max(1, int(m.group(1))) if m else default


def lane_of(week: str, n: int) -> int:
    """週別（資料日 YYYYMMDD）→ 平行回補的道次。依 ISO 週（週一起算）的序號取餘數，不依清單位置：

    官方每週六新增一週、刪掉最舊一週，清單位置會變，但同一週永遠在同一道；資料日是週四（週五休市）或週六補班也不變。
    同一週的檔案只由同一道寫入（raw/tdcc_history/{週}.csv.gz），兩道同時推送不會互相覆蓋。
    """
    d = date(int(week[:4]), int(week[4:6]), int(week[6:8]))
    return ((d.toordinal() - 1) // 7) % n


def run_tdcc_full(
    ctx: RunContext, codes: list[str] | None = None, lane: tuple[int, int] | None = None
) -> dict[str, Any]:
    """集保「股權分散表查詢」全市場回補過去一年（M0）：逐週（由舊到新）× 逐檔。

    - 官方只保存約 51 週，最舊的週最先消失 → 由最舊的週開始查。
    - 已有的週別（開放資料整週全部股票）與已補的（週, 代號）略過；查無資料的（週, 代號）記在 manifest，不再重查。
    - 禮貌爬取：PoliteClient（3–5 秒間隔＋抖動、退避、斷路器）；時間預算由 ctx.deadline 控制（每段 40 分鐘）。
    - 進度與預估完成時間寫入 manifest[holders_backfill]。
    - lane＝(k, n)：v3 起分成 n 道平行（各自的 concurrency group），這一道只查 lane_of(週, n) == k 的週；
      進度（total／remaining）仍以全部週別計算，預估時間除以道數。
    """
    url = str(config.source("tdcc_history")["url"])
    headers = {"Referer": url, "Origin": "https://www.tdcc.com.tw"}
    state: dict[str, Any] = dict(ctx.manifest.get(FULL_KEY) or {})
    nodata: dict[str, list[str]] = {k: list(v) for k, v in (state.get("nodata") or {}).items()}
    codes = codes or tdcc_full_codes(ctx)
    try:
        token, weeks = advanced.parse_tdcc_form(ctx.client.get_bytes(url))
    except SOURCE_ERRORS as exc:
        ctx.note("tdcc_history", "failed", message=err_text(exc)[:300])
        return {"remaining": int(state.get("remaining") or 1), "progressed": False}
    have_weeks, have_pairs = _tdcc_have(ctx)
    skip = {(w, c) for c, ws in nodata.items() for w in ws}
    all_todo = [
        (w, c)
        for w in sorted(weeks)
        if w not in have_weeks
        for c in codes
        if (w, c) not in have_pairs and (w, c) not in skip
    ]
    todo = [(w, c) for w, c in all_todo if lane is None or lane_of(w, lane[1]) == lane[0]]
    total = len(have_pairs & {(w, c) for w in weeks for c in codes}) + len(skip) + len(all_todo)
    done = rows = 0
    failed: list[str] = []
    frames: list[pd.DataFrame] = []
    started = ctx.client.request_count
    t0 = time.monotonic()
    new_nodata = 0
    for i, (week, code) in enumerate(todo):
        if ctx.out_of_time():
            break
        body = {
            "SYNCHRONIZER_TOKEN": token,
            "SYNCHRONIZER_URI": "/portal/zh/smWeb/qryStock",
            "method": "submit",
            "firDate": weeks[0],
            "scaDate": week,
            "sqlMethod": "StockNo",
            "stockNo": code,
            "stockName": "",
        }
        done += 1
        try:
            payload = ctx.client.post_bytes(url, body, headers=headers)
            res = advanced.parse_tdcc_stock(payload, code)
            token = advanced.parse_tdcc_form(payload)[0]
        except CircuitOpenError as exc:
            failed.append(f"{code} {week}：{exc}"[:120])
            break
        except SOURCE_ERRORS as exc:
            failed.append(f"{code} {week}：{exc}"[:120])
            try:  # 重新取得表單（token 可能已失效）
                token = advanced.parse_tdcc_form(ctx.client.get_bytes(url))[0]
            except SOURCE_ERRORS:
                break
            continue
        if res.no_data:
            nodata.setdefault(code, []).append(week)
            new_nodata += 1
        else:
            frames.append(res.df)
            rows += len(res.df)
        # 每 200 次或換週時存檔，分段中斷也不會丟掉已查到的資料
        nxt = todo[i + 1][0] if i + 1 < len(todo) else None
        if len(frames) >= 200 or nxt != week:
            _tdcc_upsert(ctx, frames)
            frames = []
    _tdcc_upsert(ctx, frames)
    elapsed = time.monotonic() - t0
    asked = ctx.client.request_count - started
    per_query = elapsed / asked if asked else float(state.get("per_query_sec") or 4.6)
    remaining = len(todo) - done + len(failed)  # 失敗的（週, 代號）下一段重查（這一道）
    remaining_all = len(all_todo) - done + len(failed)
    lanes = lane[1] if lane else 1
    state["nodata"] = nodata
    state.setdefault("started_at", ctx.now.isoformat(timespec="minutes"))
    state["weeks"] = len(weeks)
    state["codes"] = len(codes)
    state["oldest_week"] = min(weeks)
    state["segments"] = int(state.get("segments") or 0) + 1
    state["ref"] = os.environ.get("GITHUB_REF_NAME", state.get("ref") or "main")
    state["lanes"] = lanes
    if lane:
        info = dict(state.get("lane_state") or {})
        info[f"{lane[0]}/{lane[1]}"] = {
            "remaining": max(0, remaining),
            "per_query_sec": round(per_query, 2),
            "updated_at": ctx.now.isoformat(timespec="minutes"),
        }
        state["lane_state"] = info
    ctx.manifest[FULL_KEY] = full_progress(state, total, max(0, remaining_all), per_query, ctx.now, lanes)
    status = "ok" if rows or not failed else "failed"
    tag = f"（第 {lane[0] + 1}／{lane[1]} 道）" if lane else ""
    message = (
        f"全市場 {len(codes)} 檔 × {len(weeks)} 週{tag}：本段 {done} 次查詢；這一道剩餘 {max(0, remaining)} 次、全部剩餘 {max(0, remaining_all)} 次"
        + (f"；失敗：{'；'.join(failed[:3])}" if failed else "")
    )
    ctx.note("tdcc_history", status, rows=rows, message=message[:300])
    return {
        "remaining": max(0, remaining),
        "progressed": rows > 0 or new_nodata > 0,
        "by_source": {"tdcc_full": max(0, remaining)},
    }


# ------------------------------------------------------------------ v3 M1：終止上櫃（依年份）
def run_tpex_delisted(ctx: RunContext) -> None:
    """櫃買終止上櫃名單：每年查「全部」與「轉上市」兩次（2015 起約 24 次請求），合併成一份快照，內容變動才存。"""
    from pipeline.sources import listing

    tmpl = str(config.source("tpex_delisted")["url"])
    since = int(config.source("tpex_delisted").get("since", 2015))
    frames = []
    try:
        for y in range(since, ctx.today.year + 1):
            for reason, transfer in (("-1", False), ("2", True)):
                res = listing.parse_tpex_delisted(_fetch(ctx, tmpl.format(year=y, reason=reason)), transfer=transfer)
                frames.append(res.df)
    except SOURCE_ERRORS as exc:
        ctx.note("tpex_delisted", "failed", message=err_text(exc)[:300])
        return
    df = listing.combine_delisted(frames)
    latest = ctx.store.latest("tpex_delisted")
    if latest is not None and latest[1].astype(str).reset_index(drop=True).equals(df.astype(str)):
        ctx.note("tpex_delisted", "ok", rows=len(df), message="內容未變動")
        return
    ctx.store.write("tpex_delisted", ctx.today, df)
    ctx.note("tpex_delisted", "ok", rows=len(df))


# ------------------------------------------------------------------ 選配：央行貨幣總計數、法說會
def run_cbc_money(ctx: RunContext) -> None:
    """央行 M1B／M2（日平均，月資料）：整份 CSV 以最新月份存成一份快照。"""
    from pipeline.sources import optional

    try:
        df = optional.parse_cbc_money(_fetch(ctx, str(config.source("cbc_money")["url"]))).df
    except SOURCE_ERRORS as exc:
        ctx.note("cbc_money", "failed", message=err_text(exc)[:300])
        return
    latest = df.dropna(subset=["m1b_yoy", "m2_yoy"]).iloc[-1]
    key = date(int(latest["ym"][:4]), int(latest["ym"][5:7]), 1)
    if ctx.store.exists("cbc_money", key):
        ctx.note("cbc_money", "ok", data_date=key, rows=len(df), message="本月已存在")
        return
    ctx.store.write("cbc_money", key, df)
    ctx.note("cbc_money", "ok", data_date=key, rows=len(df))


def run_conference(ctx: RunContext, month: date) -> None:
    """公開資訊觀測站法人說明會（上市＋上櫃），依召開月份存檔。"""
    from pipeline.sources import optional

    tmpl = str(config.source("investor_conference")["url"])
    frames = []
    try:
        for typek in ("sii", "otc"):
            url = tmpl.format(typek=typek, roc=month.year - 1911, month=f"{month.month:02d}")
            frames.append(optional.parse_conference(_fetch(ctx, url)).df)
    except SOURCE_ERRORS as exc:
        ctx.note("investor_conference", "failed", data_date=month, message=err_text(exc)[:300])
        return
    df = pd.concat(frames, ignore_index=True).drop_duplicates(["date", "code", "time"])
    if df.empty:
        ctx.note("investor_conference", "no_data", data_date=month, message="該月尚無法說會")
        return
    ctx.store.upsert("conference", month_start(month), df, ["date", "code", "time"])
    ctx.note("investor_conference", "ok", data_date=month, rows=len(df))


# ------------------------------------------------------------------ 主動式 ETF 每日持股（各投信官網，部分涵蓋）
HOLDING_KEYS = ["date", "etf", "code"]
HEAL_DAYS = 3  # 投信多在當晚或次一營業日早上公布，最近 3 個交易日缺的都再試一次
BACKFILL_EMPTY_STOP = 10  # 回補時同一檔 ETF 連續 10 個交易日查無資料（早於掛牌或超過網站保留期間）就停止往前


def active_etf_names(ctx: RunContext) -> dict[str, str]:
    """主動式 ETF 清單（代號 00xxxA）與行情名稱（用來判定發行投信），取自最新一份收盤行情。"""
    from pipeline.derive.etf import ACTIVE_RE

    out: dict[str, str] = {}
    for sid in ("twse_quotes", "tpex_quotes"):
        latest = ctx.store.latest(sid)
        if latest is None:
            continue
        df = latest[1]
        for code, name in zip(df["code"].astype(str), df["name"].astype(str), strict=True):
            if ACTIVE_RE.match(code):
                out[code] = name
    return out


class _EtfFetcher:
    """依投信呼叫對應端點；群益、國泰需要先查「ETF 代號 → 內部基金代碼」，每輪只查一次；
    凱基、第一金、復華的官網沒有可解析的代號清單，內部基金代碼改在 config（issuers.*.funds）維護。"""

    def __init__(self, ctx: RunContext, issuers: dict[str, dict[str, Any]]):
        self.ctx = ctx
        self.issuers = issuers
        self._maps: dict[str, dict[str, str]] = {}
        self._tokens: dict[str, str] = {}
        self.list_failed: set[str] = set()

    def _config_fund(self, issuer: str, etf: str) -> str | None:
        funds = self.issuers[issuer].get("funds") or {}
        return str(funds[etf]) if etf in funds else None

    def _fund_map(self, issuer: str) -> dict[str, str]:
        from pipeline.sources import etf_holdings as eh

        if issuer not in self._maps:
            cfg = self.issuers[issuer]
            try:
                if issuer == "capital":
                    self._maps[issuer] = eh.parse_capital_items(self.ctx.client.post_json(str(cfg["list_url"]), {}))
                elif issuer == "uni":
                    self._maps[issuer] = eh.parse_uni_funds(_fetch(self.ctx, str(cfg["list_url"])))
                elif issuer == "ctbc":
                    token_url = str(cfg["token_url"])
                    self._tokens[issuer] = eh.parse_ctbc_token(self.ctx.client.post_json(token_url, {}))
                    q = f"{cfg['list_url']}?token={quote(self._tokens[issuer], safe='')}"
                    self._maps[issuer] = eh.parse_ctbc_list(self.ctx.client.post_json(q, {}))
                elif issuer == "allianz":
                    _fetch(self.ctx, str(cfg["page_url"]))  # 建立工作階段 cookie（權杖與 cookie 綁定）
                    self._tokens[issuer] = eh.parse_allianz_token(_fetch(self.ctx, str(cfg["token_url"])))
                    h = {"X-XSRF-TOKEN": self._tokens[issuer], "Referer": str(cfg["page_url"])}
                    type_id = eh.parse_allianz_type(self.ctx.client.post_json(str(cfg["types_url"]), {}, h))
                    self._maps[issuer] = eh.parse_allianz_funds(
                        self.ctx.client.post_json(str(cfg["list_url"]), {"TypeId": type_id}, h)
                    )
                else:
                    self._maps[issuer] = eh.parse_cathay_list(_fetch(self.ctx, str(cfg["list_url"])))
            except SOURCE_ERRORS:
                self.list_failed.add(issuer)  # 清單取不到，本輪不再請求該投信
                raise
        return self._maps[issuer]

    def fetch(self, issuer: str, etf: str, d: date | None) -> ParseResult:
        """d 為查詢日（群益、元大為公告日）；None 表示取最新一份（群益、元大支援；其餘以今天查詢）。"""
        from pipeline.sources import etf_holdings as eh

        cfg = self.issuers[issuer]
        url = str(cfg["url"])
        day = d or self.ctx.today
        if issuer == "nomura":
            raw = self.ctx.client.post_json(url, {"FundID": etf, "SearchDate": day.isoformat()})
            return eh.parse_nomura(raw, etf)
        if issuer == "capital":
            fund = self._fund_map(issuer).get(etf)
            if fund is None:
                return ParseResult(pd.DataFrame(), no_data=True, message=f"群益基金清單沒有 {etf}")
            body = {"fundId": fund, "date": slash(d) if d else None}
            return eh.parse_capital(self.ctx.client.post_json(url, body), etf)
        if issuer == "yuanta":
            q = url.format(etf=etf) + (f"&date={d.strftime('%Y%m%d')}" if d else "")
            return eh.parse_yuanta(_fetch(self.ctx, q), etf)
        if issuer == "fubon":
            res = eh.parse_fubon(_fetch(self.ctx, url.format(etf=etf, slash=slash(day))), etf)
            if d and res.response_date and res.response_date != d:
                # 網站在查無資料時回傳最近一個有資料的日期：視為「該日尚未公布」，但資料仍可寫入
                res.message = f"查詢 {d} 回傳 {res.response_date} 的資料"
            return res
        if issuer == "cathay":
            fund = self._fund_map(issuer).get(etf)
            if fund is None:
                return ParseResult(pd.DataFrame(), no_data=True, message=f"國泰基金清單沒有 {etf}")
            return eh.parse_cathay(_fetch(self.ctx, url.format(fund=fund, slash=slash(day))), etf, day)
        if issuer == "taishin":
            # DataDate＝申購買回清單適用日；不帶＝網站最新一份
            q = url.format(etf=etf) + (f"&DataDate={d.isoformat()}" if d else "")
            return eh.parse_taishin(_fetch(self.ctx, q), etf)
        if issuer == "ab":
            # date＝持股日；不帶＝最新
            q = url.format(isin=eh.isin_of(etf)) + (f"?date={d.isoformat()}" if d else "")
            return eh.parse_ab(_fetch(self.ctx, q), etf)
        if issuer in ("kgi", "fsitc", "fhtrust"):
            fund = self._config_fund(issuer, etf)
            if fund is None:
                return ParseResult(pd.DataFrame(), no_data=True, message=f"{cfg['label']}：config 的 funds 沒有 {etf}")
            if issuer == "kgi":
                # jQuery .load 的局部頁面：POST 表單；queryDate＝清單適用日，空字串＝最新
                form = {"fundID": fund, "queryDate": slash(d) if d else ""}
                return eh.parse_kgi(self.ctx.client.post_bytes(url, form), etf)
            if issuer == "fsitc":
                # ASP.NET WebMethod：POST JSON；pStrDate＝公告日，空字串＝最新
                body = {"pStrFundID": fund, "pStrDate": slash(d) if d else ""}
                res = eh.parse_fsitc(self.ctx.client.post_json(url, body), etf)
                if not res.df.empty and cfg.get("units_url"):
                    # §3.4：受益權單位數在同一公告日的申購買回清單摘要（另一個 WebMethod）；取不到不影響持股
                    try:
                        units = eh.parse_fsitc_units(self.ctx.client.post_json(str(cfg["units_url"]), body))
                    except SOURCE_ERRORS:
                        units = None
                    res.df["units"] = units if units and units > 0 else None
                return res
            return eh.parse_fhtrust(_fetch(self.ctx, url.format(fund=fund, ymd=day.strftime("%Y%m%d"))), etf)
        if issuer == "uni":
            # PCF 頁取「代號 → 基金代碼」並建立工作階段 cookie；GetPCF 的 date＝公告日（民國），specificDate＝True 查該日，
            # False＋未來日＝最新一份
            fund = self._fund_map(issuer).get(etf)
            if fund is None:
                return ParseResult(pd.DataFrame(), no_data=True, message=f"統一 PCF 頁沒有 {etf}")
            ask = d or self.ctx.today + timedelta(days=3)
            pcf: dict[str, Any] = {
                "fundCode": fund,
                "date": f"{ask.year - 1911}/{ask:%m/%d}",
                "specificDate": d is not None,
            }
            return eh.parse_uni(self.ctx.client.post_json(url, pcf, {"Referer": str(cfg["list_url"])}), etf)
        if issuer == "ctbc":
            # 匿名工作階段權杖（網站發給每位訪客，不需登入）；StartDate 回該日（含）以前最近一次揭露
            fund = self._fund_map(issuer).get(etf)
            if fund is None:
                return ParseResult(pd.DataFrame(), no_data=True, message=f"中信 ETFList 沒有 {etf}")
            q = f"{url}?token={quote(self._tokens[issuer], safe='')}"
            return eh.parse_ctbc(self.ctx.client.post_json(q, {"FID": fund, "StartDate": slash(day)}), etf)
        if issuer == "allianz":
            # Date＝申購買回清單公告日；POST 需帶防偽權杖（與工作階段 cookie 綁定）
            fund = self._fund_map(issuer).get(etf)
            if fund is None:
                return ParseResult(pd.DataFrame(), no_data=True, message=f"安聯基金清單沒有 {etf}")
            trade: dict[str, Any] = {"Type": 1, "Keyword": "", "FundNo": fund, "Date": day.isoformat()}
            return eh.parse_allianz(self.ctx.client.post_json(url, trade, self._allianz_headers()), etf)
        if issuer == "jpmorgan":
            # date＝持股日；沒有資料回 HTTP 404（視為查無，不停用投信）
            q = url.format(isin=eh.isin_of(etf), kind="holding_pcf", day=day.isoformat())
            try:
                res = eh.parse_jpmorgan(_fetch(self.ctx, q), etf)
            except FetchError as exc:
                if "HTTP 404" in str(exc):
                    return ParseResult(pd.DataFrame(), no_data=True, message=f"摩根：{day} 查無持股")
                raise
            if not res.df.empty and res.response_date:
                # 受益權單位數在之後第 units_lag 個交易日公告的現金申購買回清單（m12_pcf；美股型晚 2 日），
                # 淨值日＝持股日才採用；取不到不影響持股
                lag = int((cfg.get("units_lag_by_etf") or {}).get(etf, 1))
                d0 = res.response_date
                nxt = self.ctx.calendar.trading_days(d0 + timedelta(days=1), d0 + timedelta(days=lag * 7 + 10))
                if len(nxt) >= lag and nxt[lag - 1] <= self.ctx.today:
                    try:
                        q = url.format(isin=eh.isin_of(etf), kind="m12_pcf", day=nxt[lag - 1].isoformat())
                        raw = _fetch(self.ctx, q)
                        nav_d, units, aum = eh.parse_jpmorgan_units(raw)
                    except SOURCE_ERRORS:
                        nav_d, units, aum = None, None, None
                    if nav_d == res.response_date:
                        res.df["units"] = units if units and units > 0 else None
                        res.df["aum"] = aum if aum and aum > 0 else None
            return res
        if issuer == "sinopac":
            # 只有最新一份（網址不吃日期）；request_date 一律為 None，每輪每檔只請求一次
            return eh.parse_sinopac(_fetch(self.ctx, url.format(etf=etf)), etf)
        raise ParseError(f"未實作的投信：{issuer}")

    def _allianz_headers(self) -> dict[str, str]:
        self._fund_map("allianz")  # 權杖在取基金清單時建立
        return {"X-XSRF-TOKEN": self._tokens["allianz"], "Referer": str(self.issuers["allianz"]["page_url"])}


def _replace_holdings(ctx: RunContext, df: pd.DataFrame) -> None:
    """同一檔 ETF 同一天的持股整批取代（被賣光的個股不殘留），依月份存檔。"""
    for key, part in df.groupby(pd.to_datetime(df["date"]).dt.to_period("M")):
        month = key.to_timestamp().date()
        old = ctx.store.read("etf_holdings", month)
        if old is not None and not old.empty:
            pairs = set(zip(part["date"], part["etf"], strict=True))
            keep = [(d, e) not in pairs for d, e in zip(old["date"], old["etf"], strict=True)]
            part = pd.concat([old[keep], part], ignore_index=True)
        ctx.store.write("etf_holdings", month, part.sort_values(HOLDING_KEYS).reset_index(drop=True))


def run_etf_holdings(ctx: RunContext, target: date, days: list[date] | None = None) -> int:
    """抓取已實作投信的主動式 ETF 持股；以「持股日」為單位判斷缺漏。

    群益、元大以申購買回清單的公告日查詢，回應的是 lag_days 個交易日之前的持股（config 設定），
    因此要取得持股日 X，就查詢 X 之後第 lag_days 個交易日；該日還沒到時改查最新一份。
    每日（days 為 None）：最近 HEAL_DAYS 個交易日中缺的持股日都再試一次；第一次抓到的 ETF 若不到兩天
    （無法計算加碼／減碼），再往回補到 backfill_days 個交易日內取得第二天為止（之後的每日任務自然累積）。
    回補（days 指定）：逐日抓取缺的持股日（由近到遠，受時間預算限制）。
    同一家投信出現 HTTP 4xx 或斷路器開啟時，本輪不再請求該投信。
    回傳：時間預算用完時還沒處理完的 ETF 檔數（回補據此接力下一段；2026-10-09 以前回補用完時間也回報 0，不會接力）。
    """
    from pipeline.sources import etf_holdings as eh

    cfg = config.source("active_etf")
    issuers: dict[str, dict[str, Any]] = cfg["issuers"]
    names = active_etf_names(ctx)
    if not names:
        ctx.note("active_etf", "failed", data_date=target, message="找不到主動式 ETF 清單（需先有收盤行情）")
        return 0
    targets = {
        code: iss
        for code, name in sorted(names.items())
        if (iss := eh.issuer_of(name, issuers)) and issuers[iss].get("status") == "verified"
    }
    stored = ctx.store.read_range("etf_holdings")
    have: dict[str, set[str]] = {}
    if not stored.empty:
        # §3.4（2026-10-03）：有揭露受益權單位數的投信，舊資料（沒有 units 欄）視為缺漏，回補時重抓
        has_units = stored["units"].notna() if "units" in stored.columns else pd.Series(False, index=stored.index)
        # 2026-10-09：有海外持股的 ETF，舊資料（存檔時略過海外持股、沒有 foreign 欄）視為缺漏，回補時重抓
        from pipeline.derive.etf import foreign_flags

        flags = foreign_flags(stored)
        foreign_etfs = set(stored.loc[flags.eq(True), "etf"].astype(str))  # flags 含 NaN（未知）
        known = flags.notna()
        for d_, e_, u_, k_ in set(
            zip(
                stored["date"].astype(str),
                stored["etf"].astype(str),
                has_units.astype(bool),
                known.astype(bool),
                strict=True,
            )
        ):
            if e_ in foreign_etfs and not k_:
                continue
            if u_ or eh.UNITS_FIELD.get(targets.get(e_, ""), None) is None:
                have.setdefault(e_, set()).add(d_)
    lookback = int(cfg.get("backfill_days", 20))
    recent = ctx.calendar.trading_days(target - timedelta(days=lookback * 2 + 14), target)[::-1]
    fetcher = _EtfFetcher(ctx, issuers)
    frames: list[pd.DataFrame] = []
    errors: list[str] = []
    dead_issuers: set[str] = set()
    asked: set[tuple[str, date | None]] = set()

    def request_date(issuer: str, etf: str, x: date) -> date | None:
        icfg = issuers[issuer]
        if icfg.get("latest_only"):
            return None  # 網站只有最新一份（永豐）
        lag = int((icfg.get("lag_days_by_etf") or {}).get(etf, icfg.get("lag_days", 0)))
        if lag == 0:
            return x
        after = ctx.calendar.trading_days(x + timedelta(days=1), x + timedelta(days=lag * 7 + 21))
        if len(after) < lag or after[lag - 1] > ctx.today:
            return None  # 公告日還沒到 → 查最新一份
        return after[lag - 1]

    def attempt(issuer: str, etf: str, x: date) -> bool | None:
        """True＝取得持股；False＝查無或失敗；None＝未請求（已問過、投信停用、超時）。"""
        d = request_date(issuer, etf, x)
        if issuer in dead_issuers or (etf, d) in asked or ctx.out_of_time():
            return None
        asked.add((etf, d))
        try:
            res = fetcher.fetch(issuer, etf, d)
        except SOURCE_ERRORS as exc:
            errors.append(f"{etf}（{issuers[issuer]['label']}）：{str(exc)[:120]}")
            if isinstance(exc, CircuitOpenError) or "HTTP 4" in str(exc) or issuer in fetcher.list_failed:
                dead_issuers.add(issuer)
            return False
        if res.df.empty:
            return False
        frames.append(res.df)
        have.setdefault(etf, set()).add(str(res.df["date"].iloc[0]))
        return True

    unfinished = 0
    for n_done, (etf, issuer) in enumerate(targets.items()):
        if ctx.out_of_time():
            unfinished = len(targets) - n_done  # 這一檔與之後的都還沒處理（下一段由已存的持股日接著補）
            break
        first_time = etf not in have
        todo = days if days is not None else recent[:HEAL_DAYS]
        empty_run = 0
        for x in todo:
            if days is not None and empty_run >= BACKFILL_EMPTY_STOP:
                break  # 回補由近到遠：連續查無代表已早於掛牌（或網站保留期限），不再往前請求
            if ctx.out_of_time():
                break
            if x.isoformat() not in have.get(etf, set()):
                got = attempt(issuer, etf, x)
                if got is not None:
                    empty_run = 0 if got else empty_run + 1
        if ctx.out_of_time() and days is not None:
            unfinished = len(targets) - n_done
            break
        for x in recent[HEAL_DAYS:lookback] if days is None and first_time else []:
            if len(have.get(etf, set())) >= 2:
                break
            if x.isoformat() not in have.get(etf, set()):
                attempt(issuer, etf, x)

    if frames:
        _replace_holdings(ctx, pd.concat(frames, ignore_index=True))
    ok_etfs = {e for e in targets if have.get(e)}
    covered = sorted({issuers[i]["label"] for i in targets.values()})
    summary = (
        f"已取得 {len(ok_etfs)}/{len(names)} 檔主動式 ETF 持股（{'、'.join(covered)}）；"
        f"其餘投信因反爬、導向循環、驗證機制或尚未找到端點而未涵蓋"
    )
    if errors:
        summary += f"；失敗 {len(errors)} 次：" + "；".join(errors[:3])
    latest = max((d for e in ok_etfs for d in have.get(e, set())), default=None)
    rows = sum(len(f) for f in frames)
    status = "failed" if errors and not frames else "ok"
    ctx.note("active_etf", status, data_date=date.fromisoformat(latest) if latest else None, rows=rows, message=summary)
    return unfinished
