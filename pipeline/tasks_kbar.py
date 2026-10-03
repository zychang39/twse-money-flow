"""盤中走勢（2026-10 改版）：個股 5 分鐘 K（Yahoo Finance，非官方）與加權指數 1D 備援。

個股 5 分 K（task=kbar；SPEC §3.2 來源評估見 docs/DATA_SOURCES.md）：
- 每檔每日一次請求（range=5d 一次回傳最近 5 個交易日），節流 1–2 次／秒（含抖動）、失敗重試（PoliteClient）。
- 優先順序：近 20 日成交金額前 500 名 → 近 60 日任一策略觸發過（已部署網站的 signals.json）→ 其餘（依成交金額）。
- 可續傳：目標日檔案裡已有的代號視為完成；查無 K 棒的代號記在 manifest `kbar.empty`；進度寫在 manifest `kbar`。
- 存檔：raw/yahoo_kbar/{YYYY}/{YYYYMMDD}.csv.gz（一個交易日一檔、所有股票），只保留最近 keep_days 個交易日。

加權指數 1D 備援（每日任務內呼叫）：證交所「每 5 秒指數統計」在已收盤的交易日仍取不到時，
改抓 Yahoo ^TWII 1 分鐘 K 存成 raw/yahoo_twii（build-web 標示 fallback）。
"""

from __future__ import annotations

import json
import logging
from datetime import date, timedelta
from typing import Any

import pandas as pd

from pipeline.core import config
from pipeline.core.http import CircuitOpenError, PoliteClient
from pipeline.core.normalize import is_security_code
from pipeline.sources import yahoo

log = logging.getLogger(__name__)

KBAR = "yahoo_kbar"
TWII = "yahoo_twii"
INTRADAY = "twse_intraday_index"
FLUSH_EVERY = 200


def kbar_cfg() -> dict[str, Any]:
    return dict(config.source(KBAR))


def kbar_client() -> PoliteClient:
    """1–2 次／秒（delay 0.5–1.0 秒＋抖動）；重試、斷路器沿用全域設定。"""
    c = PoliteClient.from_config()
    lo, hi = kbar_cfg().get("delay_seconds", [0.5, 1.0])
    c.delay = (float(lo), float(hi))
    # Yahoo 拒絕預設的 python-requests／自訂 UA 時回 429；用一般瀏覽器 UA（不偽裝登入、不帶 cookie）
    c.user_agent = "Mozilla/5.0 (compatible; twse-money-flow/1.0; +https://github.com/zychang39/twse-money-flow)"
    return c


# ------------------------------------------------------------------ 優先順序
def _recent_quotes(store: Any, days: list[date]) -> pd.DataFrame:
    frames = []
    for d in days:
        for sid, mk in (("twse_quotes", "twse"), ("tpex_quotes", "tpex")):
            df = store.read(sid, d)
            if df is not None and not df.empty:
                frames.append(df[["date", "code", "close", "value"]].assign(market=mk))
    return pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()


def triggered_codes(signals: dict[str, Any] | None, days: int) -> set[str]:
    """signals.json（已部署）：presets[].triggers {date: [code]} 中最近 days 個日期出現過的代號。"""
    if not signals:
        return set()
    dates = sorted({d for p in signals.get("presets") or [] for d in (p.get("triggers") or {})})[-days:]
    keep = set(dates)
    out: set[str] = set()
    for p in signals.get("presets") or []:
        for d, codes in (p.get("triggers") or {}).items():
            if d in keep:
                out.update(str(c) for c in codes)
    return out


def priority_universe(quotes: pd.DataFrame, triggered: set[str], top: int = 500) -> list[tuple[str, str, int]]:
    """(代號, 市場, 優先級 1/2/3)。範圍＝近 20 日有收盤的證券（與個股頁同一個範圍：build 的 active）。"""
    if quotes.empty:
        return []
    q = quotes[quotes["code"].map(is_security_code)]
    q = q[q["close"].notna()]
    agg = (
        q.groupby("code").agg(value=("value", "mean"), market=("market", "last")).sort_values("value", ascending=False)
    )
    ranked = list(agg.index)
    top_set = set(ranked[:top])
    out = []
    for code in ranked:
        tier = 1 if code in top_set else 2 if code in triggered else 3
        out.append((str(code), str(agg.at[code, "market"]), tier))
    out.sort(key=lambda x: x[2])  # 穩定排序：同優先級內維持成交金額由大到小
    return out


def _load_signals(client: PoliteClient, url: str | None) -> dict[str, Any] | None:
    if not url:
        return None
    try:
        data: dict[str, Any] = json.loads(client.get_bytes(url))
        return data
    except Exception as exc:  # 選用：取不到就略過優先級 2
        log.warning("signals.json 取不到（略過「近 60 日策略觸發」優先級）：%s", exc)
        return None


# ------------------------------------------------------------------ 寫檔
def flush(store: Any, frames: list[pd.DataFrame], allowed: set[str]) -> int:
    if not frames:
        return 0
    df = pd.concat(frames, ignore_index=True)
    df = df[df["date"].isin(allowed)]
    for d, part in df.groupby("date"):
        store.upsert(KBAR, date.fromisoformat(str(d)), part.reset_index(drop=True), ("code", "time"))
    return len(df)


def prune(store: Any, keep: list[date]) -> int:
    """刪除不在最近 keep 個交易日內的 K 棒檔。"""
    removed = 0
    cutoff = min(keep) if keep else None
    for d in store.dates(KBAR):
        if cutoff is not None and d < cutoff:
            store.path(KBAR, d).unlink(missing_ok=True)
            removed += 1
    return removed


