"""指標效度評估的主流程：載入 → universe → 市場資料 → 每個項目的事件研究／分組檢定 → 判定 → 出場比較 → 報告。"""

from __future__ import annotations

import logging
import time
from datetime import datetime
from typing import Any

import numpy as np
import pandas as pd

from pipeline.core.dates import TPE
from pipeline.evidence import catalog, curve, engine, exits, quintile, stats, universe, verdict
from pipeline.evidence import indicators as ind
from pipeline.evidence.data import EvData, cfg

log = logging.getLogger(__name__)


def period_start(test: catalog.Test, ev: EvData, uni: np.ndarray, c: dict[str, Any]) -> str | None:
    """訊號期間起點：指標第一次可計算的日子（價格類另以 price_start 為下限）。"""
    ok = (test.avail & uni).any(axis=1)
    if not ok.any():
        return None
    first = ev.dates[int(np.argmax(ok))]
    if test.data == "price":
        first = max(first, str(c["price_start"]))
    return first


def coverage_label(ratio: float, c: dict[str, Any]) -> str | None:
    """涵蓋率標示：< 50% 樣本範圍受限；50–90% 部分涵蓋；≥ 90% 不標示。"""
    v = c["verdict"]
    if ratio < float(v["coverage_ratio"]):
        return "樣本範圍受限"
    if ratio < float(v.get("coverage_full", 0.9)):
        return "部分涵蓋"
    return None


def coverage(
    test: catalog.Test, ev: EvData, uni: np.ndarray, start: str, c: dict[str, Any] | None = None
) -> dict[str, Any]:
    """v3 M0-3 涵蓋率（唯一定義）：每個訊號日「universe 內指標可計算的股票數 ÷ 該日 universe 股票數」，
    以訊號日加權平均＝Σ每日可計算檔數 ÷ Σ每日 universe 檔數（每一天的權重＝當天 universe 檔數，也就是
    所有（訊號日, 股票）組合中有資料的比例）。

    畫面上的「納入 x／y 檔」＝每日平均可計算檔數／每日平均 universe 檔數，x ÷ y 就是涵蓋率，兩者一定對得上。
    另列期間內「曾經」納入與 universe 的不重複檔數（ever_*），只用來統計下市股票，不與涵蓋率並列。
    """
    rows = np.asarray(ev.dates) >= start
    u = uni[rows]
    a = u & test.avail[rows]
    du, da = u.sum(axis=1), a.sum(axis=1)
    days = du > 0
    ratio = float(da[days].sum() / du[days].sum()) if days.any() else 0.0
    out: dict[str, Any] = {
        "ratio": round(ratio, 4),
        "included": round(float(da[days].mean())) if days.any() else 0,
        "universe": round(float(du[days].mean())) if days.any() else 0,
        "ever_included": int(a.any(axis=0).sum()),
        "ever_universe": int(u.any(axis=0).sum()),
        # v3 M1-3：期間內曾經納入的股票中，官方已終止上市櫃的檔數
        "ever_delisted": int(
            sum(1 for i in np.nonzero(a.any(axis=0))[0] if ev.codes[i] in getattr(ev, "delist_date", {}))
        ),
        "days": int(days.sum()),
    }
    if c is not None:
        out["label"] = coverage_label(ratio, c)
    return out


def weekly_coverage(avail: np.ndarray, uni: np.ndarray, dates: list[str], start: str | None) -> list[dict[str, Any]]:
    """每週涵蓋率（指標頁折線圖）：同一 ISO 週內 Σ可計算 ÷ Σuniverse，日期標在該週最後一個交易日。"""
    if start is None:
        return []
    d = pd.to_datetime(pd.Series(dates))
    keep = (np.asarray(dates) >= start) & (uni.sum(axis=1) > 0)
    a = (avail & uni).sum(axis=1)
    u = uni.sum(axis=1)
    df = pd.DataFrame({"date": np.asarray(dates), "a": a, "u": u, "wk": d.dt.to_period("W-SUN").astype(str)})[keep]
    out = []
    for _, g in df.groupby("wk", sort=True):
        out.append(
            {
                "date": str(g["date"].iloc[-1]),
                "ratio": round(float(g["a"].sum() / g["u"].sum()), 4),
                "included": round(float(g["a"].mean())),
                "universe": round(float(g["u"].mean())),
            }
        )
    return out


def windows(start: str, end: str) -> list[tuple[str, str]]:
    """walk-forward：第 1 年、第 2 年、第 3 年（到資料結束）。資料不足一年時只有一段（無法 walk-forward）。"""
    s = pd.Timestamp(start)
    last = pd.Timestamp(end)
    stop = (last + pd.Timedelta(days=1)).date().isoformat()
    y1, y2 = s + pd.DateOffset(years=1), s + pd.DateOffset(years=2)
    if y1 > last:
        return [(start, stop)]
    if y2 > last:
        return [(start, y1.date().isoformat()), (y1.date().isoformat(), stop)]
    return [
        (start, y1.date().isoformat()),
        (y1.date().isoformat(), y2.date().isoformat()),
        (y2.date().isoformat(), stop),
    ]


