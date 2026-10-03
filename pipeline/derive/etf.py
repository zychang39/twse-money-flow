"""主動式 ETF：清單（代號 00xxxA）、每日持股變化、跨檔加碼／減碼排行、個股被哪些主動式 ETF 持有。

持股資料（etf_holdings：date, etf, code, name, shares, weight, units）來自各投信官網的持股揭露／PCF
（pipeline/sources/etf_holdings.py），只涵蓋沒有反爬、導向循環或驗證機制的投信，屬「部分涵蓋」。

§7 加減碼判定（2026-10-03 改版，門檻在看結果之前寫定、不調參；METHODOLOGY「主動式 ETF」）：
申購買回會讓每一檔持股「等比例」增減，股數變動不代表經理人調整持股。改用「扣除受益權單位數變動後的股數變動」：
  流量倍數 k ＝ 本次單位數 ÷ 前次單位數（投信沒有揭露單位數時，以兩次都持有的個股「本次股數 ÷ 前次股數」中位數估計，
  basis＝implied；共同持股少於 IMPLIED_MIN_COMMON 檔時無法估計，不分類）
  超額股數 Δ* ＝ 本次股數 − 前次股數 × k（＝每單位持股數的變化 × 本次單位數）
  每單位持股數變化 r ＝ 本次股數 ÷（前次股數 × k）− 1
  新增：前次 0、本次 > 0；剔除：前次 > 0、本次 0；
  加碼：原始股數增加 ≥ MIN_LOT 且 Δ* ≥ MIN_LOT 且 r ≥ FLOW_TOL；減碼：三者皆同樣幅度往下；其餘＝不變。
  要求「原始股數同方向變動」：實測（本機回補 2025-10～2026-10，8 檔有單位數的 ETF）有單位數變動的日子裡，
  多數是「單位數變了、多數持股股數不變」（申購款先留現金或只買部分個股），只看 Δ* 會把沒有交易的持股全判成減碼。
  計入金額的股數（trade_shares）＝原始股數差與 Δ* 同號時取絕對值較小者，否則 0。
門檻理由：純申購買回時每檔持股依 k 等比例增減，再四捨五入到整張，誤差最多 0.5 張 → |Δ*| ≥ 1 張可排除；
1% 排除大型持股上的零星尾差（例：200 張的持股差 2 張）。
"""

from __future__ import annotations

import math
import re
from itertools import pairwise
from typing import Any

import numpy as np
import pandas as pd

from pipeline.core import config

ACTIVE_RE = re.compile(r"^00\d{3,4}A$")

#: §7 判定門檻（預先指定）
FLOW_TOL = 0.01  # 每單位持股數相對變化 |r| < 1% → 不變
MIN_LOT = 1000.0  # 超額股數 |Δ*| < 1 張（1,000 股）→ 不變
IMPLIED_MIN_COMMON = 5  # 沒有單位數時，估計流量倍數至少需要的共同持股檔數
MIN_VALUE_YI = 0.3  # 排行列的變動金額（億元）絕對值門檻
STALE_DAYS = 3  # 最新排行只納入持股日在最近持股日前 3 個交易日內的 ETF（較晚揭露的海外型 ETF 仍列入並標日期）
METRICS = ("value", "pct_avg20", "pct_mcap")
METRIC_LABEL = {"value": "金額", "pct_avg20": "佔 20 日均成交額", "pct_mcap": "佔市值"}
DEFAULT_METRIC = "pct_avg20"
#: §7 排序口徑驗證（預先指定）：每個持股日的加碼方依口徑排序取前十分位（至少 1 檔）；訊號日＝持股日後第
#: max(1, lag_days) 個交易日（揭露時間：當晚或次一營業日；群益、台新、凱基、第一金 1 日，元大 2 日），隔日開盤進場；
#: 持有 20、40 日；扣成本超額相對 0050（含息）與同日等權；t＝校正後 t（與策略頁同一定義）。
#: 判定：40 日、相對同日等權的校正後 t ≥ 3.0 且超額 > 0，且樣本足夠（去重事件 ≥ 300 筆、訊號日 ≥ 120 天）。
VALIDATION: dict[str, Any] = {
    "horizons": (20, 40),
    "primary_h": 40,
    "primary_vs": "ew",
    "t": 3.0,
    "min_events": 300,
    "min_days": 120,
    "decile": 0.1,
    "lookback_rows": 150,
}

CHANGE_COLS = [
    "etf",
    "code",
    "name",
    "date",
    "prev_date",
    "shares",
    "shares_prev",
    "weight",
    "weight_prev",
    "units",
    "units_prev",
    "basis",
    "flow",
    "change_shares",
    "excess_shares",
    "trade_shares",
    "per_unit_change",
    "d_weight",
    "kind",
    "kind_raw",
]
#: 持股日變動分類：new＝新增；exit＝剔除；add／reduce＝扣除申購買回後的加碼／減碼；hold＝不變（含等比例變動）；
#: None＝沒有前一次揭露或無法估計流量倍數。kind_raw 為修正前的分類（只看股數增減）。
KIND_LABEL = {"new": "新增", "add": "加碼", "reduce": "減碼", "exit": "剔除", "hold": "不變"}
ACTIVE_KINDS = ("new", "add", "reduce", "exit")