def done_codes(store: Any, target: date) -> set[str]:
    df = store.read(KBAR, target)
    return set(df["code"].astype(str)) if df is not None and not df.empty else set()


def run_kbar(ctx: Any, *, codes: list[str] | None = None, limit: int | None = None) -> dict[str, Any]:
    """抓取個股 5 分 K。codes：只抓指定代號（本機驗證）；limit：最多抓幾檔。回傳 {remaining, progressed, ...}。"""
    from pipeline import tasks

    cfg = kbar_cfg()
    tasks.load_calendar(ctx, [ctx.today.year, (ctx.today - timedelta(days=20)).year])
    target = tasks.target_trading_date(ctx)
    keep_n = int(cfg.get("keep_days", 10))
    keep = ctx.calendar.trading_days(target - timedelta(days=keep_n * 2 + 20), target)[-keep_n:]
    recent20 = ctx.calendar.trading_days(target - timedelta(days=45), target)[-20:]
    client = kbar_client()
    quotes = _recent_quotes(ctx.store, recent20)
    signals = _load_signals(client, cfg.get("signals_url")) if codes is None else None
    universe = priority_universe(
        quotes, triggered_codes(signals, int(cfg.get("trigger_days", 60))), int(cfg.get("top_value", 500))
    )
    if codes is not None:
        markets = {c: m for c, m, _ in universe}
        universe = [(c, markets.get(c, "twse"), 0) for c in codes]
    state = ctx.manifest.get("kbar") or {}
    if state.get("target") != target.isoformat():
        state = {"target": target.isoformat(), "empty": [], "failed": []}
    have = done_codes(ctx.store, target) | set(state.get("empty") or [])
    todo = [u for u in universe if u[0] not in have]
    if limit is not None:
        todo = todo[:limit]
    allowed = {d.isoformat() for d in keep}
    frames: list[pd.DataFrame] = []
    fetched = rows = 0
    failed: list[str] = []
    empty = list(state.get("empty") or [])
    tier_done = {1: 0, 2: 0, 3: 0}
    template = str(cfg["url"])
    stopped = ""
    for code, market, tier in todo:
        if ctx.out_of_time():
            stopped = "時間預算用完"
            break
        url = template.format(symbol=yahoo.symbol(code, market))
        try:
            res = yahoo.parse_chart(client.get_bytes(url), code)
        except CircuitOpenError as exc:
            stopped = str(exc)
            break
        except tasks.SOURCE_ERRORS as exc:
            failed.append(code)
            log.warning("K 棒 %s 失敗：%s", code, tasks.err_text(exc)[:200])
            continue
        fetched += 1
        if res.no_data or target.isoformat() not in set(res.df["date"]):
            empty.append(code)  # 停牌、當日無成交或 Yahoo 沒有這檔
        if not res.df.empty:
            frames.append(res.df)
        tier_done[tier] = tier_done.get(tier, 0) + 1
        if len(frames) >= FLUSH_EVERY:
            rows += flush(ctx.store, frames, allowed)
            frames = []
    rows += flush(ctx.store, frames, allowed)
    removed = prune(ctx.store, keep)
    covered = done_codes(ctx.store, target)
    total = len(universe)
    remaining = len([u for u in universe if u[0] not in covered and u[0] not in set(empty)])
    state.update(
        {
            "target": target.isoformat(),
            "total": total,
            "covered": len(covered),
            "remaining": remaining,
            "empty": sorted(set(empty)),
            "failed": sorted(set(failed)),
            "at": ctx.now.isoformat(timespec="minutes"),
            "stopped": stopped or None,
        }
    )
    ctx.manifest["kbar"] = state
    status = "ok" if covered else "failed"
    msg = f"涵蓋 {len(covered)}/{total} 檔；本次 {fetched} 檔請求、失敗 {len(failed)}、查無 {len(set(empty))}"
    if stopped:
        msg += f"；中止：{stopped}"
    ctx.note(KBAR, status, data_date=target, rows=len(covered), message=msg)
    return {
        "kbar_target": target.isoformat(),
        "fetched": fetched,
        "rows": rows,
        "covered": len(covered),
        "total": total,
        "remaining": remaining,
        "progressed": fetched > 0,
        "pruned": removed,
        "by_tier": tier_done,
    }


# ------------------------------------------------------------------ 指數 1D 備援
def index_fallback(ctx: Any, days: list[date]) -> int:
    """已收盤的交易日（d < 今天，或今天 15:00 後）仍沒有每 5 秒指數統計 → 用 Yahoo ^TWII 1 分 K 補。回傳補了幾天。"""
    from pipeline import tasks

    late = [d for d in days if d < ctx.today or (d == ctx.today and ctx.now.hour >= 15)]
    missing = [d for d in late if not ctx.store.exists(INTRADAY, d) and not ctx.store.exists(TWII, d)]
    if not missing:
        return 0
    try:
        res = yahoo.parse_index_chart(ctx.client.get_bytes(str(config.source(TWII)["url"])))
    except tasks.SOURCE_ERRORS as exc:
        ctx.note(TWII, "failed", data_date=missing[-1], message=tasks.err_text(exc)[:300])
        return 0
    n = 0
    for d in missing:
        part = res.df[res.df["date"] == d.isoformat()]
        if len(part) >= 200:  # 一個完整交易日約 271 根
            ctx.store.write(TWII, d, part.reset_index(drop=True))
            ctx.note(
                TWII, "ok", data_date=d, rows=len(part), message="每 5 秒指數統計取不到，改用 Yahoo ^TWII（非官方）"
            )
            n += 1
    return n
