"""進階資料任務：期交所（POST）、匯率、美債、集保（週）。"""

from __future__ import annotations

from datetime import date, timedelta
from typing import Any

import pandas as pd

from pipeline.core import config
from pipeline.core.dates import month_start, next_month, slash
from pipeline.core.http import CircuitOpenError, FetchError
from pipeline.registry import build_url
from pipeline.sources import advanced
from pipeline.sources.base import ParseError, ParseResult
from pipeline.tasks import RunContext, _fetch


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


def run_taifex(ctx: RunContext, start: date, end: date) -> None:
    """三大法人期貨（TXF/MXF/TMF）、全市場未平倉（TX/MTX/TMF）、美元兌台幣；以月為單位查詢。"""
    jobs: list[tuple[str, Any, list[str]]] = [
        ("taifex_insti", advanced.parse_taifex_insti, ["date", "contract", "party"]),
        ("taifex_oi", advanced.parse_taifex_oi, ["date", "contract"]),
    ]
    m = month_start(start)
    while m <= end:
        a, b = max(m, start), min(next_month(m) - timedelta(days=1), end)
        for source, parse, keys in jobs:
            frames = []
            try:
                for commodity in config.source(source)["commodities"]:
                    res: ParseResult = parse(_post(ctx, source, a, b, commodity))
                    frames.append(res.df)
                df = pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()
                _upsert_by_month(ctx, source, df, keys)
                ctx.note(source, "ok", data_date=b, rows=len(df))
            except (FetchError, ParseError) as exc:
                ctx.note(source, "failed", data_date=b, message=str(exc)[:300])
        try:
            fx = advanced.parse_fx(_post(ctx, "fx_usdtwd", a, b)).df
            _upsert_by_month(ctx, "fx_usdtwd", fx, ["date"])
            ctx.note("fx_usdtwd", "ok", data_date=b, rows=len(fx))
        except (FetchError, ParseError) as exc:
            ctx.note("fx_usdtwd", "failed", data_date=b, message=str(exc)[:300])
        m = next_month(m)


def run_ust(ctx: RunContext, year: int) -> None:
    try:
        raw = _fetch(ctx, build_url("ust_10y", date(year, 1, 1)))
        df = advanced.parse_treasury(raw).df
        ctx.store.upsert("ust_10y", date(year, 1, 1), df, ["date"])
        ctx.note(
            "ust_10y", "ok", data_date=date.fromisoformat(df["date"].max()) if not df.empty else None, rows=len(df)
        )
    except (FetchError, ParseError) as exc:
        ctx.note("ust_10y", "failed", message=str(exc)[:300])


def run_tdcc(ctx: RunContext) -> None:
    try:
        res = advanced.parse_tdcc(_fetch(ctx, build_url("tdcc_holders")))
    except (FetchError, ParseError) as exc:
        ctx.note("tdcc_holders", "failed", message=str(exc)[:300])
        return
    if res.no_data or res.response_date is None:
        ctx.note("tdcc_holders", "failed", message="集保資料為空")
        return
    if ctx.store.exists("tdcc_holders", res.response_date):
        ctx.note("tdcc_holders", "ok", data_date=res.response_date, rows=len(res.df), message="本週已存在")
        return
    ctx.store.write("tdcc_holders", res.response_date, res.df)
    ctx.note("tdcc_holders", "ok", data_date=res.response_date, rows=len(res.df))


# ------------------------------------------------------------------ 選配：央行貨幣總計數、法說會
def run_cbc_money(ctx: RunContext) -> None:
    """央行 M1B／M2（日平均，月資料）：整份 CSV 以最新月份存成一份快照。"""
    from pipeline.sources import optional

    try:
        df = optional.parse_cbc_money(_fetch(ctx, str(config.source("cbc_money")["url"]))).df
    except (FetchError, ParseError) as exc:
        ctx.note("cbc_money", "failed", message=str(exc)[:300])
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
    except (FetchError, ParseError) as exc:
        ctx.note("investor_conference", "failed", data_date=month, message=str(exc)[:300])
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
    """依投信呼叫對應端點；群益、國泰需要先查「ETF 代號 → 內部基金代碼」，每輪只查一次。"""

    def __init__(self, ctx: RunContext, issuers: dict[str, dict[str, Any]]):
        self.ctx = ctx
        self.issuers = issuers
        self._maps: dict[str, dict[str, str]] = {}
        self.list_failed: set[str] = set()

    def _fund_map(self, issuer: str) -> dict[str, str]:
        from pipeline.sources import etf_holdings as eh

        if issuer not in self._maps:
            cfg = self.issuers[issuer]
            try:
                if issuer == "capital":
                    self._maps[issuer] = eh.parse_capital_items(self.ctx.client.post_json(str(cfg["list_url"]), {}))
                else:
                    self._maps[issuer] = eh.parse_cathay_list(_fetch(self.ctx, str(cfg["list_url"])))
            except (FetchError, ParseError):
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
        raise ParseError(f"未實作的投信：{issuer}")


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