METHOD_TEXT = (
    "加減碼判定：申購買回會讓每檔持股等比例增減，所以先扣除受益權單位數的變動。"
    "超額股數＝本次股數 − 前次股數 ×（本次單位數 ÷ 前次單位數）；"
    f"股數實際同方向變動、超額股數至少 {MIN_LOT / 1000:.0f} 張且每單位持股數變化至少 {FLOW_TOL * 100:.0f}% "
    "才算加碼或減碼（申購時股數不變的持股不算減碼），"
    "前次沒有、本次有＝新增，前次有、本次沒有＝剔除。"
    "投信沒有揭露單位數時（聯博），以兩次都持有的個股股數比的中位數估計單位數變化。"
    "金額＝計入股數 × 持股日成交均價（估），計入股數＝實際股數變動與超額股數中絕對值較小者，"
    f"{MIN_VALUE_YI} 億元以下不列入；"
    "佔 20 日均成交額＝金額 ÷ 持股日（含）前 20 個交易日平均成交金額；佔市值＝金額 ÷（發行股數 × 持股日收盤價）。"
    "幾檔同向＝同一天往同一方向調整的 ETF 檔數。"
)


def active_etfs(p: Any) -> list[dict[str, Any]]:
    out = []
    for code in p.codes:
        if not ACTIVE_RE.match(code):
            continue
        c = p.close[code].dropna()
        if c.empty:
            continue
        v = p.value[code].iloc[-20:].mean()
        prev = float(c.iloc[-2]) if len(c) >= 2 else None
        out.append(
            {
                "code": code,
                "name": p.names.get(code, code),
                "market": p.markets.get(code),
                "close": float(c.iloc[-1]),
                # 2026-10-02 健檢：每列加漲跌幅（%）
                "change_pct": round((float(c.iloc[-1]) / prev - 1) * 100, 2) if prev else None,
                "value_million_20d": round(float(v) / 1e6, 1) if v == v else None,
            }
        )
    return sorted(out, key=lambda x: -(x["value_million_20d"] or 0))


def change_kind(before: float | None, now: float) -> str | None:
    """修正前的分類（只看股數增減，不扣申購買回）；保留給修正前後筆數對照（kind_raw）。"""
    if before is None:
        return None
    if before <= 0 < now:
        return "new"
    if before > 0 >= now:
        return "exit"
    if now > before:
        return "add"
    if now < before:
        return "reduce"
    return "hold"


def flow_kind(before: float, now: float, excess: float | None, per_unit: float | None) -> str | None:
    """§7 分類：扣除受益權單位數變動後的超額股數 excess 與每單位持股數變化 per_unit（見模組說明）。"""
    if before <= 0 < now:
        return "new"
    if before > 0 >= now:
        return "exit"
    if before <= 0 and now <= 0:
        return "hold"
    if excess is None or per_unit is None or not (math.isfinite(excess) and math.isfinite(per_unit)):
        return None
    raw = now - before
    # 經理人要實際買賣該股（原始股數同方向變動 ≥ 1 張），且超過申購買回的等比例部分（超額股數 ≥ 1 張、每單位變化 ≥ 1%）
    if raw >= MIN_LOT and excess >= MIN_LOT and per_unit >= FLOW_TOL:
        return "add"
    if raw <= -MIN_LOT and excess <= -MIN_LOT and per_unit <= -FLOW_TOL:
        return "reduce"
    return "hold"


def trade_shares(before: float, now: float, excess: float | None) -> float | None:
    """計入金額的股數：原始股數差與超額股數同號時取絕對值較小者（只算經理人實際買賣、且超過等比例變動的部分）；
    不同號（例：申購時股數不變 → 超額為負，但沒有賣出）為 0。"""
    raw = now - before
    if excess is None or not math.isfinite(excess):
        return None
    if raw == 0 or excess == 0 or (raw > 0) != (excess > 0):
        return 0.0
    return math.copysign(min(abs(raw), abs(excess)), raw)


def _finite(x: Any) -> float | None:
    return float(x) if x is not None and math.isfinite(float(x)) else None


def _units_of(g: pd.DataFrame) -> float | None:
    if "units" not in g.columns:
        return None
    u = pd.to_numeric(g["units"], errors="coerce").dropna()
    u = u[u > 0]
    return float(u.iloc[0]) if len(u) else None


def _norm(h: pd.DataFrame) -> pd.DataFrame:
    h = h.copy()
    h["date"] = h["date"].astype(str)
    h["etf"] = h["etf"].astype(str)
    h["code"] = h["code"].astype(str)
    h["shares"] = pd.to_numeric(h["shares"], errors="coerce").fillna(0.0)
    h["weight"] = pd.to_numeric(h["weight"], errors="coerce") if "weight" in h.columns else np.nan
    if "units" not in h.columns:
        h["units"] = np.nan
    return h