class EventRunner:
    def __init__(self, ev: EvData, mk: engine.Market, uni: np.ndarray, c: dict[str, Any]):
        self.ev, self.mk, self.uni, self.c = ev, mk, uni, c
        self.dates = np.asarray(ev.dates)

    def frames(self, mask: np.ndarray, start: str, horizons: list[int] | None = None) -> dict[int, pd.DataFrame]:
        """各持有期的事件表；horizons 省略＝全部（含只供參考的 120 日）。參數格與變體只算判定用的持有期（v3 M3 效能）。"""
        m = mask & (self.dates >= start)[:, None]
        t, cc = engine.events_from_mask(m, self.uni)
        hs = horizons or self.mk.horizons
        return {h: engine.annotate(engine.evaluate(self.mk, t, cc, h), self.mk) for h in hs}

    def result(self, frames: dict[int, pd.DataFrame], oos_start: str | None, light: bool = False) -> dict[str, Any]:
        """一組訊號：原始觸發次數、各持有期的去重統計與分組（light：參數格只要主統計，不算分組）。"""
        out: dict[str, Any] = {"raw": 0, "horizons": {}}
        for h, df in frames.items():
            out["raw"] = len(df)
            status = df["status"].value_counts().to_dict()
            d = engine.dedupe(df)
            s = stats.summarize(d, self.c, h)
            if light:
                out["horizons"][str(h)] = s
                continue
            s["groups"] = stats.groups(d, self.c, oos_start)
            nogap = engine.dedupe(df[~df["gap"]])
            s["no_gap"] = stats.brief(nogap, self.c)
            s["excluded"] = {
                "limit_up": int(status.get("limit_up", 0)),
                "suspended": int(status.get("suspended", 0)),
                "pending": int(status.get("pending", 0)),
                "no_price": int(status.get("no_price", 0)),
            }
            s["gap_events"] = int(d["gap"].sum())
            out["horizons"][str(h)] = s
        return out


