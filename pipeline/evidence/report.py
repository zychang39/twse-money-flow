"""報告：docs/INDICATOR_EVIDENCE.md（全部由程式產生，不要手改）與前端 JSON（evidence.json、evidence/{id}.json）。"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from pipeline.derive.export import sanitize, write_json

HEAD = "# 指標效度評估（INDICATOR_EVIDENCE）"
REF = {"120"}  # 只做參考、不進判定的持有天數（config/evidence.yml horizons_ref）


def f(v: Any, digits: int = 2, sign: bool = True, unit: str = "") -> str:
    if v is None:
        return "—"
    try:
        x = float(v)
    except (TypeError, ValueError):
        return str(v)
    s = f"{x:+.{digits}f}" if sign else f"{x:.{digits}f}"
    return s.replace("-", "−") + unit


def ci(v: Any) -> str:
    if not v or v[0] is None:
        return "—"
    return f"[{f(v[0])}, {f(v[1])}]"


def years_text(years: dict[str, Any]) -> str:
    return "、".join(f"{y} {f(v)}" for y, v in sorted(years.items())) or "—"


def env_text(row: dict[str, Any]) -> str:
    env = row.get("env") or {}
    r = env.get("regime") or {}
    return f"年線上 {f(r.get('on'))}／下 {f(r.get('off'))}" if r else "—"


def summary_table(rows: list[dict[str, Any]]) -> list[str]:
    out = [
        "| 指標 | 判定 | 樣本（去重／原始） | 涵蓋率（每日平均納入／universe） | 資料起始 | 訊號期間 | t（NW 參考） | 平均超額 %（95% 區間） | 相對 0050 的 t | 逐年 | 樣本外 | 大盤環境 |",
        "|---|---|---|---|---|---|---|---|---|---|---|---|",
    ]
    for r in rows:
        cov = r.get("coverage") or {}
        n = f"{r.get('n', 0)} 個月" if r.get("kind") == "quintile" else f"{r.get('n', 0)}／{r.get('raw', '—')}"
        t = f(r.get("t"), sign=False) + (f"（{f(r.get('t_nw'), sign=False)}）" if r.get("t_nw") is not None else "")
        tags = "".join(
            f"（{x}）" for x in (cov.get("label") if r["verdict"] != "樣本範圍受限" else None, r.get("large_cap")) if x
        )
        out.append(
            f"| [{r['label']}](#{r['id']}) | **{r['verdict']}**{tags} | {n} | "
            f"{f((cov.get('ratio') or 0) * 100, 0, False)}%（{cov.get('included', '—')}／{cov.get('universe', '—')}） | "
            f"{r.get('data_start') or '—'} | {r.get('signal_start') or '—'}～{r.get('signal_end') or '—'} | {t} | "
            f"{f(r.get('mean_excess'))} {ci(r.get('ci'))} | {f(r.get('t_0050'), sign=False)} | {years_text(r.get('years') or {})} | "
            f"{f(r.get('oos'))} | {env_text(r)} |"
        )
    return out


def horizon_table(hs: dict[str, Any]) -> list[str]:
    out = [
        "| 持有 | 去重樣本 | 進場日數 | 平均超額（同日全市場）% | t | 95% 區間 | 相對指數 % | 原始報酬 % | 勝率 %（Wilson） | 中位數 % | MAE % | MFE % | 跌停鎖死 | 無法進場（漲停／停牌） |",
        "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|",
    ]
    for h, s in hs.items():
        if not s.get("n"):
            out.append(f"| {h} 日 | 0 | — | — | — | — | — | — | — | — | — | — | — | — |")
            continue
        ex = s.get("excluded") or {}
        lab = f"{h} 日（參考）" if h in REF else f"{h} 日"
        out.append(
            f"| {lab} | {s['n']} | {s['dates']} | {f(s['mean_excess'])} | {f(s['t'], sign=False)} | {ci(s['ci'])} | "
            f"{f(s.get('mean_exc_idx'))} | {f(s.get('mean_net'))} | {f(s['win'], 1, False)} {ci_plain(s.get('win_ci'))} | "
            f"{f(s.get('median_net'))} | {f(s.get('mae'))} | {f(s.get('mfe'))} | {s.get('locked', 0)} | "
            f"{ex.get('limit_up', 0)}／{ex.get('suspended', 0)} |"
        )
    return out


def ci_plain(v: Any) -> str:
    if not v or v[0] is None:
        return ""
    return f"[{f(v[0], 1, False)}, {f(v[1], 1, False)}]"


def brief_cell(b: dict[str, Any] | None) -> str:
    if not b:
        return "—"
    if not b.get("n"):
        return b.get("note") or "本期間無此環境樣本"
    return f"{f(b.get('mean_excess'))}（t {f(b.get('t'), sign=False)}，n {b['n']}）"


def groups_table(g: dict[str, Any], oos: dict[str, Any] | None) -> list[str]:
    out = ["| 分組 | 平均超額 %（t，樣本） |", "|---|---|"]
    for y, b in sorted((g.get("years") or {}).items()):
        out.append(f"| {y} 年 | {brief_cell(b)} |")
    if oos:
        kind = "walk-forward 驗證期" if oos.get("kind") == "walk_forward" else "最後 1/3 期間"
        out.append(f"| 樣本外（{kind}，{oos.get('start')} 起） | {brief_cell(oos)} |")
    for key, on, off in (
        ("regime", "大盤在 240 日線上", "大盤在 240 日線下"),
        ("trend", "大盤近 60 日上漲", "大盤近 60 日下跌"),
        ("quarter_end", "投信季底作帳（每季最後 10 個交易日）", "其他期間"),
    ):
        grp = g.get(key) or {}
        out.append(f"| {on} | {brief_cell(grp.get('on'))} |")
        out.append(f"| {off} | {brief_cell(grp.get('off'))} |")
    return out


def section(d: dict[str, Any], H: str) -> list[str]:
    out = [f'<a id="{d["id"]}"></a>', f"### {d['label']}", ""]
    out.append(f"- **定義**：{d.get('definition', '')}")
    out.append(f"- **判定**：**{d['verdict']}**" + (f"（{'；'.join(d['reasons'])}）" if d.get("reasons") else ""))
    cov = d.get("coverage") or {}
    label = cov.get("label")
    out.append(
        f"- **樣本範圍**：涵蓋率 {f((cov.get('ratio') or 0) * 100, 0, False)}%（每日平均納入 {cov.get('included', '—')}／{cov.get('universe', '—')} 檔"
        + (f"；{label}" if label else "")
        + f"）；期間內曾納入 {cov.get('ever_included', '—')} 檔，其中已終止上市櫃 {cov.get('ever_delisted', 0)} 檔；"
        f"資料起始 {d.get('data_start') or '—'}；訊號期間 {d.get('signal_start') or '—'}～{d.get('signal_end') or '—'}。"
    )
    dl = d.get("delist") or {}
    if dl:
        cons = dl.get("dl100") or {}
        out.append(
            f"- **下市**：持有 {H} 日期間下市 {dl.get('events', 0)} 筆（以最後可成交日收盤出場）、停牌到資料結束 {dl.get('halted', 0)} 筆；"
            + (
                f"下市視為 −100% 的保守版本：{f(cons.get('mean_excess'))}（t {f(cons.get('t'), sign=False)}）。"
                if cons
                else "沒有持有期間下市的事件，保守版本與主結果相同。"
            )
        )
    if d.get("note"):
        out.append(f"- **注意**：{d['note']}")
    out.append("")
    if "quintile" in d:
        q = d["quintile"]
        if not q.get("months"):
            out += ["沒有足夠的月份。", ""]
            return out
        m = q["main"]
        out += [
            f"每月平均 {q['avg_stocks']} 檔，{q['months']} 個月（{q['first_month']}～{q['last_month']}）。",
            "",
            "| Q1（最低） | Q2 | Q3 | Q4 | Q5（最高） | Q5−Q1 %／月 | t | 95% 區間 | Spearman 平均（t） | 樣本外 Q5−Q1 |",
            "|---|---|---|---|---|---|---|---|---|---|",
            "| "
            + " | ".join(f(v) for v in q["q_mean"])
            + f" | {f(m['mean_excess'])} | {f(m['t'], sign=False)} | {ci(m['ci'])} | "
            f"{f(q.get('rho_mean'), 3)}（{f(q.get('rho_t'), sign=False)}） | {f(q['oos'].get('mean_excess'))}（{q['oos'].get('start')} 起） |",
            "",
            "逐年 Q5−Q1（%／月）："
            + "、".join(f"{y} {f(v.get('mean_excess'))}（{v['n']} 個月）" for y, v in sorted(q["years"].items())),
            "",
        ]
        return out
    variants = d.get("variants") or {}
    main = variants.get("main") or {}
    out += [f"#### 主結果（{main.get('label', '')}；原始觸發 {main.get('raw', 0)} 次）", ""]
    out += horizon_table(main.get("horizons") or {})
    out.append("")
    hs = (main.get("horizons") or {}).get(H) or {}
    if hs.get("no_gap"):
        out.append(
            f"排除跳空 ≥ 5% 的變體（持有 {H} 日）：{brief_cell(hs['no_gap'])}；主結果中跳空 ≥ 5% 的事件 {hs.get('gap_events', 0)} 筆。"
        )
        out.append("")
    bench = hs.get("bench") or {}
    if bench:
        out += [
            f"#### 四種基準（持有 {H} 日；判定以等權為準）",
            "",
            "| 基準 | 平均超額 % | t | 95% 區間 | 超額勝率 % |",
            "|---|---|---|---|---|",
        ]
        for key, name in (
            ("ew", "(a) 同日等權 universe"),
            ("tr", "(b) 加權報酬指數"),
            ("0050", "(c) 0050 持有不動"),
            ("00631L", "(d) 00631L 持有不動"),
        ):
            b = bench.get(key) or {}
            out.append(
                f"| {name} | {f(b.get('mean_excess'))} | {f(b.get('t'), sign=False)} | {ci(b.get('ci')) if b.get('ci') else '—'} | "
                f"{f(b.get('win'), 1, False)} |"
            )
        out += [
            "",
            "0050、00631L 為還原價（含息、已處理分割）同一段期間的持有不動報酬，不扣成本；00631L 每日再平衡，長期有波動耗損。",
            "",
        ]
    pdt = d.get("per_day") or {}
    if pdt:
        out += [
            "#### 每持有日超額（超額 ÷ N × 250，年化；讓不同持有天數可以比較）",
            "",
            "| 持有 | 去重樣本 | 平均超額 % | t | 每持有日年化 % |",
            "|---|---|---|---|---|",
        ]
        for k, v in pdt.items():
            out.append(
                f"| {k} 日{'（參考）' if v.get('ref') else ''} | {v.get('n', 0)} | {f(v.get('mean_excess'))} | "
                f"{f(v.get('t'), sign=False)} | {f(v.get('per_day_ann'))} |"
            )
        nwf = d.get("n_wf") or {}
        steps = nwf.get("steps") or []
        out.append("")
        if steps:
            out.append(
                "持有天數 walk-forward（訓練窗選每持有日年化最高的 N，驗證期報告該 N）："
                + "；".join(
                    f"{st['valid'][0]}～{st['valid'][1]} 用 {st['n_days']} 日 → 驗證 {f(st.get('valid_mean_excess'))}（{st.get('valid_n', 0)} 筆）"
                    for st in steps
                )
                + "。持有期越長 beta 暴露與回撤越大，所以比較的是超額（alpha），不是總報酬。"
            )
            out.append("")
    cv = d.get("curve") or {}
    if cv.get("n"):
        out += [f"#### 事件時間累積超額（第 1～{len(cv.get('k', []))} 日，{cv['n']} 筆）", ""]
        for key, name in (("ew", "相對同日等權"), ("0050", "相對 0050")):
            b = cv.get(key) or {}
            if not b:
                continue
            m = b.get("mean") or []
            pk = b.get("peak")
            pts = "、".join(f"第 {k} 日 {f(m[k - 1])}" for k in (1, 5, 10, 20, 40, 60, 120) if k <= len(m))
            edge = "（峰值在觀察窗邊界）" if b.get("peak_at_edge") else ""
            out.append(f"- {name}：{pts}；峰值第 {pk or '—'} 日（{f(m[pk - 1]) if pk else '—'}）{edge}。")
        out.append("")
    out += [f"#### 分組（持有 {H} 日）", ""]
    out += groups_table(hs.get("groups") or {}, d.get("oos"))
    out.append("")
    others = {k: v for k, v in variants.items() if k != "main"}
    if others or main.get("false_breakout") is not None:
        out += [
            f"#### 變體比較（持有 {H} 日）",
            "",
            "| 變體 | 原始觸發 | 去重樣本 | 平均超額 % | t | 95% 區間 | 勝率 % | 假突破率 % |",
            "|---|---|---|---|---|---|---|---|",
        ]
        for _k, v in variants.items():
            s = (v.get("horizons") or {}).get(H) or {}
            out.append(
                f"| {v.get('label')} | {v.get('raw', 0)} | {s.get('n', 0)} | {f(s.get('mean_excess'))} | {f(s.get('t'), sign=False)} | "
                f"{ci(s.get('ci'))} | {f(s.get('win'), 1, False)} | {f(v.get('false_breakout'), 1, False)} |"
            )
        out.append("")
    g = d.get("grid")
    if g:
        out += [
            f"#### 參數表（全部格子，持有 {H} 日；選定：{g['chosen']}{'，參數敏感' if g.get('sensitive') else ''}）",
            "",
        ]
        if g.get("note"):
            out += [g["note"], ""]
        out += ["| 參數 | 原始觸發 | 去重樣本 | 平均超額 % | t | 95% 區間 | 勝率 % |", "|---|---|---|---|---|---|---|"]
        for row in g["table"]:
            mark = "**" if row["key"] == g["chosen"] else ""
            out.append(
                f"| {mark}{row['key']}{mark} | {row.get('raw', 0)} | {row.get('n', 0)} | {f(row.get('mean_excess'))} | "
                f"{f(row.get('t'), sign=False)} | {ci(row.get('ci'))} | {f(row.get('win'), 1, False)} |"
            )
        out.append("")
        if g.get("walk_forward"):
            out += [
                "walk-forward：",
                "",
                "| 訓練期 | 選到的參數 | 訓練期平均超額 % | 驗證期 | 驗證期平均超額 %（t，樣本） |",
                "|---|---|---|---|---|",
            ]
            for w in g["walk_forward"]:
                out.append(
                    f"| {w['train'][0]}～{w['train'][1]} | {w['param']} | {f(w.get('train_mean'))} | {w['valid'][0]}～{w['valid'][1]} | {brief_cell(w)} |"
                )
            out.append("")
    ex = d.get("exits")
    if ex:
        out += [
            "#### 出場規則比較（同樣的進場，去重）",
            "",
            "| 出場 | 選定 | 樣本 | 期望值 %（扣成本） | 相對等權 % | 相對加權報酬 % | 相對 0050 % | 相對 00631L % | 勝率 % | 平均持有日 | MAE % | 跌停鎖死 |",
            "|---|---|---|---|---|---|---|---|---|---|---|---|",
        ]
        for r in ex["rules"]:
            rel = r.get("rel") or {}
            out.append(
                f"| {r['label']} | {'✓' if r.get('chosen') else ''} | {r.get('n', 0)} | {f(r.get('ev'))} | {f(rel.get('ew'))} | "
                f"{f(r.get('exc_idx'))} | {f(rel.get('0050'))} | {f(rel.get('00631L'))} | "
                f"{f(r.get('win'), 1, False)} | {f(r.get('hold'), 1, False)} | {f(r.get('mae'))} | {r.get('locked', 0)} |"
            )
        pk = ex.get("peak_train")
        out += [
            "",
            "相對等權：持有天數不固定，以同日等權 universe 的每日指數（前一日收盤到出場前一日收盤）近似。"
            + (
                f"峰值日固定出場的 N＝第一個訓練窗（{pk['train'][0]}～{pk['train'][1]}）累積超額曲線的峰值日 {pk['day']}，不看全樣本。"
                if pk
                else ""
            ),
            "",
        ]
    return out


def method_summary(meta: dict[str, Any]) -> list[str]:
    c = meta["config"]
    st, v = c["stats"], c["verdict"]
    return [
        "## 方法摘要與多重檢定警語",
        "",
        f"> **本評估同時測試數十個指標與變體（本表 {meta.get('tests', 0)} 項，另有變體與參數格），即使指標完全無效，也預期會有幾項看起來「顯著」（假陽性）。"
        f"因此判定「有效」的 t 值門檻由一般的 1.96 提高到 {st['t_threshold']}，並另外要求 bootstrap 區間不含 0、逐年多數為正、樣本外為正、參數不敏感。"
        "即使如此，「有效」只代表在這段期間、這個樣本範圍內的統計證據，不代表未來表現，也不是買賣建議。**",
        "",
        f"- **樣本範圍**：上市＋上櫃普通股；排除 ETF、ETN、存託憑證、受益證券；訊號日為處置股、上市櫃未滿 {c['universe']['min_listed_days']} 個交易日、"
        f"20 日平均成交值 < {c['universe']['min_avg_value'] / 1e4:,.0f} 萬元、收盤價 < {c['universe']['min_close']} 元者排除。以逐日的全市場行情建立（含之後下市的股票；下市以兩所終止上市櫃公告為準，轉上市不算）。"
        f"universe 共 {meta['universe_stocks']} 檔（{meta.get('price_start')} 起），每日平均 {meta['universe_daily_avg']} 檔。變更交易（全額交割）與管理股票逐日排除（證交所歷史新增紀錄＋每日名單快照；櫃買快照開始前沒有歷史，由成交值與價格門檻排除絕大多數）。",
        "- **資料生效日**：收盤價、量、三大法人、融資融券在 T 日收盤後；集保股權分散為週六公布，訊號日只引用上週以前的資料 → 下週一收盤訊號、週二開盤進場；月營收在次月 10 日（歷史資料沒有各公司公布日，一律用法定期限）之後第一個交易日開盤進場。",
        f"- **進出場**：訊號生效日的下一個交易日開盤進場（還原價）；開盤即漲停（≥ +{c['entry']['limit_up_pct']}%）排除並計入「無法進場」；"
        f"開盤 ≥ +{c['entry']['gap_pct']}% 另列「排除跳空」變體；進場後第 N 個交易日（N＝{'、'.join(str(h) for h in c['horizons'])}）開盤出場，出場日跌停鎖死（最高價 ≤ 前收 {c['entry']['limit_down_pct']}%）或停牌順延到下一個可成交日。"
        "成本：手續費 0.1425% × 0.6 買賣各一次、證交稅 0.3%。同一檔同一指標只計「首次觸發」：持有期間內不重複計入，出場後才可再次觸發。",
        f"- **報酬**：原始（扣成本）、相對{meta['bench']}、相對同日全市場（等權 universe：同一進場日、同一持有期、universe 內全部股票的平均；**主要的超額報酬定義，判定用**）；另列相對 0050、00631L 持有不動（還原價、含息）。",
        f"- **統計**：日曆時間法（同一進場日的事件先平均成一個日報酬，再算平均、標準誤、t）；t 旁括號為 Newey-West t（落後期數＝持有日數，校正持有期重疊造成的自我相關，**只供參考、不用於判定**）。"
        f"勝率附 Wilson 95% 區間（事件層級）；平均超額附日期分層 bootstrap（{st['bootstrap']} 次，種子 {st['seed']}）95% 區間。"
        f"分組：逐年、樣本外（最後 1/3 期間；有參數的指標改用 walk-forward 驗證期）、大盤 240 日線上／下、大盤近 60 日上漲／下跌、投信季底作帳（每季最後 {st['quarter_end_days']} 個交易日）／其他。",
        f"- **判定（寫死）**：有效＝去重樣本 ≥ {v['min_events']}（分組型 ≥ {v['min_months']} 個月）、平均超額 > 0、t ≥ {st['t_threshold']}、bootstrap 區間不含 0、逐年至少 2/3 年為正、樣本外為正、參數不敏感；"
        "不穩定＝全期間顯著但逐年／樣本外不成立或參數敏感；環境依賴＝全期間不顯著，但在某一個環境（樣本也達門檻）顯著、另一個環境不顯著或反向；"
        f"無效＝區間含 0、平均 ≤ 0，或 t 未達 {st['t_threshold']}；樣本不足＝未達樣本門檻；樣本範圍受限＝涵蓋率（Σ每日有資料檔數 ÷ Σ每日 universe 檔數） < {v['coverage_ratio'] * 100:.0f}%。"
        f"參數敏感＝選定參數的相鄰格中，有任一格的平均超額報酬不到選定格的 {v['sensitive_ratio'] * 100:.0f}%（或正負號相反）。",
        f"- **判定用的持有天數**：{c['primary_horizon']} 日（事先決定；其他持有天數 5、20、40、60 日一併報告，120 日只做參考）。",
        f"- **環境警語**：評估期間（{meta.get('price_start')}～{meta['data_end']}）大盤有 {meta['regime_share'] * 100:.0f}% 的交易日在 240 日線上，以多頭為主；"
        "籌碼類資料自 "
        + str((meta.get("starts") or {}).get("insti"))
        + " 起，期間更短、幾乎全在多頭。所有結論都受這個限制。",
        "",
    ]


def markdown(res: dict[str, Any]) -> str:
    meta, rows, details = res["meta"], res["rows"], res["details"]
    H = str(meta["config"]["primary_horizon"])
    lines = [
        HEAD,
        "",
        f"> 由 `python -m pipeline evidence` 自動產生（{meta['generated_at']}，資料至 {meta['data_end']}），請勿手改。"
        "計算方法見 METHODOLOGY §10；參數與判定規則在 `config/evidence.yml`。僅供研究參考，非投資建議。",
        "",
    ]
    lines += method_summary(meta)
    lines += ["## 總表", "", f"事件型的樣本、t、平均超額為持有 {H} 日、相對同日全市場；分組型為每月 Q5−Q1。", ""]
    lines += summary_table(rows)
    lines.append("")
    lines += ["## 各指標", ""]
    for fam in ("動能", "籌碼", "基本面", "組合"):
        fam_rows = [r for r in rows if r.get("family") == fam]
        if not fam_rows:
            continue
        lines += [f"## {fam}類", ""]
        for r in fam_rows:
            d = details.get(r["id"])
            if d:
                lines += section(d, H)
    return "\n".join(lines) + "\n"


def write(res: dict[str, Any], out: Path | None, doc: Path | None) -> dict[str, Any]:
    report: dict[str, Any] = {}
    if doc is not None:
        doc.write_text(markdown(res), encoding="utf-8")
        report["doc"] = str(doc)
    if out is not None:
        (out / "evidence").mkdir(parents=True, exist_ok=True)
        rows = res["rows"]
        report["evidence_bytes"] = write_json(out / "evidence.json", {"meta": res["meta"], "rows": rows})
        for tid, d in res["details"].items():
            write_json(out / "evidence" / f"{tid}.json", sanitize(d))
        if res.get("today"):
            write_json(out / "evidence_today.json", res["today"])
    return report