def _pair(etf: str, prev: pd.DataFrame | None, cur: pd.DataFrame, d0: str | None, d1: str) -> pd.DataFrame:
    """同一檔 ETF 兩次揭露（prev 可為 None＝沒有前一次）的每檔個股變動列。"""
    codes = sorted(set(cur.index) | (set(prev.index) if prev is not None else set()))
    s1 = cur["shares"].reindex(codes).fillna(0.0).to_numpy(dtype=float)
    w1 = cur["weight"].reindex(codes).to_numpy(dtype=float)
    names = cur["name"].reindex(codes)
    u1 = _units_of(cur)
    n = len(codes)
    if prev is None:
        nan = np.full(n, np.nan)
        return pd.DataFrame(
            {
                "etf": etf,
                "code": codes,
                "name": names.to_numpy(),
                "date": d1,
                "prev_date": None,
                "shares": s1,
                "shares_prev": nan,
                "weight": w1,
                "weight_prev": nan,
                "units": u1,
                "units_prev": np.nan,
                "basis": None,
                "flow": np.nan,
                "change_shares": nan,
                "excess_shares": nan,
                "trade_shares": nan,
                "per_unit_change": nan,
                "d_weight": nan,
                "kind": None,
                "kind_raw": None,
            },
            columns=CHANGE_COLS,
        )
    s0 = prev["shares"].reindex(codes).fillna(0.0).to_numpy(dtype=float)
    w0 = prev["weight"].reindex(codes).to_numpy(dtype=float)
    names = names.fillna(prev["name"].reindex(codes)).fillna(pd.Series(codes, index=codes))
    u0 = _units_of(prev)
    basis: str | None = None
    flow = math.nan
    if u0 and u1:
        basis, flow = "units", u1 / u0
    else:
        common = (s0 > 0) & (s1 > 0)
        if int(common.sum()) >= IMPLIED_MIN_COMMON:
            basis, flow = "implied", float(np.median(s1[common] / s0[common]))
    with np.errstate(invalid="ignore", divide="ignore"):
        excess = np.where(s0 > 0, s1 - s0 * flow, s1)
        per_unit = np.where(s0 > 0, s1 / (s0 * flow) - 1, np.nan)
    kinds = [
        flow_kind(float(a), float(b), _finite(x), _finite(r))
        for a, b, x, r in zip(s0, s1, excess, per_unit, strict=True)
    ]
    # 剔除列的超額股數：本次 0 − 前次 × k；k 未知時退回原始差
    excess = np.where((s0 > 0) & (s1 <= 0) & ~np.isfinite(excess), -s0, excess)
    trade = [trade_shares(float(a), float(b), _finite(x)) for a, b, x in zip(s0, s1, excess, strict=True)]
    return pd.DataFrame(
        {
            "etf": etf,
            "code": codes,
            "name": names.to_numpy(),
            "date": d1,
            "prev_date": d0,
            "shares": s1,
            "shares_prev": s0,
            "weight": np.where(s1 > 0, w1, 0.0),
            "weight_prev": w0,
            "units": u1,
            "units_prev": u0,
            "basis": basis,
            "flow": flow,
            "change_shares": s1 - s0,
            "excess_shares": excess,
            "trade_shares": np.array([np.nan if t is None else t for t in trade], dtype=float),
            "per_unit_change": per_unit,
            "d_weight": np.where(s1 > 0, w1, 0.0) - np.where(s0 > 0, w0, 0.0),
            "kind": kinds,
            "kind_raw": [change_kind(a, b) for a, b in zip(s0, s1, strict=True)],
        },
        columns=CHANGE_COLS,
    )


def pair_changes(h: pd.DataFrame) -> pd.DataFrame:
    """每檔 ETF 每兩次相鄰揭露的變動列（全部歷史；驗證與近 5 日彙總用）。"""
    if h is None or h.empty:
        return pd.DataFrame(columns=CHANGE_COLS)
    h = _norm(h)
    frames = []
    for etf, part in h.groupby("etf"):
        by = {d: g.drop_duplicates("code").set_index("code") for d, g in part.groupby("date")}
        dates = sorted(by)
        for d0, d1 in pairwise(dates):
            frames.append(_pair(str(etf), by[d0], by[d1], d0, d1))
    return pd.concat(frames, ignore_index=True) if frames else pd.DataFrame(columns=CHANGE_COLS)


def holdings_changes(h: pd.DataFrame) -> pd.DataFrame:
    """每檔 ETF 最新一日與前一次揭露的變動列（只有一天資料時 kind 為 None）。前次有、本次 0 的「剔除」列保留。"""
    if h is None or h.empty:
        return pd.DataFrame(columns=CHANGE_COLS)
    h = _norm(h)
    frames = []
    for etf, part in h.groupby("etf"):
        dates = sorted(part["date"].unique())
        cur = part[part["date"] == dates[-1]].drop_duplicates("code").set_index("code")
        prev = part[part["date"] == dates[-2]].drop_duplicates("code").set_index("code") if len(dates) >= 2 else None
        frames.append(_pair(str(etf), prev, cur, dates[-2] if len(dates) >= 2 else None, dates[-1]))
    return pd.concat(frames, ignore_index=True)