def evaluate_event(test: catalog.Test, r: EventRunner, start: str, end: str) -> dict[str, Any]:
    c = r.c
    H = str(int(c["primary_horizon"]))
    oos_default = stats.oos_cut([start, end], float(c["stats"]["oos_fraction"]))
    res: dict[str, Any] = {"variants": {}, "grid": None}
    main_frames: dict[int, pd.DataFrame] | None = None
    sensitive = False
    oos: dict[str, Any] | None = None
    if test.grid:
        dims = {k: sorted({cell.params[k] for cell in test.grid}) for k in test.grid_dims}
        wins = windows(start, end)
        cell_frames = {cell.key: r.frames(cell.mask, start, [int(H)]) for cell in test.grid}
        cell_res = {k: r.result(fr, oos_default, light=True) for k, fr in cell_frames.items()}
        table = []
        for cell in test.grid:
            s = cell_res[cell.key]["horizons"][H]
            table.append(
                {
                    "key": cell.key,
                    "params": cell.params,
                    "raw": cell_res[cell.key]["raw"],
                    **{k: s.get(k) for k in ("n", "mean_excess", "t", "ci", "win", "mae")},
                }
            )
        # walk-forward：第 1 年選參數 → 第 2 年驗證；第 1–2 年選 → 第 3 年驗證
        wf, chosen = [], None
        oos_parts = []
        for i in range(1, len(wins)):
            lo, hi = wins[0][0], wins[i - 1][1]
            best, best_m = None, None
            for cell in test.grid:
                d = engine.dedupe(cell_frames[cell.key][int(H)])
                d = d[(d["date"] >= lo) & (d["date"] < hi)]
                if len(d) < int(c["verdict"]["wf_min_events"]):
                    continue
                m = stats.mean_t(stats.calendar_series(d).to_numpy())[0]
                if m is not None and (best_m is None or m > best_m):
                    best, best_m = cell, m
            if best is None:
                continue
            d = engine.dedupe(cell_frames[best.key][int(H)])
            vd = d[(d["date"] >= wins[i][0]) & (d["date"] < wins[i][1])]
            oos_parts.append(vd)
            wf.append(
                {
                    "train": [lo, hi],
                    "valid": list(wins[i]),
                    "param": best.key,
                    "train_mean": stats.pct(best_m),
                    **stats.brief(vd, c),
                }
            )
            chosen = best
        default_note = ""
        if chosen is None:
            # 資料不足一年以上，無法 walk-forward：用參數格中間的格子（事先決定），並註明
            chosen = test.grid[len(test.grid) // 2]
            default_note = "資料期間不足以 walk-forward，採用參數格中間值（事先決定，未依結果挑選）"
        grid_means = {row["key"]: row["mean_excess"] for row in table}
        nb = catalog.neighbors(test.grid, dims, chosen)
        sensitive = verdict.sensitivity(grid_means, chosen.key, nb, float(c["verdict"]["sensitive_ratio"]))
        res["grid"] = {
            "dims": dims,
            "table": table,
            "chosen": chosen.key,
            "neighbors": nb,
            "walk_forward": wf,
            "sensitive": sensitive,
            "note": default_note,
        }
        main_frames = r.frames(chosen.mask, start)  # 選定格：全部持有期與分組
        res["variants"]["main"] = {"label": f"選定參數 {chosen.key}", **r.result(main_frames, oos_default)}
        if oos_parts:
            oos = {**stats.brief(pd.concat(oos_parts), c), "start": wf[0]["valid"][0], "kind": "walk_forward"}
        test.variants["main"] = (res["variants"]["main"]["label"], chosen.mask)
        if test.components_fn is not None:  # v3 M4：選定參數的單一條件與兩兩組合
            comps = test.components_fn(chosen.params)
            test.variants.update(comps)
            test.components = list(comps)
    for key, (label, mask) in test.variants.items():
        if key == "main" and test.grid:
            continue
        fr = r.frames(mask, start, None if key == "main" else [int(H)])
        vres = {"label": label, **r.result(fr, oos_default)}
        if test.breakout_level is not None:
            fb = fr[int(H)]
            ok = fb[fb["status"] == "ok"]
            fbr = ind.false_breakout(r.ev.close, test.breakout_level, ok["t"].to_numpy(), ok["c"].to_numpy())
            vres["false_breakout"] = stats.pct(float(np.nanmean(fbr))) if np.isfinite(fbr).any() else None
        res["variants"][key] = vres
        if key == "main":
            main_frames = fr
    main = res["variants"]["main"]["horizons"][H]
    if oos is None:
        oos = main["groups"].get("oos")
    res["oos"] = oos
    res["main_frames"] = main_frames
    res["sensitive"] = sensitive
    return res


def per_day_table(hs: dict[str, Any], c: dict[str, Any]) -> dict[str, Any]:
    """v3 M3-3 每持有日超額：超額 ÷ N × 250（年化），附去重樣本數與 t；120 日標為參考。"""
    scale = float((c.get("curve") or {}).get("per_day_scale", 250))
    ref = {int(x) for x in c.get("horizons_ref") or []}
    out = {}
    for k, s in hs.items():
        m = s.get("mean_excess")
        out[k] = {
            "n": s.get("n", 0),
            "mean_excess": m,
            "t": s.get("t"),
            "per_day_ann": None if m is None else round(m / int(k) * scale, 2),
            "ref": int(k) in ref,
        }
    return out


def choose_n(frames: dict[int, pd.DataFrame], wins: list[tuple[str, str]], c: dict[str, Any]) -> dict[str, Any]:
    """v3 M3-3：持有天數 N 以 walk-forward 選擇（訓練窗內「每持有日年化超額」最高者，樣本 ≥ wf_min_events），
    驗證期報告選定 N 的表現；不挑全樣本的最大值。120 日（參考）不參與。"""
    scale = float((c.get("curve") or {}).get("per_day_scale", 250))
    cand = [int(h) for h in c["horizons"]]
    steps = []
    for i in range(1, len(wins)):
        lo, hi = wins[0][0], wins[i - 1][1]
        best, best_v = None, None
        for n in cand:
            if n not in frames:
                continue
            d = engine.dedupe(frames[n])
            d = d[(d["date"] >= lo) & (d["date"] < hi)]
            if len(d) < int(c["verdict"]["wf_min_events"]):
                continue
            m = stats.mean_t(stats.calendar_series(d).to_numpy())[0]
            if m is None:
                continue
            v = m / n * scale
            if best_v is None or v > best_v:
                best, best_v = n, v
        if best is None:
            continue
        d = engine.dedupe(frames[best])
        vd = d[(d["date"] >= wins[i][0]) & (d["date"] < wins[i][1])]
        b = stats.brief(vd, c)
        steps.append(
            {
                "train": [lo, hi],
                "valid": list(wins[i]),
                "n_days": best,
                "train_per_day_ann": stats.pct(best_v),
                "valid_mean_excess": b.get("mean_excess"),
                "valid_per_day_ann": None
                if b.get("mean_excess") is None
                else round(b["mean_excess"] / best * scale, 2),
                "valid_n": b.get("n", 0),
            }
        )
    return {"steps": steps, "chosen": steps[-1]["n_days"] if steps else None}


def curve_summary(cv: dict[str, Any]) -> dict[str, Any]:
    """總表用：等權與 0050 的峰值日、峰值累積超額與峰值是否落在觀察窗邊界（2026-10-03 移除 alpha 耗盡日）。"""
    out: dict[str, Any] = {"n": cv.get("n", 0), "days": cv.get("days") or len(cv.get("k") or [])}
    for key in ("ew", "0050"):
        b = cv.get(key) or {}
        if not b:
            continue
        pk = b.get("peak")
        out[key] = {
            "peak": pk,
            "peak_at_edge": bool(b.get("peak_at_edge")),
            "peak_value": b["mean"][pk - 1] if pk else None,
            "at10": b["mean"][9] if len(b.get("mean", [])) >= 10 else None,
        }
    return out


def large_cap_flag(v: str, main: dict[str, Any], t_thr: float) -> str | None:
    """判定為有效或環境依賴（以等權基準），但相對 0050 不顯著（平均 ≤ 0、t 未達門檻或區間含 0）→「未勝過大型股」。"""
    if v not in (verdict.VALID, verdict.ENV):
        return None
    b = (main.get("bench") or {}).get("0050")
    if not b:
        return None
    return None if stats.significant(b, t_thr) else "未勝過大型股"


def survivors(ev: EvData) -> np.ndarray:
    """(C,)：資料最後一個月仍有收盤價的股票（存活者）。只給 M1-3 的「存活者偏差」對照用，不用在正式評估。"""
    tail = max(0, len(ev.dates) - 21)
    return np.isfinite(ev.raw_close[tail:]).any(axis=0)


def evaluate(
    ev: EvData, *, only: list[str] | None = None, with_exits: bool = True, survivor_only: bool = False
) -> dict[str, Any]:
    t0 = time.monotonic()
    c = cfg()
    uni = universe.build(ev, c["universe"])
    if survivor_only:  # 對照組：只留到最後還在交易的股票（刻意製造存活者偏差，量化下市股票的影響）
        uni = uni & survivors(ev)[None, :]
    mk = engine.market(ev, uni, c)
    log.info("universe 與市場資料：%.0f 秒", time.monotonic() - t0)
    f = ind.build_features(ev, uni, c["indicators"])
    tests = catalog.build(ev, f, c["indicators"], uni)
    log.info("指標面板：%.0f 秒", time.monotonic() - t0)
    r = EventRunner(ev, mk, uni, c)
    H = str(int(c["primary_horizon"]))
    end = ev.dates[-1]
    rows, details = [], {}
    today: dict[str, Any] = {}
    keep: dict[str, dict[str, Any]] = {}
    weekly: dict[str, list[dict[str, Any]]] = {}
    for test in tests:
        if only and test.id not in only:
            continue
        start = period_start(test, ev, uni, c)
        if start is None:
            rows.append(
                {
                    "id": test.id,
                    "label": test.label,
                    "family": test.family,
                    "kind": test.kind,
                    "verdict": verdict.FEW,
                    "reasons": ["沒有資料"],
                    "note": test.note,
                }
            )
            continue
        cov = coverage(test, ev, uni, start, c)
        if test.data == "whale_chg" and "whale" not in weekly and test.kind == "event":
            weekly["whale"] = weekly_coverage(test.avail, uni, ev.dates, start)
        base: dict[str, Any] = {
            "id": test.id,
            "label": test.label,
            "family": test.family,
            "kind": test.kind,
            "definition": test.definition,
            "data_start": ev.starts.get(test.data),
            "signal_start": start,
            "signal_end": end,
            "coverage": cov,
            "note": test.note,
        }
        if test.kind == "quintile":
            assert test.values is not None
            q = quintile.run(test.values, mk, uni, start, c)
            dec = verdict.decide(
                kind="quintile",
                n=q.get("months", 0),
                main=q.get("main", {}),
                years=q.get("years", {}),
                oos=q.get("oos"),
                sensitive=False,
                coverage=cov["ratio"],
                envs=None,
                cfg=c,
                counts=(cov["included"], cov["universe"]),
            )
            qrow: dict[str, Any] = {
                **base,
                **dec,
                "n": q.get("months", 0),
                "t": q.get("main", {}).get("t"),
                "mean_excess": q.get("main", {}).get("mean_excess"),
                "ci": q.get("main", {}).get("ci"),
                "years": {y: v.get("mean_excess") for y, v in q.get("years", {}).items()},
                "oos": q.get("oos", {}).get("mean_excess"),
            }
            rows.append(qrow)
            details[test.id] = {**base, **dec, "quintile": q}
            log.info("%s：%s（%.0f 秒）", test.id, dec["verdict"], time.monotonic() - t0)
            continue
        res = evaluate_event(test, r, start, end)
        main = res["variants"]["main"]["horizons"][H]
        g = main["groups"]
        dec = verdict.decide(
            kind="event",
            n=main.get("n", 0),
            main=main,
            years=g.get("years", {}),
            oos=res["oos"],
            sensitive=res["sensitive"],
            coverage=cov["ratio"],
            envs={k: g[k] for k in ("regime", "trend", "quarter_end")},
            cfg=c,
            counts=(cov["included"], cov["universe"]),
        )
        comp_rows = {k: v for k, v in res["variants"].items() if k in test.components}
        # 近期表現（策略健康度用）：最近 recent_days 個交易日內已完成的訊號 vs 全期間
        mf = res["main_frames"]
        recent = None
        t_corr = None
        if mf is not None:
            d_all = engine.dedupe(mf[int(H)])
            cut = len(ev.dates) - 1 - int(H) - int(c.get("recent_days", 60))
            recent = stats.brief(d_all[d_all["t"] >= cut], c)
            recent["since"] = ev.dates[max(cut, 0)]
            # 2026-10-03：全站統一的校正後 t（指標效度頁顯示用；指標判定仍以日曆時間法 t 為門檻）
            from pipeline.evidence import audit

            pdays = int((np.asarray(ev.dates) >= start).sum())
            t_corr = audit.corrected_t(d_all, int(H), period_days=pdays)["t_corr"] if len(d_all) else None
        main_mask = test.variants["main"][1]
        keep[test.id] = {"mask": main_mask, "start": start, "basis": test.basis}
        # 月營收一個月只觸發一次：近 25 個交易日；其他指標為判定用的持有天數
        today[test.id] = stock_states(test, res, main_mask, ev, uni, 25 if test.data == "revenue" else int(H))
        row = {
            **base,
            **dec,
            "n": main.get("n", 0),
            "raw": res["variants"]["main"]["raw"],
            "t": main.get("t"),
            "t_nw": main.get("t_nw"),
            "t_corr": t_corr,
            "mean_excess": main.get("mean_excess"),
            "ci": main.get("ci"),
            "win": main.get("win"),
            "years": {y: v.get("mean_excess") for y, v in g.get("years", {}).items()},
            "oos": (res["oos"] or {}).get("mean_excess"),
            "env": {
                k: {s: g[k][s].get("mean_excess") for s in ("on", "off")} for k in ("regime", "trend", "quarter_end")
            },
            "h": {
                h: {k: v.get(k) for k in ("n", "mean_excess", "t", "bench")}
                for h, v in res["variants"]["main"]["horizons"].items()
            },
            "param": (res["grid"] or {}).get("chosen"),
            "recent": recent,
            # v3 M2：四種基準（判定仍以等權為準）；對等權有效但對 0050 不顯著 → 「未勝過大型股」
            "bench": main.get("bench"),
            "t_0050": ((main.get("bench") or {}).get("0050") or {}).get("t"),
            "large_cap": large_cap_flag(dec["verdict"], main, float(c["stats"]["t_threshold"])),
            # v3 M1：下市——納入股票中已下市的檔數、持有期間下市的事件數（以最後收盤出場）、保守版本（下市視為 −100%）
            "delist": {
                "stocks": cov.get("ever_delisted", 0),
                "events": main.get("delisted", 0),
                "halted": main.get("halted", 0),
                "dl100": main.get("dl100"),
            },
        }
        if comp_rows:
            row["components"] = {
                k: {
                    "label": v["label"],
                    "n": v["horizons"][H].get("n"),
                    "mean_excess": v["horizons"][H].get("mean_excess"),
                    "t": v["horizons"][H].get("t"),
                }
                for k, v in comp_rows.items()
            }
        detail = {
            **base,
            **dec,
            "variants": res["variants"],
            "grid": res["grid"],
            "oos": res["oos"],
            "delist": row["delist"],
            "bench": row["bench"],
            "large_cap": row["large_cap"],
        }
        # v3 M3-3：每持有日超額（年化）與 walk-forward 選 N
        mf = res["main_frames"]
        row["per_day"] = per_day_table(res["variants"]["main"]["horizons"], c)
        if mf is not None:
            row["n_wf"] = choose_n(mf, windows(start, end), c)
        detail["per_day"], detail["n_wf"] = row["per_day"], row.get("n_wf")
        usable = dec["verdict"] in (verdict.VALID, verdict.ENV)
        peak_train = None
        if mf is not None and (usable or test.id in set((c.get("curve") or {}).get("extra_tests") or [])):
            cc = c.get("curve") or {}
            ded = engine.dedupe(mf[int(H)])
            detail["curve"] = curve.curve(
                mk,
                ded,
                int(cc.get("days", 120)),
                int(c["stats"]["bootstrap"]),
                int(c["stats"]["seed"]),
            )
            row["curve"] = curve_summary(detail["curve"])
            # 第 N 日出場（訓練期峰值）：只用第一個 walk-forward 訓練窗的事件找峰值（不看全樣本）
            w0 = windows(start, end)[0]
            train = ded[ded["date"] < w0[1]] if len(windows(start, end)) > 1 else ded.iloc[: max(1, len(ded) * 2 // 3)]
            # 峰值日出場的 N 不超過出場上限（exits.max_days），所以訓練期曲線只看到第 max_days 日
            tc = curve.curve(mk, train, int(c["exits"]["max_days"]), 0, 0)
            peak_train = (tc.get("ew") or {}).get("peak")
        if with_exits and usable and mf is not None:
            cand = mf[int(H)]
            cand = cand[cand["status"] == "ok"]
            detail["exits"] = exits.compare(mk, cand, ev, c, windows(start, end), peak=peak_train)
            if peak_train:
                detail["exits"]["peak_train"] = {"day": peak_train, "train": list(windows(start, end)[0])}
        if test.id in set(c.get("hindsight_tests") or []):
            row["hindsight"] = hindsight(main_mask, r, start, cov, row, c)
            detail["hindsight"] = row["hindsight"]
        rows.append(row)
        details[test.id] = detail
        log.info("%s：%s n=%s t=%s（%.0f 秒）", test.id, dec["verdict"], row["n"], row["t"], time.monotonic() - t0)
    uni_rows = np.asarray(ev.dates) >= str(c["price_start"])
    meta = {
        "coverage_weekly": weekly,
        "coverage_backfill": backfill_note(weekly.get("whale") or [], getattr(ev, "backfill", {}) or {}),
        "coverage_rule": {
            "limited": float(c["verdict"]["coverage_ratio"]),
            "full": float(c["verdict"].get("coverage_full", 0.9)),
        },
        "generated_at": datetime.now(TPE).isoformat(timespec="seconds"),
        "data_end": end,
        "starts": ev.starts,
        "universe_stocks": int(uni[uni_rows].any(axis=0).sum()),
        "universe_daily_avg": int(uni[uni_rows].sum(axis=1).mean()),
        "bench": "加權報酬指數" if mk.bench_is_tr else "加權指數（取不到報酬指數）",
        "regime_share": round(float(mk.regime_up[uni_rows].mean()), 4),
        # 2026-10-02 健檢：分級（grading）與波段門檻（swing_gates）也輸出，前端的門檻文字從這裡讀，不寫死
        "config": {
            k: c[k]
            for k in (
                "universe",
                "entry",
                "horizons",
                "primary_horizon",
                "secondary_horizon",
                "stats",
                "verdict",
                "grading",
                "swing_gates",
                "t_corr",
                "curve",
                "judge",
            )
            if k in c
        },
        "seconds": round(time.monotonic() - t0),
        "tests": len(rows),
        "price_start": str(c["price_start"]),
    }
    return {
        "meta": meta,
        "rows": rows,
        "details": details,
        # 個股頁只顯示有效與環境依賴的指標
        "today": {
            "date": end,
            "tests": {
                r["id"]: today[r["id"]]
                for r in rows
                if r["id"] in today and r["verdict"] in (verdict.VALID, verdict.ENV)
            },
        },
        # 策略庫（M2）用的中間結果：不寫入 JSON
        "_ctx": {"ev": ev, "mk": mk, "uni": uni, "tests": keep, "cfg": c, "catalog": tests},
    }


def backfill_note(weekly: list[dict[str, Any]], bf: dict[str, Any]) -> str | None:
    """2026-10-02 健檢 M2：千張大戶涵蓋率「從 100% 斷崖掉到 3%」的原因寫在圖下方。

    不是程式退化：集保只公布「本週」全市場（tdcc_holders，自 2026-09-24 起每週存檔），更早的週要用個股歷史查詢
    （tdcc_history，官方只保存一年、每檔一次請求）逐週回補；回補由舊到新進行，所以已回補的週接近 100%、尚未回補的週只有
    原本 31 檔（約 3–5%）。這裡寫出已回補的週區間、尚未回補的週數與預計完成時間（manifest holders_backfill）。
    """
    if not weekly:
        return None
    full = [w for w in weekly if w.get("ratio", 0) >= 0.9]
    low = [w for w in weekly if w.get("ratio", 0) < 0.5]
    parts: list[str] = []
    if full:
        parts.append(f"已回補 {full[0]['date']}～{full[-1]['date']}（{len(full)} 週，涵蓋率 ≥ 90%）")
    if low:
        parts.append(f"{low[0]['date']}～{low[-1]['date']} 共 {len(low)} 週只有原 31 檔（涵蓋率 < 50%）")
    if bf.get("eta"):
        parts.append(
            f"回補進行中（{bf.get('codes', '—')} 檔、已完成 {bf.get('done', '—')} 次查詢），預計 {str(bf['eta'])[:16]} 完成"
        )
    parts.append("集保個股歷史查詢只保存一年，一年以前的週別無法取得；全市場週檔自 2026-09-24 起每週存檔")
    return "涵蓋率落差是回補順序（由舊到新），不是資料錯誤：" + "；".join(parts) + "。"


def hindsight(
    mask: np.ndarray, r: EventRunner, start: str, cov: dict[str, Any], row: dict[str, Any], c: dict[str, Any]
) -> dict[str, Any]:
    """v3 M0-4 後見之明偏差估計：同一個訊號定義，只用「原 31 檔」vs 全市場，差額＝原 31 檔 − 全市場。

    涵蓋率未達 coverage_full（90%）前不比較（全市場版本本身還不完整），回傳 waiting。
    """
    full_at = float(c["verdict"].get("coverage_full", 0.9))
    if cov["ratio"] < full_at:
        return {"status": "waiting", "coverage": cov["ratio"], "threshold": full_at}
    H = int(c["primary_horizon"])
    keep_cols = np.isin(np.asarray(r.ev.codes), [str(x) for x in c.get("hindsight_codes") or []])
    fr = r.frames(mask & keep_cols[None, :], start)
    d = engine.dedupe(fr[H])
    orig = stats.brief(d, c)
    orig["stocks"] = int(d["c"].nunique()) if len(d) else 0
    full = {k: row.get(k) for k in ("n", "mean_excess", "t", "ci")}
    om, fm = orig.get("mean_excess"), full.get("mean_excess")
    return {
        "status": "ok",
        "coverage": cov["ratio"],
        "codes": int(keep_cols.sum()),
        "orig": orig,
        "full": full,
        "bias": None if om is None or fm is None else round(om - fm, 3),
    }


def stock_states(
    test: catalog.Test, res: dict[str, Any], mask: np.ndarray, ev: EvData, uni: np.ndarray, H: int
) -> dict[str, Any]:
    """個股頁「有效訊號面板」：近 H 個交易日內觸發（代號 → 最近一次訊號日）與今日「接近觸發」的股票。"""
    T = len(ev.dates)
    lo = max(0, T - H)
    trig: dict[str, str] = {}
    for t in range(lo, T):
        for i in np.nonzero(mask[t] & uni[t])[0]:
            trig[ev.codes[i]] = ev.dates[t]
    near = test.near
    if near is None and test.near_fn is not None and res.get("grid"):
        chosen = next(cell for cell in test.grid if cell.key == res["grid"]["chosen"])
        near = test.near_fn(chosen.params)
    near_codes = []
    if near is not None:
        near_codes = [ev.codes[i] for i in np.nonzero(near[-1] & uni[-1])[0] if ev.codes[i] not in trig]
    return {"t": trig, "near": near_codes}


WATCH_TESTS = ("combo_three", "whale_up")  # v3 M4-2：涵蓋率達標後判定會改變的指標


def verdict_changes(prev_rows: list[dict[str, Any]], rows: list[dict[str, Any]]) -> list[str]:
    """v3 M4-2：上一次部署 vs 這一次：原本「樣本範圍受限」、這次改判的指標 → 推播文字（不含買賣字眼）。"""
    before = {r.get("id"): r for r in prev_rows}
    msgs = []
    for r in rows:
        if r.get("id") not in WATCH_TESTS:
            continue
        old = (before.get(r["id"]) or {}).get("verdict")
        new = r.get("verdict")
        if old == verdict.LIMITED and new and new != verdict.LIMITED:
            cov = (r.get("coverage") or {}).get("ratio") or 0
            msgs.append(
                f"指標效度：{r['label']} 由「{old}」改判為「{new}」（涵蓋率 {cov * 100:.0f}%；"
                f"10 日超額 {r.get('mean_excess')}%、t {r.get('t')}、{r.get('n')} 筆）。依規則產生，僅供研究參考，非投資建議。"
            )
    return msgs


def notify_verdict_changes(rows: list[dict[str, Any]]) -> list[str]:
    """讀取目前已部署的 evidence.json 比較判定；有改判且設定了 Telegram 才推播。任何錯誤都略過（不影響部署）。"""
    import os

    from pipeline.notify import telegram

    repo = os.environ.get("GITHUB_REPOSITORY", "")
    if not telegram.configured() or "/" not in repo:
        return []
    owner, name = repo.split("/", 1)
    url = f"https://{owner.lower()}.github.io/{name}/data/evidence.json"
    try:
        import requests

        prev = requests.get(url, timeout=20).json().get("rows", [])
    except Exception:  # 沒有上一版或網路失敗：不推播
        log.info("讀不到已部署的 evidence.json，略過改判推播")
        return []
    msgs = verdict_changes(prev, rows)
    if msgs:
        telegram.send("\n".join(msgs))
    return msgs


def run_and_write(ev: EvData, out: Any = None, doc: Any = None) -> dict[str, Any]:
    from pipeline.derive.export import write_json
    from pipeline.evidence import judge, report, strategies

    res = evaluate(ev)
    lib = strategies.build(res)
    res["strategy_signals"] = lib.pop("_signals")
    # 2026-10-01 波段策略（新檔案 swing.py）：併入策略庫與訊號追蹤；最終測試段的結果只在這裡計算（部署時）
    from pipeline.evidence import swing

    sw = swing.build(res)
    lib["strategies"].extend(sw["strategies"])
    res["strategy_signals"].update(sw["_signals"])
    # 2026-10-01 精簡清單（新檔案 selection.py）：校正後 t、每月觸發、處置與排名寫進 strategies.json
    from pipeline.evidence import selection

    selection.annotate(lib, res)
    # 2026-10-03 判定卡與新分級（judge.py）：覆寫 grade／enabled／rank，組合與槓桿改用固定 40 日；
    # 累積超額曲線（120 日）寫回 evidence/{id}.json，近 40 日觸發寫進 evidence_today.json 的 strategies
    jd = judge.annotate(lib, res, sw.get("_masks") or {})
    for key, cd in jd["curves"].items():
        if not cd:
            continue
        if key in res["details"]:
            res["details"][key]["curve"] = cd
        elif key in sw["details"]:
            sw["details"][key]["curve"] = cd
    if res.get("today") is not None:
        res["today"]["strategies"] = {
            s["id"]: {"window": jd["window"], "t": jd["triggers"].get(s["id"], {})}
            for s in lib["strategies"]
            if s.get("enabled")
        }
        res["today"]["window"] = jd["window"]
    listed = {s["id"] for s in lib["strategies"] if s.get("enabled")}
    res["strategy_signals"] = {k: v for k, v in res["strategy_signals"].items() if k in listed}
    rep = report.write(res, out, doc)
    if out is not None:
        rep["verdict_changes"] = notify_verdict_changes(res["rows"])
        # M1.5：期間檢視（逐筆訊號、月度超額、各期間判定與組合、隨機分位帶、篩出與新觸發）
        from pipeline.derive.export import write_json_split

        listed_ids = {s["id"] for s in lib["strategies"] if s.get("enabled")}
        for sid, pack in (jd.get("periods") or {}).items():
            if sid not in listed_ids:
                continue
            sig = pack.pop("_signals", {})
            write_json(out / "strategy" / f"{sid}.json", pack)
            row_keys = [k for k, v in sig.items() if isinstance(v, list) and k != "exit_rules"]
            write_json_split(out / "strategy" / f"{sid}-signals.json", sig, row_keys)
        # M4 選股頁：各上架策略的「目前篩出＋觸發日、第 k 日、觸發以來報酬」與今日新觸發（不必載入整個期間檢視檔）
        screen_rows = []
        for s in lib["strategies"]:
            pk = (jd.get("periods") or {}).get(s["id"])
            if s["id"] not in listed_ids or not pk or "screen" not in pk:
                continue
            g = s.get("grade")
            screen_rows.append(
                {
                    "id": s["id"],
                    "label": s.get("label"),
                    "subtitle": s.get("subtitle"),
                    "grade": g.get("id") if isinstance(g, dict) else g,
                    "limited": bool(s.get("limited")),
                    "rank": s.get("rank"),
                    **pk["screen"],
                }
            )
        write_json(out / "screen.json", {"strategies": screen_rows})
        for sid, det in sw["details"].items():
            write_json(out / "evidence" / f"{sid}.json", det)
        rep["strategies_bytes"] = write_json(out / "strategies.json", lib)
    rep["strategies"] = sum(1 for s in lib["strategies"] if s.get("enabled"))
    verdicts: dict[str, int] = {}
    for r in res["rows"]:
        verdicts[r["verdict"]] = verdicts.get(r["verdict"], 0) + 1
    return {
        **rep,
        "tests": len(res["rows"]),
        "verdicts": verdicts,
        "seconds": res["meta"]["seconds"],
        "_signals": {
            "presets": res["strategy_signals"],
            "labels": {s["id"]: (s["label"], s["subtitle"]) for s in lib["strategies"]},
        },
    }
