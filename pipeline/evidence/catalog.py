"""評估項目清單（1.9 的 20 個指標、變體、參數格與 1.6 的分組檢定變數）。

每個項目（Test）是一個獨立的假說，在總表中各佔一列：
- kind="event"：事件研究。variants 的 "main" 為主結果；grid 為 walk-forward 參數格（主結果＝選定格）。
- kind="quintile"：每月分五組。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import numpy as np

from pipeline.evidence import indicators as ind


@dataclass
class Cell:
    key: str
    params: dict[str, Any]
    mask: np.ndarray


@dataclass
class Test:
    id: str
    label: str
    family: str
    kind: str
    data: str  # 資料起始日的來源（EvData.starts 的鍵）
    avail: np.ndarray  # (T, C)：指標可計算
    definition: str
    variants: dict[str, tuple[str, np.ndarray]] = field(default_factory=dict)
    grid: list[Cell] = field(default_factory=list)
    grid_dims: list[str] = field(default_factory=list)
    values: np.ndarray | None = None
    components: list[str] = field(default_factory=list)
    note: str = ""
    breakout_level: np.ndarray | None = None
    horizons_focus: list[int] = field(default_factory=list)
    # 個股頁「有效訊號面板」的「接近觸發」（M3）：near＝固定遮罩；near_fn＝依選定參數產生（參數格指標）
    near: np.ndarray | None = None
    near_fn: Any = None
    # v3 M4：依選定參數產生的單一條件與兩兩組合（參數格指標）：params → {key: (label, mask)}
    components_fn: Any = None
    # v3 M5-5：策略頁「今日新觸發」展開的觸發依據：[(名稱, (T, C) 數值, 單位, 倍數, 小數位)]
    basis: list[tuple[str, np.ndarray, str, float, int]] = field(default_factory=list)


def _grid(dims: dict[str, list[Any]], make: Any) -> list[Cell]:
    names = list(dims)
    cells: list[Cell] = []

    def rec(i: int, cur: dict[str, Any]) -> None:
        if i == len(names):
            key = "／".join(f"{k}={cur[k]}" for k in names)
            cells.append(Cell(key, dict(cur), make(**cur)))
            return
        for v in dims[names[i]]:
            rec(i + 1, {**cur, names[i]: v})

    rec(0, {})
    return cells


def neighbors(grid: list[Cell], dims: dict[str, list[Any]], chosen: Cell) -> list[str]:
    """相鄰格：只有一個參數差一格。"""
    out = []
    for c in grid:
        diff = [k for k in dims if c.params[k] != chosen.params[k]]
        if len(diff) == 1:
            k = diff[0]
            if abs(dims[k].index(c.params[k]) - dims[k].index(chosen.params[k])) == 1:
                out.append(c.key)
    return out


def build(ev: Any, f: dict[str, Any], p: dict[str, Any], universe: np.ndarray) -> list[Test]:
    fin = np.isfinite
    T = ev.close.shape[0]
    tests: list[Test] = []

    # 1 RS 百分位
    rs = f["rs_pct"]
    tests.append(
        Test(
            "rs90",
            "RS 百分位站上 90",
            "動能",
            "event",
            "price",
            fin(rs),
            "RS = 0.4×近 63 日報酬 + 0.2×126 日 + 0.2×189 日 + 0.2×252 日，每日在 universe 內取百分位；當日 ≥ 90 且前一日 < 90。",
            variants={"main": ("全部", ind.cross_up(rs, float(p["rs_event"])))},
        )
    )
    # 2 距 52 週高點
    h = f["h52"]
    ev52 = ind.cross_up(h, float(p["high52_event"]))
    with np.errstate(invalid="ignore"):
        not_extended = f["bias20"] <= float(p["high52_bias_max"])
    tests.append(
        Test(
            "high52",
            "接近 52 週高點（95%）",
            "動能",
            "event",
            "price",
            fin(h),
            "比率 = 收盤 ÷ 近 252 日最高收盤（不含當日）；當日 ≥ 0.95 且前一日 < 0.95。",
            variants={"main": ("全部", ev52), "not_extended": ("距 20 日線 ≤ 10%", ev52 & not_extended)},
        )
    )
    # 3 N 日新高突破
    vr, cp = f["vol_ratio"], f["close_pos"]
    with np.errstate(invalid="ignore"):
        big_vol = vr >= float(p["breakout_vol"])
        top = cp >= float(p["breakout_close_pos"])
    for n in p["breakout_n"]:
        b, level = ind.breakout(ev.close, int(n))
        tests.append(
            Test(
                f"breakout{n}",
                f"{n} 日新高突破",
                "動能",
                "event",
                "price",
                fin(level),
                f"收盤 > 前 {n} 日最高收盤（不含當日），且前一日不是突破（第一次突破）。變體依量能（當日量 ÷ 前 20 日均量 ≥ 1.5）與收盤位置（當日高低區間上 25%）分成互斥的四組。",
                variants={
                    "main": ("全部", b),
                    "a": ("(a) 只有量能 ≥ 1.5 倍", b & big_vol & ~top),
                    "b": ("(b) 只有收盤在上 25%", b & top & ~big_vol),
                    "c": ("(c) 兩者皆備", b & big_vol & top),
                    "d": ("(d) 兩者皆無", b & ~big_vol & ~top),
                },
                breakout_level=level,
            )
        )
    # 4 20 日乖離
    bs = f["bias20"]
    tests.append(
        Test(
            "bias15",
            "20 日乖離 > 15%（追高風險）",
            "動能",
            "event",
            "price",
            fin(bs),
            "乖離 = 收盤 ÷ 20 日線 − 1；當日 > 15% 且前一日 ≤ 15%。報告 10 日與 20 日的超額報酬與最大不利波動。",
            variants={"main": ("全部", _cross_strict(bs, float(p["bias_event"])))},
            horizons_focus=[10, 20],
        )
    )
    # 5 KD 鈍化
    K = f["K"]
    ea, eb = ind.kd_events(K, float(p["kd_high"]), int(p["kd_run"]))
    tests.append(
        Test(
            "kd_run",
            "KD 高檔鈍化第 5 日",
            "動能",
            "event",
            "price",
            fin(K),
            "KD(9,3,3)；K ≥ 80 連續達第 5 日（當日為第 5 日）。檢驗「鈍化＝延續」。",
            variants={"main": ("全部", ea)},
        )
    )
    tests.append(
        Test(
            "kd_drop",
            "KD 鈍化後跌破 80",
            "動能",
            "event",
            "price",
            fin(K),
            "K 從 ≥ 80 跌破 80，且之前連續 ≥ 80 至少 5 日。若之後的超額報酬顯著為正，代表「80 賣」是錯的。",
            variants={"main": ("全部", eb)},
        )
    )
    # 6 MACD
    dif, hist = f["dif"], f["hist"]
    mc = ind.macd_cross(hist)
    with np.errstate(invalid="ignore"):
        above0 = dif > 0
    tests.append(
        Test(
            "macd",
            "MACD 柱狀轉正",
            "動能",
            "event",
            "price",
            fin(hist),
            "EMA 12、26，訊號線 9；柱狀圖當日 > 0 且前一日 ≤ 0。",
            variants={
                "main": ("全部", mc),
                "above": ("DIF > 0（零軸上）", mc & above0),
                "below": ("DIF ≤ 0", mc & ~above0),
            },
        )
    )
    # 7／8 投信、外資連買（walk-forward 參數格）
    avgv = f["avgv"]
    dims: dict[str, list[Any]] = {
        "n": [int(x) for x in p["chip_runs"]],
        "門檻": [float(x) for x in p["chip_thresholds"]],
    }
    for key, name, net in (("trust_run", "投信", f["trust"]), ("foreign_run", "外資", f["foreign"])):
        grid = _grid(dims, lambda n, 門檻, net=net: ind.consecutive_buy(net, avgv, n, 門檻))
        tests.append(
            Test(
                key,
                f"{name}連買",
                "籌碼",
                "event",
                "insti",
                fin(net) & fin(avgv),
                f"{name}淨買超 > 0 連續 n 日（n = 3、5、10），事件為第 n 日；且 n 日累計淨買超 ÷ 前 20 日均量 ≥ 門檻（0.1、0.3、0.5）。"
                + ("外資＝外陸資，不含外資自營商。" if name == "外資" else ""),
                grid=grid,
                grid_dims=list(dims),
            )
        )
    # 9 外資投信同步
    sd: dict[str, list[Any]] = {"門檻": [float(x) for x in p["chip_thresholds"]]}
    tests.append(
        Test(
            "sync",
            "外資投信同步買超",
            "籌碼",
            "event",
            "insti",
            fin(f["foreign"]) & fin(f["trust"]),
            "近 5 日外資與投信累計淨買超皆 > 0，且兩者合計 ÷ 前 20 日均量 ≥ 門檻；事件為首次同時成立日。",
            grid=_grid(sd, lambda 門檻: ind.sync_buy(f["foreign"], f["trust"], avgv, int(p["sync_days"]), 門檻)),
            grid_dims=list(sd),
        )
    )
    # 10 外資極端買超
    with np.errstate(invalid="ignore", divide="ignore"):
        fx1 = f["foreign"] / avgv
    fx5 = ind.chip_ratio(f["foreign"], avgv, 5)
    lb, q, mo = int(p["extreme_lookback"]), float(p["extreme_pct"]), int(p["extreme_min_obs"])
    tests.append(
        Test(
            "foreign_extreme",
            "外資極端買超",
            "籌碼",
            "event",
            "insti",
            fin(fx1),
            "當日外資淨買超 ÷ 前 20 日均量，達該股自身近 250 日（不含當日）的第 95 百分位以上且 > 0；事件為當日。檢驗極端買超後 5／20 日是否反轉。",
            variants={
                "main": ("當日", ind.extreme(fx1, lb, q, mo)),
                "sum5": ("近 5 日累計", ind.extreme(fx5, lb, q, mo)),
            },
            horizons_focus=[5, 20],
        )
    )
    # 11 自營商避險急增
    hx5 = ind.chip_ratio(f["hedge"], avgv, 5)
    tests.append(
        Test(
            "hedge_surge",
            "自營商避險買超急增",
            "籌碼",
            "event",
            "hedge",
            fin(hx5),
            "自營商（避險）近 5 日累計淨買超 ÷ 前 20 日均量，達該股近 250 日第 95 百分位以上且 > 0。作為散戶權證買進的代理變數，檢驗是否為反向指標。",
            variants={"main": ("全部", ind.extreme(hx5, lb, q, mo))},
        )
    )
    # 12 千張大戶週增
    wc = ev.whale_chg
    wd: dict[str, list[Any]] = {"門檻": [float(x) for x in p["whale_thresholds"]]}
    with np.errstate(invalid="ignore"):
        tests.append(
            Test(
                "whale_up",
                "千張大戶週增",
                "籌碼",
                "event",
                "whale_chg",
                fin(f["whale_chg_asof"]),
                "千張以上持股比例週變化 ≥ 門檻（0.1、0.3、0.5 個百分點）；生效日為公布日（週六），進場為下週一開盤。",
                grid=_grid(wd, lambda 門檻: wc >= 門檻),
                grid_dims=list(wd),
                note="樣本範圍受限：千張大戶歷史目前只涵蓋部分股票（全市場回補進行中），資料補齊後每日 pipeline 自動重算。",
            )
        )
    # 13 融資四象限
    ud, uu = ind.margin_quadrant(
        ev.close, ev.margin, int(p["margin_days"]), float(p["margin_price_pct"]), float(p["margin_change_pct"])
    )
    margin_ok = fin(ev.margin)
    tests.append(
        Test(
            "margin_up_down",
            "價漲資減",
            "籌碼",
            "event",
            "margin",
            margin_ok,
            "股價 5 日 ≥ +3% 且融資餘額 5 日 ≤ −3%；事件為首次成立日。與「價漲資增」比較。",
            variants={"main": ("全部", ud)},
        )
    )
    tests.append(
        Test(
            "margin_up_up",
            "價漲資增",
            "籌碼",
            "event",
            "margin",
            margin_ok,
            "股價 5 日 ≥ +3% 且融資餘額 5 日 ≥ +3%；事件為首次成立日。與「價漲資減」比較。",
            variants={"main": ("全部", uu)},
        )
    )
    # 14–16 月營收
    rf = f["rev"]
    rev_ok = fin(f["rev_yoy"])
    tests.append(
        Test(
            "rev_high12",
            "營收創 12 個月新高",
            "基本面",
            "event",
            "revenue",
            rev_ok,
            "當月營收 > 前 12 個月最高；生效日為次月 10 日（法定期限；歷史資料沒有各公司公布日），進場為生效日之後第一個交易日開盤。",
            variants={"main": ("全部", ind.revenue_event(rf, "high12", T, ev.codes))},
        )
    )
    tests.append(
        Test(
            "rev_accel",
            "營收年增連 3 月擴大",
            "基本面",
            "event",
            "revenue",
            rev_ok,
            "年增率(t) > 年增率(t−1) > 年增率(t−2) 且年增率(t) > 0；生效日同上。",
            variants={"main": ("全部", ind.revenue_event(rf, "accel", T, ev.codes))},
        )
    )
    pub = ind.revenue_event(rf.assign(any=True), "any", T, ev.codes)
    ret_pct = ind.cs_percentile(f["ret20"], universe)
    with np.errstate(invalid="ignore"):
        led = pub & (ret_pct >= float(p["price_lead_top"]) * 100)
        rising = f["rev_dyoy"] > 0
    tests.append(
        Test(
            "lead_up",
            "公布前先漲・營收轉強",
            "基本面",
            "event",
            "revenue",
            rev_ok,
            "營收生效日前 20 個交易日報酬在 universe 內前 10%，且年增率較上月上升。檢驗先漲的股票公布後延續或反轉。",
            variants={"main": ("全部", led & rising)},
        )
    )
    tests.append(
        Test(
            "lead_down",
            "公布前先漲・營收轉弱",
            "基本面",
            "event",
            "revenue",
            rev_ok,
            "營收生效日前 20 個交易日報酬在 universe 內前 10%，且年增率較上月下降。",
            variants={"main": ("全部", led & ~rising & fin(f["rev_dyoy"]))},
        )
    )
    # 17–20 組合（各單一條件另列）
    with np.errstate(invalid="ignore"):
        rs80 = rs >= float(p["combo_rs"])
        trun = ind.run_length(f["trust"] > 0) >= int(p["combo_trust_run"])
        accel = f["rev_accel_asof"] >= 1
        value_ok = ev.value >= 2e7
    rs80_ok, t_ok = fin(rs), fin(f["trust"])
    tests.append(
        Test(
            "combo_rs_trust",
            "RS80＋投信連買",
            "組合",
            "event",
            "insti",
            rs80_ok & t_ok,
            "RS 百分位 ≥ 80 且投信連買 ≥ 3 日；事件為兩者首次同時成立日。",
            variants={
                "main": ("組合", ind.first_true(rs80 & trun, rs80_ok & t_ok)),
                "rs80": ("單一：RS 百分位站上 80", ind.cross_up(rs, float(p["combo_rs"]))),
                "trust3": ("單一：投信連買第 3 日", ind.run_length(f["trust"] > 0) == int(p["combo_trust_run"])),
            },
            components=["rs80", "trust3"],
        )
    )
    tests.append(
        Test(
            "combo_rs_rev",
            "RS80＋營收加速",
            "組合",
            "event",
            "revenue",
            rs80_ok & rev_ok,
            "RS 百分位 ≥ 80 且最新月營收為「年增連 3 月擴大」；事件為兩者首次同時成立日。",
            variants={
                "main": ("組合", ind.first_true(rs80 & accel, rs80_ok & rev_ok)),
                "rs80": ("單一：RS 百分位站上 80", ind.cross_up(rs, float(p["combo_rs"]))),
                "accel": ("單一：營收年增連 3 月擴大", ind.revenue_event(rf, "accel", T, ev.codes)),
            },
            components=["rs80", "accel"],
        )
    )
    b60, _ = ind.breakout(ev.close, 60)
    tests.append(
        Test(
            "combo_bo_trust",
            "60 日突破＋投信連買",
            "組合",
            "event",
            "insti",
            t_ok & fin(vr),
            "60 日新高突破且量能 ≥ 1.5 倍，當天投信已連買 ≥ 3 日。",
            variants={
                "main": ("組合", b60 & big_vol & trun),
                "bo": ("單一：60 日突破且量能 ≥ 1.5 倍", b60 & big_vol),
                "trust3": ("單一：投信連買第 3 日", ind.run_length(f["trust"] > 0) == int(p["combo_trust_run"])),
            },
            components=["bo", "trust3"],
        )
    )
    three_ok = t_ok & fin(f["whale_chg_asof"])
    # v3 M4：三方同買全參數格（投信連買 n × 外資 5 日累計佔均量門檻 × 大戶週增門檻），walk-forward 選參數；
    # 選定參數的單一條件與兩兩組合另列（證明第三個條件有增量）
    run_t = ind.run_length(f["trust"] > 0)
    f5r = ind.chip_ratio(f["foreign"], avgv, 5)
    wc_asof = f["whale_chg_asof"]

    def three_parts(n: int, fthr: float, wthr: float) -> dict[str, np.ndarray]:
        with np.errstate(invalid="ignore"):
            return {
                "trust": (run_t >= int(n)) & value_ok,
                "foreign": (f5r > 0) & (f5r >= float(fthr)) & value_ok,
                "whale": (wc_asof >= float(wthr)) & value_ok,
            }

    def three_cell(n: int, fthr: float, wthr: float) -> np.ndarray:
        p3 = three_parts(n, fthr, wthr)
        return ind.first_true(p3["trust"] & p3["foreign"] & p3["whale"], three_ok)

    def three_components(prm: dict[str, Any]) -> dict[str, tuple[str, np.ndarray]]:
        n, fthr, wthr = int(prm["投信連買"]), float(prm["外資門檻"]), float(prm["大戶門檻"])
        p3 = three_parts(n, fthr, wthr)
        lab = {
            "trust": f"投信連買 ≥ {n} 日",
            "foreign": f"外資 5 日累計 > 0 且 ≥ 均量 {fthr:g}",
            "whale": f"大戶週增 ≥ {wthr:g} 個百分點",
        }
        out: dict[str, tuple[str, np.ndarray]] = {}
        for k in ("trust", "foreign", "whale"):
            out[f"only_{k}"] = (f"單一：{lab[k]}", ind.first_true(p3[k], three_ok))
        for a, b in (("trust", "foreign"), ("trust", "whale"), ("foreign", "whale")):
            out[f"pair_{a}_{b}"] = (f"兩兩：{lab[a]}＋{lab[b]}", ind.first_true(p3[a] & p3[b], three_ok))
        return out

    td: dict[str, list[Any]] = {
        "投信連買": [int(x) for x in p.get("three_trust_runs", [3, 5, 10])],
        "外資門檻": [float(x) for x in p.get("three_foreign_thresholds", [0, 0.1, 0.3])],
        "大戶門檻": [float(x) for x in p.get("three_whale_thresholds", [0.1, 0.3, 0.5])],
    }
    tests.append(
        Test(
            "combo_three",
            "三方同買",
            "組合",
            "event",
            "whale_chg",
            three_ok,
            "投信連買 ≥ n 日（3、5、10）、外資近 5 日累計淨買超 > 0 且 ÷ 前 20 日均量 ≥ 門檻（0、0.1、0.3）、千張大戶最新一週增加 ≥ 門檻（0.1、0.3、0.5 個百分點）、當日成交值 ≥ 2,000 萬；"
            "事件為首次同時成立日。27 格 walk-forward 選參數；選定參數的三個單一條件與三組兩兩組合並列（內建策略「三方同買」）。",
            grid=_grid(td, lambda 投信連買, 外資門檻, 大戶門檻: three_cell(投信連買, 外資門檻, 大戶門檻)),
            grid_dims=list(td),
            note="樣本範圍受限：千張大戶歷史目前只涵蓋部分股票（全市場回補進行中）。",
            components_fn=three_components,
        )
    )

    def near_three(prm: dict[str, Any]) -> np.ndarray:
        """今日接近觸發：選定參數下三個條件成立兩個。"""
        p3 = three_parts(int(prm["投信連買"]), float(prm["外資門檻"]), float(prm["大戶門檻"]))
        return (p3["trust"].astype(int) + p3["foreign"].astype(int) + p3["whale"].astype(int)) == 2

    tests[-1].near_fn = near_three

    _attach_near(tests, ev, f, p)
    _attach_basis(tests, ev, f, p)

    # 1.6 分組檢定
    for tid, label, data, vals, note in (
        ("q_rs", "RS 百分位", "price", rs, ""),
        ("q_high52", "距 52 週高點比率", "price", h, ""),
        ("q_bias", "20 日乖離率", "price", bs, ""),
        ("q_kd", "KD 的 K 值", "price", K, ""),
        ("q_trust", "投信 20 日累計淨買超佔均量比", "insti", f["trust20"], ""),
        ("q_foreign", "外資 20 日累計淨買超佔均量比", "insti", f["foreign20"], ""),
        ("q_whale", "千張大戶 4 週變化", "whale_chg", asof_chg4(ev), "樣本範圍受限（全市場回補進行中）。"),
        ("q_rev_yoy", "營收年增率", "revenue", f["rev_yoy"], ""),
        ("q_rev_dyoy", "營收年增率變化量", "revenue", f["rev_dyoy"], ""),
    ):
        tests.append(
            Test(
                tid,
                f"分組：{label}",
                _family(data),
                "quintile",
                data,
                fin(vals),
                f"每月最後一個交易日依「{label}」把 universe 分五組（Q1 最低、Q5 最高），等權重持有到下個月最後一個交易日（隔日開盤進出、扣成本）。",
                values=vals,
                note=note,
            )
        )
    return tests


def _family(data: str) -> str:
    return {"price": "動能", "insti": "籌碼", "whale_chg": "籌碼", "revenue": "基本面"}.get(data, "其他")


def _cross_strict(x: np.ndarray, level: float) -> np.ndarray:
    """當日 > level 且前一日 ≤ level。"""
    prev = ind.shift(x, 1)
    with np.errstate(invalid="ignore"):
        return (x > level) & (prev <= level)


def asof_chg4(ev: Any) -> np.ndarray:
    return np.asarray(ev.whale_chg4)


def _attach_basis(tests: list[Test], ev: Any, f: dict[str, Any], p: dict[str, Any]) -> None:
    """各指標觸發當天的條件數值（只用於顯示「觸發依據」，事先決定、不影響評估）。"""
    by = {t.id: t for t in tests}
    with np.errstate(invalid="ignore", divide="ignore"):
        run_t = ind.run_length(f["trust"] > 0).astype(float)
        run_f = ind.run_length(f["foreign"] > 0).astype(float)
        f5r = ind.chip_ratio(f["foreign"], f["avgv"], 5)
        t5r = ind.chip_ratio(f["trust"], f["avgv"], 5)
        px5 = ind.ret(ev.close, 5)
        mg5 = ev.margin / ind.shift(ev.margin, 5) - 1
        k_run = ind.run_length(f["K"] >= float(p["kd_high"])).astype(float)
        lead = ind.cs_percentile(f["ret20"], np.isfinite(f["ret20"]))
    value = (ev.value, "百萬元", 1e-6, 0)
    table: dict[str, list[tuple[str, np.ndarray, str, float, int]]] = {
        "high52": [("收盤 ÷ 52 週高點", f["h52"], "%", 100, 1), ("20 日乖離", f["bias20"], "%", 100, 1)],
        "rs90": [("RS 百分位", f["rs_pct"], "", 1, 1), ("20 日乖離", f["bias20"], "%", 100, 1)],
        "bias15": [("20 日乖離", f["bias20"], "%", 100, 1), ("RS 百分位", f["rs_pct"], "", 1, 1)],
        "margin_up_up": [("股價 5 日", px5, "%", 100, 1), ("融資 5 日", mg5, "%", 100, 1)],
        "rev_high12": [("最新月營收年增", f["rev_yoy"], "%", 1, 1), ("年增率變化", f["rev_dyoy"], "百分點", 1, 1)],
        "rev_accel": [("最新月營收年增", f["rev_yoy"], "%", 1, 1), ("年增率變化", f["rev_dyoy"], "百分點", 1, 1)],
        "lead_up": [("前 20 日漲幅百分位", lead, "", 1, 0), ("最新月營收年增", f["rev_yoy"], "%", 1, 1)],
        "combo_rs_trust": [("RS 百分位", f["rs_pct"], "", 1, 1), ("投信連買", run_t, "日", 1, 0)],
        "trust_run": [("投信連買", run_t, "日", 1, 0), ("投信 5 日累計 ÷ 均量", t5r, "", 1, 2)],
        "foreign_run": [("外資連買", run_f, "日", 1, 0), ("外資 5 日累計 ÷ 均量", f5r, "", 1, 2)],
        "sync": [("外資 5 日累計 ÷ 均量", f5r, "", 1, 2), ("投信 5 日累計 ÷ 均量", t5r, "", 1, 2)],
        "kd_run": [("K 值", f["K"], "", 1, 1), ("K ≥ 80 連續", k_run, "日", 1, 0)],
        "combo_three": [
            ("投信連買", run_t, "日", 1, 0),
            ("外資 5 日累計 ÷ 均量", f5r, "", 1, 2),
            ("千張大戶週變化", f["whale_chg_asof"], "百分點", 1, 2),
        ],
        "whale_up": [
            ("千張大戶週變化", f["whale_chg_asof"], "百分點", 1, 2),
            ("千張大戶持股比", ev.whale_pct, "%", 1, 2),
        ],
    }
    for tid, items in table.items():
        if tid in by:
            by[tid].basis = [*items, ("當日成交值", *value)]


def _attach_near(tests: list[Test], ev: Any, f: dict[str, Any], p: dict[str, Any]) -> None:
    """「接近觸發」的定義（事先決定；只用來顯示個股目前狀態，不影響評估）。"""
    by = {t.id: t for t in tests}
    with np.errstate(invalid="ignore", divide="ignore"):
        rs, h, bs, kv = f["rs_pct"], f["h52"], f["bias20"], f["K"]
        by["rs90"].near = (rs >= 85) & (rs < 90)  # RS 百分位 85–90
        by["high52"].near = (h >= 0.93) & (h < 0.95)  # 距 52 週高點 5–7%
        for n in p["breakout_n"]:
            level = ind.shift(ind.rolling(ev.close, int(n), "max"), 1)
            by[f"breakout{n}"].near = (ev.close >= level * 0.98) & (ev.close <= level)  # 收盤在前 N 日高點 2% 內
        by["bias15"].near = (bs >= 0.12) & (bs <= 0.15)
        rl = ind.run_length(kv >= float(p["kd_high"]))
        by["kd_run"].near = (rl >= 3) & (rl < int(p["kd_run"]))
        by["kd_drop"].near = (rl >= int(p["kd_run"])) & (kv < 85)
        hist = f["hist"]
        by["macd"].near = (hist <= 0) & (hist > ind.shift(hist, 1)) & (ind.shift(hist, 1) > ind.shift(hist, 2))
        for key, net in (("trust_run", f["trust"]), ("foreign_run", f["foreign"])):
            run = ind.run_length(net > 0)
            by[key].near_fn = lambda prm, run=run: run == int(prm["n"]) - 1
        f5 = ind.rolling(f["foreign"], 5, "sum")
        t5 = ind.rolling(f["trust"], 5, "sum")
        by["sync"].near = ((f5 > 0) & (t5 <= 0)) | ((t5 > 0) & (f5 <= 0))  # 只有一方買超
        by["margin_up_up"].near = (ind.ret(ev.close, 5) >= 0.02) & (ev.margin / ind.shift(ev.margin, 5) - 1 >= 0.02)
        by["margin_up_down"].near = (ind.ret(ev.close, 5) >= 0.02) & (ev.margin / ind.shift(ev.margin, 5) - 1 <= -0.02)
        wc = f["whale_chg_asof"]
        by["whale_up"].near_fn = lambda prm: (wc > 0) & (wc < float(prm["門檻"]))
        rs80 = rs >= float(p["combo_rs"])
        trun = ind.run_length(f["trust"] > 0) >= int(p["combo_trust_run"])
        by["combo_rs_trust"].near = rs80 ^ trun  # 只成立一個條件
        by["combo_rs_rev"].near = rs80 ^ (f["rev_accel_asof"] >= 1)