def kind_counts(changes: pd.DataFrame, col: str = "kind") -> dict[str, int]:
    """各分類的（ETF × 股票）筆數：{"new": n, "add": n, "reduce": n, "exit": n}（不含 hold 與無法分類）。"""
    out = {k: 0 for k in ACTIVE_KINDS}
    if changes.empty or col not in changes.columns:
        return out
    for k, n in changes[col].value_counts().items():
        if k in out:
            out[str(k)] = int(n)
    return out


def _dominant_kind(kinds: list[str], positive: bool) -> str:
    """排行列的分類：加碼方全是 new → new，否則 add；減碼方全是 exit → exit，否則 reduce。"""
    if positive:
        return "new" if kinds and all(k == "new" for k in kinds) else "add"
    return "exit" if kinds and all(k == "exit" for k in kinds) else "reduce"


# ------------------------------------------------------------------ 價格、均額、市值
class Market:
    """持股日的成交均價（估）、20 日平均成交金額、市值；資料取自衍生面板 p（原始價）。"""

    def __init__(self, p: Any):
        self.dates = list(p.dates)
        self.pos = {d: i for i, d in enumerate(self.dates)}
        self.close = p.close
        self.value = p.value
        with np.errstate(invalid="ignore", divide="ignore"):
            self.avg_px = (p.value / p.volume).where(p.volume > 0)
        self.avg20 = p.value.rolling(20, min_periods=20).mean()
        self.shares = getattr(p, "shares", {}) or {}

    def row(self, d: str) -> int | None:
        """d（含）之前最後一個交易日的列。"""
        if d in self.pos:
            return self.pos[d]
        i = int(np.searchsorted(np.asarray(self.dates), d, side="right")) - 1
        return i if i >= 0 else None

    def _at(self, frame: pd.DataFrame, code: str, d: str) -> float | None:
        i = self.row(d)
        if i is None or code not in frame.columns:
            return None
        v = frame[code].iloc[i]
        return float(v) if v == v and v is not None else None

    def price(self, code: str, d: str) -> float | None:
        px = self._at(self.avg_px, code, d)
        return px if px and px > 0 else self._at(self.close, code, d)

    def avg_value(self, code: str, d: str) -> float | None:
        v = self._at(self.avg20, code, d)
        return v if v and v > 0 else None

    def mcap(self, code: str, d: str) -> float | None:
        s = self.shares.get(code)
        c = self._at(self.close, code, d)
        return float(s) * c if s and c else None

    def trading_days_between(self, a: str, b: str) -> int:
        ia, ib = self.row(a), self.row(b)
        return (ib - ia) if ia is not None and ib is not None else 10**6


def _r(v: float | None, digits: int) -> float | None:
    return None if v is None or not math.isfinite(v) else round(float(v), digits)


def cross_items(
    changes: pd.DataFrame,
    mk: Market,
    names: dict[str, str] | None = None,
    min_value: float = MIN_VALUE_YI,
    asof: str | None = None,
) -> list[dict[str, Any]]:
    """跨檔彙總：每檔股票的變動金額（億，正＝加碼方）、佔 20 日均額 %、佔市值 %、幾檔同向，與各 ETF 明細。

    只計入分類為新增／加碼／減碼／剔除的列（不變與無法分類的列不計金額）；|金額| < min_value 億不列入。
    均額與市值以 asof（預設＝各列持股日的最大值）為準。數值帶正負號（減碼為負）。
    """
    names = names or {}
    if changes is None or changes.empty:
        return []
    act = changes[changes["kind"].isin(ACTIVE_KINDS)]
    if act.empty:
        return []
    ref = asof or str(act["date"].max())
    out: list[dict[str, Any]] = []
    for code, part in act.groupby("code"):
        code = str(code)
        rows = []
        net = 0.0
        for r in part.itertuples():
            px = mk.price(code, str(r.date))
            if px is None or not math.isfinite(float(r.trade_shares)):
                continue
            v = float(r.trade_shares) * px
            net += v
            rows.append((r, v))
        if not rows:
            continue
        positive = net > 0
        same = [r for r, v in rows if (v > 0) == positive and v != 0]
        value_yi = net / 1e8
        if abs(value_yi) < min_value:
            continue
        avg = mk.avg_value(code, ref)
        cap = mk.mcap(code, ref)
        out.append(
            {
                "code": code,
                "name": names.get(code) or str(part["name"].dropna().iloc[0] if part["name"].notna().any() else code),
                "dir": "add" if positive else "reduce",
                "kind": _dominant_kind([str(r.kind) for r in same], positive),
                "value_yi": _r(value_yi, 2),
                "pct_avg20": _r(net / avg * 100, 2) if avg else None,
                "pct_mcap": _r(net / cap * 100, 4) if cap else None,
                "etfs_same_dir": len(same),
                "etfs": [
                    {
                        "code": str(r.etf),
                        "name": names.get(str(r.etf), str(r.etf)),
                        "d_shares": _r(float(r.trade_shares), 0),
                        "d_shares_excess": _r(float(r.excess_shares), 0),
                        "d_shares_raw": _r(float(r.change_shares), 0),
                        "d_weight": _r(float(r.d_weight), 4) if r.d_weight == r.d_weight else None,
                        "kind": str(r.kind),
                        "date": str(r.date),
                        "value_yi": _r(v / 1e8, 2),
                    }
                    for r, v in sorted(rows, key=lambda x: -abs(x[1]))
                ],
            }
        )
    return out