def run_etf_holdings(ctx: RunContext, target: date, days: list[date] | None = None) -> None:
    """抓取已實作投信的主動式 ETF 持股；以「持股日」為單位判斷缺漏。

    群益、元大以申購買回清單的公告日查詢，回應的是 lag_days 個交易日之前的持股（config 設定），
    因此要取得持股日 X，就查詢 X 之後第 lag_days 個交易日；該日還沒到時改查最新一份。
    每日（days 為 None）：最近 HEAL_DAYS 個交易日中缺的持股日都再試一次；第一次抓到的 ETF 若不到兩天
    （無法計算加碼／減碼），再往回補到 backfill_days 個交易日內取得第二天為止（之後的每日任務自然累積）。
    回補（days 指定）：逐日抓取缺的持股日（由近到遠，受時間預算限制）。
    同一家投信出現 HTTP 4xx 或斷路器開啟時，本輪不再請求該投信。
    """
    from pipeline.sources import etf_holdings as eh

    cfg = config.source("active_etf")
    issuers: dict[str, dict[str, Any]] = cfg["issuers"]
    names = active_etf_names(ctx)
    if not names:
        ctx.note("active_etf", "failed", data_date=target, message="找不到主動式 ETF 清單（需先有收盤行情）")
        return
    targets = {
        code: iss
        for code, name in sorted(names.items())
        if (iss := eh.issuer_of(name, issuers)) and issuers[iss].get("status") == "verified"
    }
    stored = ctx.store.read_range("etf_holdings")
    have: dict[str, set[str]] = {}
    if not stored.empty:
        for d_, e_ in set(zip(stored["date"].astype(str), stored["etf"].astype(str), strict=True)):
            have.setdefault(e_, set()).add(d_)
    lookback = int(cfg.get("backfill_days", 20))
    recent = ctx.calendar.trading_days(target - timedelta(days=lookback * 2 + 14), target)[::-1]
    fetcher = _EtfFetcher(ctx, issuers)
    frames: list[pd.DataFrame] = []
    errors: list[str] = []
    dead_issuers: set[str] = set()
    asked: set[tuple[str, date | None]] = set()

    def request_date(issuer: str, x: date) -> date | None:
        lag = int(issuers[issuer].get("lag_days", 0))
        if lag == 0:
            return x
        after = ctx.calendar.trading_days(x + timedelta(days=1), x + timedelta(days=lag * 7 + 21))
        if len(after) < lag or after[lag - 1] > ctx.today:
            return None  # 公告日還沒到 → 查最新一份
        return after[lag - 1]

    def attempt(issuer: str, etf: str, x: date) -> None:
        d = request_date(issuer, x)
        if issuer in dead_issuers or (etf, d) in asked or ctx.out_of_time():
            return
        asked.add((etf, d))
        try:
            res = fetcher.fetch(issuer, etf, d)
        except (FetchError, ParseError) as exc:
            errors.append(f"{etf}（{issuers[issuer]['label']}）：{str(exc)[:120]}")
            if isinstance(exc, CircuitOpenError) or "HTTP 4" in str(exc) or issuer in fetcher.list_failed:
                dead_issuers.add(issuer)
            return
        if not res.df.empty:
            frames.append(res.df)
            have.setdefault(etf, set()).add(str(res.df["date"].iloc[0]))

    for etf, issuer in targets.items():
        first_time = etf not in have
        todo = days if days is not None else recent[:HEAL_DAYS]
        for x in todo:
            if x.isoformat() not in have.get(etf, set()):
                attempt(issuer, etf, x)
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
