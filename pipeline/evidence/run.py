"""指標效度評估的主流程：載入 → universe → 市場資料 → 每個項目的事件研究／分組檢定 → 判定 → 出場比較 → 報告。"""

from __future__ import annotations

import logging
import time
from datetime import datetime
from typing import Any

import numpy as np
import pandas as pd

from pipeline.core.dates import TPE
from pipeline.evidence import catalog, engine, exits, quintile, stats, universe, verdict
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


def coverage(test: catalog.Test, ev: EvData, uni: np.ndarray, start: str) -> dict[str, Any]:
    """納入股票數（universe 內、指標可計算）與 universe 股票數；比例＝逐日（可計算 ÷ universe）的平均。"""
    rows = np.asarray(ev.dates) >= start
    u = uni[rows]
    a = u & test.avail[rows]
    daily = a.sum(axis=1) / np.maximum(u.sum(axis=1), 1)
    return {
        "included": int(a.any(axis=0).sum()),
        "universe": int(u.any(axis=0).sum()),
        "ratio": round(float(daily[u.sum(axis=1) > 0].mean()) if u.any() else 0.0, 4),
    }


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

    def frames(self, mask: np.ndarray, start: str) -> dict[int, pd.DataFrame]:
        m = mask & (self.dates >= start)[:, None]
        t, cc = engine.events_from_mask(m, self.uni)
        return {h: engine.annotate(engine.evaluate(self.mk, t, cc, h), self.mk) for h in self.mk.horizons}

    def result(self, frames: dict[int, pd.DataFrame], oos_start: str | None) -> dict[str, Any]:
        """一組訊號：原始觸發次數、各持有期的去重統計與分組。"""
        out: dict[str, Any] = {"raw": 0, "horizons": {}}
        for h, df in frames.items():
            out["raw"] = len(df)
            status = df["status"].value_counts().to_dict()
            d = engine.dedupe(df)
            s = stats.summarize(d, self.c, h)
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
        cell_frames = {cell.key: r.frames(cell.mask, start) for cell in test.grid}
        cell_res = {k: r.result(fr, oos_default) for k, fr in cell_frames.items()}
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
        main_frames = cell_frames[chosen.key]
        res["variants"]["main"] = {"label": f"選定參數 {chosen.key}", **cell_res[chosen.key]}
        if oos_parts:
            oos = {**stats.brief(pd.concat(oos_parts), c), "start": wf[0]["valid"][0], "kind": "walk_forward"}
        test.variants["main"] = (res["variants"]["main"]["label"], chosen.mask)
    for key, (label, mask) in test.variants.items():
        if key == "main" and test.grid:
            continue
        fr = r.frames(mask, start)
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


def evaluate(ev: EvData, *, only: list[str] | None = None, with_exits: bool = True) -> dict[str, Any]:
    t0 = time.monotonic()
    c = cfg()
    uni = universe.build(ev, c["universe"])
    mk = engine.market(ev, uni, c)
    log.info("universe 與市場資料：%.0f 秒", time.monotonic() - t0)
    f = ind.build_features(ev, uni, c["indicators"])
    tests = catalog.build(ev, f, c["indicators"], uni)
    log.info("指標面板：%.0f 秒", time.monotonic() - t0)
    r = EventRunner(ev, mk, uni, c)
    H = str(int(c["primary_horizon"]))
    end = ev.dates[-1]
    rows, details = [], {}
    today: dict[str, list[str]] = {}
    keep: dict[str, dict[str, Any]] = {}
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
        cov = coverage(test, ev, uni, start)
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
        )
        comp_rows = {k: v for k, v in res["variants"].items() if k in test.components}
        # 近期表現（策略健康度用）：最近 recent_days 個交易日內已完成的訊號 vs 全期間
        mf = res["main_frames"]
        recent = None
        if mf is not None:
            d_all = engine.dedupe(mf[int(H)])
            cut = len(ev.dates) - 1 - int(H) - int(c.get("recent_days", 60))
            recent = stats.brief(d_all[d_all["t"] >= cut], c)
            recent["since"] = ev.dates[max(cut, 0)]
        main_mask = test.variants["main"][1]
        keep[test.id] = {"mask": main_mask, "start": start}
        today[test.id] = [ev.codes[i] for i in np.nonzero(main_mask[-1] & uni[-1])[0]]
        row = {
            **base,
            **dec,
            "n": main.get("n", 0),
            "raw": res["variants"]["main"]["raw"],
            "t": main.get("t"),
            "t_nw": main.get("t_nw"),
            "mean_excess": main.get("mean_excess"),
            "ci": main.get("ci"),
            "win": main.get("win"),
            "years": {y: v.get("mean_excess") for y, v in g.get("years", {}).items()},
            "oos": (res["oos"] or {}).get("mean_excess"),
            "env": {
                k: {s: g[k][s].get("mean_excess") for s in ("on", "off")} for k in ("regime", "trend", "quarter_end")
            },
            "h": {
                h: {k: v.get(k) for k in ("n", "mean_excess", "t")}
                for h, v in res["variants"]["main"]["horizons"].items()
            },
            "param": (res["grid"] or {}).get("chosen"),
            "recent": recent,
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
        detail = {**base, **dec, "variants": res["variants"], "grid": res["grid"], "oos": res["oos"]}
        if with_exits and dec["verdict"] in (verdict.VALID, verdict.ENV) and res["main_frames"] is not None:
            cand = res["main_frames"][int(H)]
            cand = cand[cand["status"] == "ok"]
            detail["exits"] = exits.compare(mk, cand, ev, c, windows(start, end))
        rows.append(row)
        details[test.id] = detail
        log.info("%s：%s n=%s t=%s（%.0f 秒）", test.id, dec["verdict"], row["n"], row["t"], time.monotonic() - t0)
    uni_rows = np.asarray(ev.dates) >= str(c["price_start"])
    meta = {
        "generated_at": datetime.now(TPE).isoformat(timespec="seconds"),
        "data_end": end,
        "starts": ev.starts,
        "universe_stocks": int(uni[uni_rows].any(axis=0).sum()),
        "universe_daily_avg": int(uni[uni_rows].sum(axis=1).mean()),
        "bench": "加權報酬指數" if mk.bench_is_tr else "加權指數（取不到報酬指數）",
        "regime_share": round(float(mk.regime_up[uni_rows].mean()), 4),
        "config": {k: c[k] for k in ("universe", "entry", "horizons", "primary_horizon", "stats", "verdict")},
        "seconds": round(time.monotonic() - t0),
        "tests": len(rows),
        "price_start": str(c["price_start"]),
    }
    return {
        "meta": meta,
        "rows": rows,
        "details": details,
        "today": {"date": end, "tests": today},
        # 策略庫（M2）用的中間結果：不寫入 JSON
        "_ctx": {"ev": ev, "mk": mk, "uni": uni, "tests": keep, "cfg": c},
    }


def run_and_write(ev: EvData, out: Any = None, doc: Any = None) -> dict[str, Any]:
    from pipeline.derive.export import write_json
    from pipeline.evidence import report, strategies

    res = evaluate(ev)
    rep = report.write(res, out, doc)
    lib = strategies.build(res)
    res["strategy_signals"] = lib.pop("_signals")
    if out is not None:
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