def sort_items(items: list[dict[str, Any]], metric: str = DEFAULT_METRIC) -> list[dict[str, Any]]:
    """加碼方在前、減碼方在後；各自依口徑絕對值由大到小（缺值排最後）。"""

    def key(x: dict[str, Any]) -> tuple[int, float]:
        v = x.get("value_yi" if metric == "value" else metric)
        return (0 if x["dir"] == "add" else 1, -(abs(v) if v is not None else -1.0))

    return sorted(items, key=key)


def latest_changes(changes: pd.DataFrame, mk: Market) -> tuple[pd.DataFrame, str | None, list[dict[str, str]]]:
    """最新排行用的變動列：持股日在最近持股日前 STALE_DAYS 個交易日內的 ETF；其餘列入 lagging（只說明、不計入）。"""
    if changes.empty:
        return changes, None, []
    last = changes.groupby("etf")["date"].max()
    d_star = str(last.max())
    keep = [e for e, d in last.items() if mk.trading_days_between(str(d), d_star) <= STALE_DAYS]
    lagging = [{"code": str(e), "date": str(d)} for e, d in last.items() if str(e) not in set(map(str, keep))]
    return changes[changes["etf"].isin(keep)], d_star, lagging


def ranking(
    changes: pd.DataFrame, close: dict[str, float], top: int = 30, names: dict[str, str] | None = None
) -> dict[str, list[dict[str, Any]]]:
    """舊版排行（add／reduce 陣列，前端相容）：改用 §7 分類與超額股數；names（行情簡稱）優先。"""
    if changes.empty or "trade_shares" not in changes.columns:
        return {"add": [], "reduce": []}
    ch = changes[changes["kind"].isin(ACTIVE_KINDS)]
    if ch.empty:
        return {"add": [], "reduce": []}
    agg = []
    for code, part in ch.groupby("code"):
        ex = part["trade_shares"].astype(float).fillna(0.0)
        net = float(ex.sum())
        if net == 0:
            continue
        adders = int((ex > 0).sum())
        reducers = int((ex < 0).sum())
        px = close.get(str(code))
        same_side = part[(ex > 0) if net > 0 else (ex < 0)]
        agg.append(
            {
                "code": code,
                "name": (names or {}).get(str(code)) or part["name"].iloc[0],
                "etfs": adders if net > 0 else reducers,
                "cross": (adders if net > 0 else reducers) >= 2,
                "net_shares": round(net),
                "net_value": round(net * px / 1e8, 2) if px else None,
                "detail": "、".join(f"{r.etf} {r.trade_shares:+,.0f}" for r in part.itertuples() if r.trade_shares),
                "kind": _dominant_kind([str(k) for k in same_side["kind"].tolist()], net > 0),
            }
        )
    if not agg:
        return {"add": [], "reduce": []}
    df = pd.DataFrame(agg)
    add = df[df["net_shares"] > 0].sort_values(["etfs", "net_shares"], ascending=False).head(top)
    red = df[df["net_shares"] < 0].sort_values(["etfs", "net_shares"], ascending=[False, True]).head(top)
    return {"add": add.to_dict("records"), "reduce": red.to_dict("records")}


def holders_by_stock(changes: pd.DataFrame, names: dict[str, str]) -> dict[str, list[dict[str, Any]]]:
    """個股被哪些主動式 ETF 持有（含本次剔除的 ETF，kind=exit，shares 0），每列帶 §7 分類 kind 與超額股數 d_shares。"""
    out: dict[str, list[dict[str, Any]]] = {}
    for r in changes.itertuples():
        kind = getattr(r, "kind", None)
        if not r.shares and kind != "exit":
            continue
        ex = getattr(r, "trade_shares", None)
        out.setdefault(r.code, []).append(
            {
                "etf": r.etf,
                "name": names.get(r.etf, r.etf),
                "weight": None if r.weight != r.weight else r.weight,
                "change_shares": None if r.change_shares != r.change_shares else r.change_shares,
                "d_shares": None if ex is None or ex != ex else round(float(ex)),
                "date": r.date,
                "kind": kind if isinstance(kind, str) else None,
            }
        )
    return out


def stock_summary(h: pd.DataFrame, p: Any, days: int = 5) -> dict[str, dict[str, Any]]:
    """個股頁「主動式 ETF」一列：持有檔數｜近 5 日淨變動金額（億）｜佔 20 日均成交額 %（§7 口徑）。

    持有檔數＝最新排行納入的 ETF 中，最新持股日股數 > 0 的檔數；近 5 日＝最近持股日（含）往前 5 個交易日內
    各次揭露的超額股數 × 該持股日均價之和（所有 ETF、所有分類，不套 0.3 億門檻）；均額取最近持股日。
    """
    if h is None or h.empty:
        return {}
    mk = Market(p)
    allp = pair_changes(h)
    latest = holdings_changes(h)
    latest, d_star, _ = latest_changes(latest, mk)
    if d_star is None:
        return {}
    hold = latest[latest["shares"] > 0].groupby("code")["etf"].nunique()
    i_star = mk.row(d_star)
    recent = allp
    if i_star is not None and not allp.empty:
        start = mk.dates[max(0, i_star - days + 1)]
        recent = allp[(allp["date"] >= start) & (allp["date"] <= d_star) & allp["kind"].isin(ACTIVE_KINDS)]
    net: dict[str, float] = {}
    for r in recent.itertuples():
        px = mk.price(str(r.code), str(r.date))
        if px is None or not math.isfinite(float(r.trade_shares)):
            continue
        net[str(r.code)] = net.get(str(r.code), 0.0) + float(r.trade_shares) * px
    out: dict[str, dict[str, Any]] = {}
    for code in set(hold.index.astype(str)) | set(net):
        v = net.get(code, 0.0)
        avg = mk.avg_value(code, d_star)
        out[code] = {
            "count": int(hold.get(code, 0)),
            "net5_value_yi": round(v / 1e8, 2),
            "pct_avg20": round(v / avg * 100, 2) if avg else None,
            "date": d_star,
        }
    return out


# ------------------------------------------------------------------ 涵蓋
def _issuers() -> dict[str, dict[str, Any]]:
    return dict(config.source("active_etf").get("issuers", {}))


def issuer_map(names: dict[str, str]) -> dict[str, str]:
    """ETF 代號 → 投信 id（由行情名稱關鍵字判定）。"""
    from pipeline.sources.etf_holdings import issuer_of

    iss = _issuers()
    return {c: i for c, n in names.items() if ACTIVE_RE.match(c) and (i := issuer_of(str(n), iss))}


def coverage(
    snapshot: pd.DataFrame, total: int, holdings_date: str | None, names: dict[str, str], lagging: list[dict[str, str]]
) -> dict[str, Any]:
    """頁首「涵蓋 8/32 檔・持股日 10/2」：covered＝最新排行納入的 ETF 檔數；issuers＝這些 ETF 的發行投信家數。

    implemented_*＝config 中已實作（verified）的投信家數與其發行的 ETF 檔數（實作 ≠ 已取得資料；舊版文字把
    已實作的投信家數與有資料的 ETF 檔數放在同一句，出現「9 家投信」對「8 檔」）。
    """
    iss = _issuers()
    imap = issuer_map(names)
    etfs = sorted(map(str, snapshot["etf"].unique())) if not snapshot.empty else []
    have_iss = sorted({imap[e] for e in etfs if e in imap})
    verified = [k for k, v in iss.items() if v.get("status") == "verified"]
    impl_etfs = sorted(c for c, i in imap.items() if i in verified)
    units_missing = sorted(
        e for e in etfs if snapshot.loc[snapshot["etf"] == e, "basis"].dropna().astype(str).ne("units").all()
    )
    return {
        "covered": len(etfs),
        "total": int(total),
        "holdings_date": holdings_date,
        "issuers": len(have_iss),
        "issuer_names": [str(iss[i]["label"]) for i in have_iss],
        "etf_codes": etfs,
        "implemented_issuers": len(verified),
        "implemented_etfs": len(impl_etfs),
        "lagging": lagging,
        "units_missing": units_missing,
    }


def coverage_text(cov: dict[str, Any]) -> str:
    """ⓘ 用的涵蓋說明：有資料的檔數與投信家數、已實作的投信家數與檔數分開寫。"""
    names = "、".join(n.removesuffix("投信") for n in cov.get("issuer_names", []))
    head = f"部分涵蓋：{cov['covered']}／{cov['total']} 檔主動式 ETF 有持股資料"
    if cov.get("holdings_date"):
        head += f"（持股日 {cov['holdings_date']}）"
    head += f"，來自 {cov['issuers']} 家投信（{names}）的官網揭露" if cov["issuers"] else ""
    return (
        head + f"；已實作 {cov['implemented_issuers']} 家投信、{cov['implemented_etfs']} 檔，"
        "其餘投信因反爬、導向循環、驗證機制或尚未找到端點而未涵蓋。"
    )


# ------------------------------------------------------------------ §7 排序口徑驗證
def lag_rows(names: dict[str, str]) -> dict[str, int]:
    """ETF → 揭露延遲（交易日，至少 1）：訊號日＝持股日後第 max(1, lag_days) 個交易日。"""
    iss = _issuers()
    return {c: max(1, int(iss.get(i, {}).get("lag_days", 0) or 0)) for c, i in issuer_map(names).items()}


def daily_items(allp: pd.DataFrame, mk: Market, names: dict[str, str]) -> dict[str, list[dict[str, Any]]]:
    """每個持股日的跨檔彙總（只用該日有揭露且有前一次揭露的 ETF）。"""
    out: dict[str, list[dict[str, Any]]] = {}
    if allp.empty:
        return out
    act = allp[allp["kind"].isin(ACTIVE_KINDS)]
    for d, part in act.groupby("date"):
        out[str(d)] = cross_items(part, mk, names, asof=str(d))
    return out


def _evdata(p: Any, ds: Any, start_row: int) -> Any:
    """由衍生面板建立事件研究用的評估資料（只取 start_row 之後的列；普通股；還原價），只呼叫 evidence 的公開函式。"""
    from pipeline.core.normalize import is_common_stock
    from pipeline.evidence import data as evdata

    dates = list(p.dates)[start_row:]
    pat = [str(x) for x in evdata.cfg()["universe"].get("exclude_name_patterns", [])]
    codes = [c for c in p.codes if is_common_stock(c) and not any(x in str(p.names.get(c, "")) for x in pat)]

    def w(frame: pd.DataFrame) -> np.ndarray:
        return frame[codes].iloc[start_row:].to_numpy(dtype=float)

    af = w(p.af)
    idx = getattr(ds, "index", pd.DataFrame())

    def index_series(name: str) -> np.ndarray:
        if idx is None or idx.empty:
            return np.full(len(dates), np.nan)
        s = idx[idx["name"] == name].drop_duplicates("date", keep="last").set_index("date")["close"]
        return s.reindex(dates).to_numpy(dtype=float)

    nan = np.full((len(dates), len(codes)), np.nan)
    ev = evdata.EvData(
        dates=dates,
        codes=codes,
        names={c: str(p.names.get(c, c)) for c in codes},
        open=w(p.open) * af,
        high=w(p.high) * af,
        low=w(p.low) * af,
        close=w(p.close) * af,
        raw_close=w(p.close),
        volume=w(p.volume),
        value=w(p.value),
        foreign=nan,
        trust=nan,
        hedge=nan,
        margin=nan,
        disposition=evdata.disposition_mask(getattr(ds, "disposition", pd.DataFrame()), dates, codes),
        taiex=index_series(evdata.TAIEX),
        taiex_tr=index_series(evdata.TAIEX_TR),
    )
    for code in evdata.BENCH_ETFS:
        if code in p.af.columns:
            f = p.af[code].iloc[start_row:].to_numpy(dtype=float)
            ev.etf[code] = {
                "open": p.open[code].iloc[start_row:].to_numpy(dtype=float) * f,
                "close": p.close[code].iloc[start_row:].to_numpy(dtype=float) * f,
            }
    return ev


def _empty_validation(reason: str, n: int = 0, period: list[str | None] | None = None) -> dict[str, Any]:
    return {
        "verified": False,
        "metric": None,
        "n": n,
        "period": period or [None, None],
        "rows": [],
        "reason": reason,
        "rule": validation_rule_text(),
    }


def validation_rule_text() -> str:
    v = VALIDATION
    return (
        f"每個持股日的加碼方依口徑排序取前 {v['decile'] * 100:.0f}%（至少 1 檔），持股日後第 1 個交易日"
        "（元大第 2 個）收盤後視為已知、隔日開盤進場，持有 20、40 日，扣成本後相對 0050（含息）與同日等權；"
        f"t＝校正後 t。40 日相對同日等權 t ≥ {v['t']:.1f} 且超額 > 0、去重樣本 ≥ {v['min_events']} 筆、"
        f"訊號日 ≥ {v['min_days']} 天的口徑才取代預設；都沒有時維持「佔 20 日均成交額」。"
    )


def validate(allp: pd.DataFrame, p: Any, ds: Any, names: dict[str, str]) -> dict[str, Any]:
    """§7 三種排序口徑的事件研究（呼叫 pipeline/evidence 的 engine 與 audit.corrected_t，不改其核心）。"""
    from pipeline.evidence import audit, engine
    from pipeline.evidence import data as evdata
    from pipeline.evidence import universe as unimod

    v = VALIDATION
    mk = Market(p)
    days = daily_items(allp, mk, names)
    days = {d: [x for x in items if x["dir"] == "add"] for d, items in days.items()}
    days = {d: items for d, items in days.items() if items and mk.row(d) is not None}
    if not days:
        return _empty_validation("尚無兩次以上的持股揭露")
    lags = lag_rows(names)
    first_row = min(mk.row(d) or 0 for d in days)
    start_row = max(0, first_row - int(v["lookback_rows"]))
    ev = _evdata(p, ds, start_row)
    cfg = dict(evdata.cfg())
    cfg["horizons"] = list(v["horizons"])
    cfg["horizons_ref"] = []
    uni = unimod.build(ev, cfg["universe"])
    market = engine.market(ev, uni, cfg)
    cpos = {c: i for i, c in enumerate(ev.codes)}
    T = len(ev.dates)
    rows: list[dict[str, Any]] = []
    best: tuple[float, str] | None = None
    n_primary = -1
    period: list[str | None] = [None, None]
    for metric in METRICS:
        key = "value_yi" if metric == "value" else metric
        mask = np.zeros((T, len(ev.codes)), dtype=bool)
        for d, items in days.items():
            ranked = sorted((x for x in items if x.get(key) is not None), key=lambda x: -float(x[key]))
            if not ranked:
                continue
            k = max(1, math.ceil(len(ranked) * float(v["decile"])))
            lag = max(lags.get(e["code"], 1) for x in ranked[:k] for e in x["etfs"])
            t = (mk.row(d) or 0) - start_row + lag
            if t >= T:
                continue
            for x in ranked[:k]:
                if x["code"] in cpos:
                    mask[t, cpos[x["code"]]] = True
        t_idx, c_idx = engine.events_from_mask(mask, uni)
        for h in v["horizons"]:
            df = engine.dedupe(engine.evaluate(market, t_idx, c_idx, h))
            sig_dates = sorted({ev.dates[i] for i in df["t"]}) if not df.empty else []
            span = (market.dates.index(sig_dates[-1]) - market.dates.index(sig_dates[0]) + 1) if sig_dates else None
            for vs, col in (("0050", "exc_0050"), ("ew", "exc_mkt")):
                ct = audit.corrected_t(df, h, col, span) if not df.empty else {"mean_excess": None, "t_corr": None}
                rows.append(
                    {
                        "metric": metric,
                        "h": h,
                        "vs": vs,
                        "excess": ct.get("mean_excess"),
                        "t": ct.get("t_corr"),
                        "n": len(df),
                        "days": len(sig_dates),
                    }
                )
                if h == v["primary_h"] and vs == v["primary_vs"]:
                    if len(df) > n_primary:  # 頁首的 n 與期間：主要判定（40 日、等權）樣本最多的口徑
                        n_primary = len(df)
                        period = [sig_dates[0], sig_dates[-1]] if sig_dates else [None, None]
                    enough = len(df) >= int(v["min_events"]) and len(sig_dates) >= int(v["min_days"])
                    tc, ex = ct.get("t_corr"), ct.get("mean_excess")
                    if enough and tc is not None and (ex or 0) > 0:
                        tf = float(tc)
                        if tf >= float(v["t"]) and (best is None or tf > best[0]):
                            best = (tf, metric)
    out = {
        "verified": best is not None,
        "metric": best[1] if best else None,
        "n": max(n_primary, 0),
        "period": period,
        "rows": rows,
        "holdings_days": len(days),
        "rule": validation_rule_text(),
    }
    if best is None:
        prim = [r for r in rows if r["h"] == v["primary_h"] and r["vs"] == v["primary_vs"]]
        enough = any(r["n"] >= int(v["min_events"]) and r["days"] >= int(v["min_days"]) for r in prim)
        out["reason"] = "樣本不足" if not enough else f"三種口徑的 40 日相對同日等權 t 皆 < {v['t']:.1f}"
    return out


def unverified_label(val: dict[str, Any]) -> str | None:
    """頁首標註：「排序口徑未驗證（樣本 n 筆、期間）」；已驗證時 None。"""
    if val.get("verified"):
        return None
    a, b = (val.get("period") or [None, None])[:2]
    span = f"{a}～{b}" if a and b else "無"
    return f"排序口徑未驗證（樣本 {val.get('n', 0)} 筆、{span}）"


# ------------------------------------------------------------------ market.json
def market_section(ds: Any, p: Any) -> dict[str, Any]:
    """market.json 的 active_etfs 與 etf_ranking（§7 契約：coverage、items、sort_default、validation、method；
    舊欄位 add／reduce／kinds／covered／total／status 保留給現有前端）。"""
    h = ds.table("etf_holdings")
    etfs = active_etfs(p)
    names = dict(p.names)
    mk = Market(p)
    latest = holdings_changes(h)
    snap, d_star, lagging = latest_changes(latest, mk)
    close = {c: float(v) for c, v in p.close.iloc[-1].dropna().items()} if len(p.dates) else {}
    cov = coverage(snap, len(etfs), d_star, names, lagging)
    allp = pair_changes(h)
    try:
        val = validate(allp, p, ds, names)
    except Exception as exc:  # 驗證失敗不影響排行輸出
        import logging

        logging.getLogger(__name__).exception("主動式 ETF 排序口徑驗證失敗")
        val = _empty_validation(f"驗證失敗：{type(exc).__name__}")
    metric = val["metric"] if val.get("verified") and val.get("metric") in METRICS else DEFAULT_METRIC
    items = sort_items(cross_items(snap, mk, names, asof=d_star), metric)
    rk: dict[str, Any] = {"date": d_star}
    rk.update(ranking(snap, close, names=names))
    rk.update(
        {
            "coverage": cov,
            "coverage_text": coverage_text(cov),
            "items": items,
            "sort_default": metric,
            "validation": val,
            "unverified_label": unverified_label(val),
            "method": METHOD_TEXT,
            # 修正前後的分類筆數（ETF × 股票，最新持股日）：kinds＝§7 判定；kinds_raw＝修正前（只看股數增減）
            "kinds": kind_counts(snap),
            "kinds_raw": kind_counts(snap, "kind_raw"),
            "covered": cov["covered"],
            "total": cov["total"],
        }
    )
    covered_codes = set(cov["etf_codes"]) | set(map(str, latest["etf"].unique()) if not latest.empty else set())
    for e in etfs:
        e["has_holdings"] = e["code"] in covered_codes
    if not items:
        rk["status"] = (
            "主動式 ETF 每日持股只由各投信官網個別揭露；"
            + coverage_text(cov)
            + "累積兩天以上的揭露後才顯示跨檔加碼／減碼。"
        )
    return {"active_etfs": etfs, "etf_ranking": rk}
