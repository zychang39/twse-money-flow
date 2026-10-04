"""族群三層（M1.2）：官方產業 › 細產業 › 題材（自訂族群在前端計算），每日族群統計、族群等權指數、走勢相近。

成員來源：
- 官方產業：公司基本資料的產業別（ETF 另成一組）。
- 細產業：櫃買中心產業價值鏈快照（config/sectors/tpex_chain.csv）的「產業鏈 › 子類別」＋ config/sectors/fine.yml 的
  手動細產業（例：IC 載板）、未涵蓋股票的對照（assign）、ETF 規則；特別股沿用普通股。每一檔有個股頁的股票至少屬於一個細產業；
  都對不到時歸到「（官方產業）其他」並計入 `unassigned`（驗收檢查應為 0）。
- 題材：config/sectors/themes.yml（自行整理、上游／中游／下游）。

每日族群統計（三層都算；只用有收盤的成員）：
- 成員數；1／3／6／12 個月報酬中位數（還原收盤，與 momentum.window_returns 相同的端點規則）。
- 名次：3 個月中位數由高到低，只排成員 ≥ MIN_RANKED 檔者；不足者併入上層（細產業 → 產業鏈的類別 → 產業鏈）並標示。
  20 個交易日前的名次以同樣規則、用 20 日前的報酬計算。
- 站上 60 日線比例、收盤創 60 日新高檔數、法人 5／20 日買超佔成交額（買賣超股數 × 當日均價 ÷ 成交金額）。
- 今日新觸發檔數：部署時由 evidence_today.json 補上（add_triggers）。
- 族群等權指數：成員每日報酬的平均連乘（最近 INDEX_DAYS 日，起點 100）。
走勢相近：近 60 個交易日日報酬的皮爾森相關係數最高的 10 檔（普通股；窗內有缺值者不列）。
"""

from __future__ import annotations

import csv
import logging
import re
import warnings
from dataclasses import dataclass, field
from pathlib import Path
from typing import TYPE_CHECKING, Any

import numpy as np
import pandas as pd

from pipeline.core import config
from pipeline.core.normalize import is_common_stock, is_etf
from pipeline.derive.export import arr, clean, write_json

if TYPE_CHECKING:
    from pipeline.derive.build import Panels

log = logging.getLogger(__name__)

SECTOR_DIR = config.CONFIG_DIR / "sectors"
MIN_RANKED = 5
RANK_WINDOW = "3M"
WINDOWS: dict[str, int] = {"1M": 21, "3M": 63, "6M": 126, "12M": 252}
RANK_LAG = 20
INDEX_DAYS = 500
HISTORY_DAYS = 120
CORR_DAYS = 60
CORR_TOP = 10
FILL_LIMIT = 5
_EXAMPLE = re.compile(r"[（(](例如|如)[^)）]*[)）]")


def clean_name(name: str) -> str:
    """產業價值鏈的類別名稱：去掉「(例如…)」說明與空白。"""
    return _EXAMPLE.sub("", name).replace(" ", "").strip()


@dataclass
class Group:
    id: str
    layer: str  # official／fine／theme／chain（chain＝細產業併入用的上層，不單獨列出）
    name: str
    members: list[str]
    parent: str | None = None
    path: list[str] = field(default_factory=list)  # 顯示用路徑（例：["半導體", "IC設計"]）
    streams: dict[str, list[str]] = field(default_factory=dict)  # 上游／中游／下游 → 成員
    basis: str = ""
    date: str = ""
    listed: bool = True


@dataclass
class Layers:
    groups: dict[str, Group]
    fine_of: dict[str, list[str]]  # 代號 → 細產業 id（主要細產業在第一個）
    official_of: dict[str, str]  # 代號 → 官方產業 group id
    themes_of: dict[str, list[tuple[str, str]]]  # 代號 → [(題材 id, 上中下游)]
    unassigned: list[str]


# ------------------------------------------------------------------ 成員
def read_chain_csv(path: Path | None = None) -> list[dict[str, str]]:
    p = path or SECTOR_DIR / "tpex_chain.csv"
    if not p.exists():
        return []
    with p.open(encoding="utf-8") as fh:
        return list(csv.DictReader(line for line in fh if not line.startswith("#")))


def etf_class(code: str, name: str, rules: list[dict[str, Any]]) -> str:
    """ETF 的細產業：依代號後綴與名稱，第一個符合的規則（fine.yml etf）。"""
    for r in rules:
        rule = r.get("rule") or {}
        suf = rule.get("code_suffix")
        if suf:
            sufs = [suf] if isinstance(suf, str) else list(suf)
            if not any(code.endswith(s) for s in sufs):
                continue
        prefix = rule.get("name_prefix")
        if prefix and not name.startswith(prefix):
            continue
        words = rule.get("name_any")
        if words and not any(w in name for w in words):
            continue
        return str(r["id"])
    return str(rules[-1]["id"]) if rules else "etf/market"


def parent_code(code: str) -> str | None:
    """特別股、受益憑證等後綴字母的代號 → 普通股代號（2881A → 2881）。"""
    if len(code) == 5 and code[:4].isdigit() and code[4].isalpha() and not code.startswith("0"):
        return code[:4]
    return None


def fine_key(row: dict[str, str]) -> str:
    return f"{row['chain_id']}/{row['sub_id']}"


def gid(kind: str, key: str) -> str:
    """網址安全的族群 id：f-D000-D310、c-D000-D300、ch-D000、o-24、t-ai_server、m-ic_substrate、e-active。"""
    return f"{kind}-{key.replace('/', '-')}"


def build_layers(
    codes: list[str],
    names: dict[str, str],
    industries: dict[str, str],
    chain_rows: list[dict[str, str]] | None = None,
    fine_cfg: dict[str, Any] | None = None,
    themes_cfg: dict[str, Any] | None = None,
) -> Layers:
    rows = chain_rows if chain_rows is not None else read_chain_csv()
    fine_cfg = fine_cfg if fine_cfg is not None else config.load("sectors/fine")
    themes_cfg = themes_cfg if themes_cfg is not None else config.load("sectors/themes")
    universe = set(codes)
    groups: dict[str, Group] = {}
    snap_date = str(fine_cfg.get("updated", ""))
    chain_basis = "櫃買中心產業價值鏈資訊平台（ic.tpex.org.tw）"

    # 官方產業
    code_of_industry = {v: k for k, v in config.industries().items()}
    official_of: dict[str, str] = {}
    for c in codes:
        ind = industries.get(c) or ("ETF" if is_etf(c) else "")
        if not ind:
            p = parent_code(c)
            ind = industries.get(p, "") if p else ""
        if not ind:
            continue
        g = gid("o", "etf" if ind == "ETF" else code_of_industry.get(ind, ind))
        official_of[c] = g
        groups.setdefault(g, Group(g, "official", ind, [], basis="證交所／櫃買中心公司基本資料產業別")).members.append(
            c
        )

    # 產業價值鏈：子類別、類別、產業鏈三層（後兩層是併入用的上層）
    sub_names: dict[str, set[str]] = {}
    by_key: dict[str, dict[str, str]] = {}
    chain_members: dict[str, list[str]] = {}
    for r in rows:
        k = fine_key(r)
        by_key.setdefault(k, r)
        sub_names.setdefault(clean_name(r["sub"]), set()).add(k)
        chain_members.setdefault(k, [])  # 沒有上市櫃成員的子類別也建立（人工對照可能指到它）
        if r["code"] in universe:
            chain_members[k].append(r["code"])
    for k, members in chain_members.items():
        r = by_key[k]
        sub, cat, chain = clean_name(r["sub"]), clean_name(r["cat"]), r["chain"]
        name = sub if len(sub_names.get(sub, ())) <= 1 else f"{sub}（{chain}）"
        cat_id = gid("c", f"{r['chain_id']}/{r['cat_id']}")
        ch_id = gid("ch", r["chain_id"])
        path = [chain] + ([cat] if cat != sub else []) + [sub]
        gf = gid("f", k)
        groups[gf] = Group(
            gf,
            "fine",
            name,
            sorted(set(members)),
            parent=cat_id if cat_id != gf.replace("f-", "c-") else ch_id,
            path=path,
            streams={r["stream"]: sorted(set(members))} if r["stream"] else {},
            basis=chain_basis,
            date=snap_date,
        )
        if cat_id not in groups:
            groups[cat_id] = Group(
                cat_id,
                "chain",
                cat,
                [],
                parent=ch_id,
                path=[chain, cat],
                basis=chain_basis,
                date=snap_date,
                listed=False,
            )
        groups[cat_id].members = sorted(set(groups[cat_id].members) | set(members))
        if ch_id not in groups:
            groups[ch_id] = Group(
                ch_id, "chain", chain, [], path=[chain], basis=chain_basis, date=snap_date, listed=False
            )
        ch = groups[ch_id]
        ch.members = sorted(set(ch.members) | set(members))
        if r["stream"]:
            ch.streams[r["stream"]] = sorted(set(ch.streams.get(r["stream"], [])) | set(members))
    # 子類別與類別同名（沒有子類別）時，上層直接是產業鏈
    for grp in groups.values():
        if (
            grp.layer == "fine"
            and grp.parent
            and grp.parent.startswith("c-")
            and grp.parent.replace("c-", "f-") == grp.id
        ):
            grp.parent = groups[grp.parent].parent

    # 每檔的細產業（依產業價值鏈的頁面順序＝子類別代碼順序）
    fine_of: dict[str, list[str]] = {}
    for r in sorted(rows, key=lambda x: (x["chain_id"], x["sub_id"])):
        if r["code"] in universe:
            lst = fine_of.setdefault(r["code"], [])
            g = gid("f", fine_key(r))
            if g not in lst:
                lst.append(g)
    # 未涵蓋股票的人工對照
    for code, keys in (fine_cfg.get("assign") or {}).items():
        code = str(code)
        if code not in universe:
            continue
        for k in keys:
            g = gid("f", str(k))
            if g not in groups:
                log.warning("fine.yml assign %s → %s：產業價值鏈快照沒有這個子類別", code, k)
                continue
            if code not in groups[g].members:
                groups[g].members.append(code)
            fine_of.setdefault(code, [])
            if g not in fine_of[code]:
                fine_of[code].append(g)
    # 手動細產業
    for m in fine_cfg.get("manual") or []:
        g = gid("m", str(m["id"]).split("/", 1)[-1])
        members = [str(c) for c in m.get("members") or [] if str(c) in universe]
        parent = gid("f", str(m["parent"])) if m.get("parent") else None
        groups[g] = Group(
            g,
            "fine",
            str(m["name"]),
            members,
            parent=parent,
            path=(groups[parent].path[:-1] if parent in groups else []) + [str(m["name"])],
            basis=str(m.get("basis", "")),
            date=str(m.get("date", "")),
        )
        primary = {str(c) for c in m.get("primary_for") or []}
        for c in members:
            lst = fine_of.setdefault(c, [])
            if g in lst:
                continue
            if c in primary:
                lst.insert(0, g)
            else:
                lst.append(g)
    # 主要細產業：官方產業偏好的產業鏈優先、主題型產業鏈最後（手動指定 primary 的維持第一）
    pref = {k: [str(x) for x in v] for k, v in (fine_cfg.get("official_chains") or {}).items()}
    theme_chains = {str(x) for x in fine_cfg.get("theme_chains") or []}
    manual_primary = {str(c) for m in fine_cfg.get("manual") or [] for c in m.get("primary_for") or []}

    def score(code: str, g: str) -> tuple[int, int]:
        chain = g.split("-")[1] if g.startswith("f-") else ""
        order = pref.get(industries.get(code, ""), [])
        if chain in order:
            return (0, order.index(chain))
        return (2 if chain in theme_chains else 1, 0)

    for c, lst in fine_of.items():
        head = [lst[0]] if c in manual_primary and lst and lst[0].startswith("m-") else []
        rest = [g for g in lst if g not in head]
        rest.sort(key=lambda g: score(c, g))  # 穩定排序：同分維持頁面順序
        fine_of[c] = head + rest
    # ETF
    etf_rules = list(fine_cfg.get("etf") or [])
    for r in etf_rules:
        g = gid("e", str(r["id"]).split("/", 1)[-1])
        groups[g] = Group(
            g,
            "fine",
            str(r["name"]),
            [],
            parent=gid("o", "etf"),
            path=["ETF", str(r["name"])],
            basis="依代號後綴與名稱分類（自行整理）",
            date=snap_date,
        )
    for c in codes:
        if is_etf(c) and c not in fine_of:
            g = gid("e", etf_class(c, names.get(c, ""), etf_rules).split("/", 1)[-1])
            groups[g].members.append(c)
            fine_of[c] = [g]
    # 特別股沿用普通股
    for c in codes:
        if c in fine_of:
            continue
        p = parent_code(c)
        if p and p in fine_of:
            fine_of[c] = list(fine_of[p])
            for g in fine_of[c]:
                groups[g].members.append(c)
    # 都對不到：「（官方產業）其他」
    unassigned = [c for c in codes if c not in fine_of]
    for c in unassigned:
        o = official_of.get(c)
        oname = groups[o].name if o else "未分類"
        g = gid("x", o or "none")
        groups.setdefault(
            g,
            Group(
                g,
                "fine",
                f"{oname}・其他",
                [],
                parent=o,
                path=[oname, "其他"],
                basis="產業價值鏈與人工對照都沒有涵蓋，暫依官方產業",
                date=snap_date,
            ),
        ).members.append(c)
        fine_of[c] = [g]
    if unassigned:
        log.warning("細產業未涵蓋 %d 檔（暫歸官方產業其他）：%s", len(unassigned), ",".join(unassigned[:30]))

    # 題材
    themes_of: dict[str, list[tuple[str, str]]] = {}
    for t in themes_cfg.get("themes") or []:
        g = gid("t", str(t["id"]))
        streams: dict[str, list[str]] = {}
        for st, items in (t.get("streams") or {}).items():
            codes_st = [str(x[0]) if isinstance(x, list) else str(x) for x in items or []]
            streams[str(st)] = [c for c in codes_st if c in universe]
            for c in streams[str(st)]:
                themes_of.setdefault(c, []).append((g, str(st)))
        members = sorted({c for v in streams.values() for c in v})
        groups[g] = Group(
            g,
            "theme",
            str(t["name"]),
            members,
            streams=streams,
            path=[str(t["name"])],
            basis=str(themes_cfg.get("basis", "自行整理")),
            date=str(themes_cfg.get("updated", "")),
        )
    for grp in groups.values():
        grp.members = sorted(set(grp.members))
    return Layers(groups=groups, fine_of=fine_of, official_of=official_of, themes_of=themes_of, unassigned=unassigned)


# ------------------------------------------------------------------ 統計
def returns_at(adj: pd.DataFrame, end: int, windows: dict[str, int] = WINDOWS) -> pd.DataFrame:
    """第 end 列（含）為端點的 N 日報酬（%）。端點沒有成交時沿用最近 FILL_LIMIT 日內的收盤。"""
    filled = adj.ffill(limit=FILL_LIMIT)
    last = filled.iloc[end]
    out = {}
    for key, n in windows.items():
        if end - n < 0:
            out[key] = pd.Series(np.nan, index=adj.columns)
            continue
        base = filled.iloc[end - n]
        out[key] = ((last / base - 1) * 100).where(base > 0)
    return pd.DataFrame(out)


def rank_layer(g: Group) -> str:
    """名次在哪一組內比較：ETF 分類只和 ETF 分類比，不和股票的細產業一起排名。"""
    return "etf" if g.id.startswith("e-") else g.layer


def rank_groups(
    medians: dict[str, float], counts: dict[str, int], layer_of: dict[str, str]
) -> dict[str, tuple[int, int]]:
    """各層內依中位數由高到低排名（只排成員 ≥ MIN_RANKED 且中位數有值者）→ {id: (名次, 總數)}。"""
    out: dict[str, tuple[int, int]] = {}
    for layer in set(layer_of.values()):
        ids = [
            g
            for g, ly in layer_of.items()
            if ly == layer and counts.get(g, 0) >= MIN_RANKED and np.isfinite(medians.get(g, np.nan))
        ]
        ids.sort(key=lambda g: -medians[g])
        for i, g in enumerate(ids):
            out[g] = (i + 1, len(ids))
    return out


@dataclass
class SectorResult:
    layers: Layers
    stats: dict[str, dict[str, Any]]
    ret: pd.DataFrame  # 代號 × 期間報酬（最新）
    rs: pd.Series
    similar: dict[str, list[list[Any]]]
    date: str
    # 代號 → 三大法人近 20 日淨買超金額 ÷ 成交金額（%）；族群頁成員列與自訂族群用
    inst20: pd.Series | None = None


def ranked_parent(groups: dict[str, Group], counts: dict[str, int], g: str) -> str | None:
    """成員不足 MIN_RANKED 時往上找第一個成員足夠的上層。"""
    seen = set()
    cur = groups[g].parent
    while cur and cur in groups and cur not in seen:
        if counts.get(cur, 0) >= MIN_RANKED:
            return cur
        seen.add(cur)
        cur = groups[cur].parent
    return None


def compute(p: Panels, layers: Layers, rs: pd.Series | None = None) -> SectorResult:
    adj = p.adj_close
    n = len(p.dates)
    groups = layers.groups
    ret_now = returns_at(adj, n - 1)
    ret_lag = (
        returns_at(adj, n - 1 - RANK_LAG)
        if n > RANK_LAG
        else pd.DataFrame(np.nan, index=adj.columns, columns=list(WINDOWS))
    )
    closes = adj.ffill(limit=FILL_LIMIT)
    ma60 = closes.rolling(60, min_periods=40).mean()
    above = (closes.iloc[-1] > ma60.iloc[-1]).where(ma60.iloc[-1].notna() & closes.iloc[-1].notna())
    hi60 = closes.iloc[-60:].max()
    new_high = (closes.iloc[-1] >= hi60).where(closes.iloc[-1].notna())
    avgp = (p.value / p.volume).where(p.volume > 0)
    amt = p.total_net * avgp
    insti = {k: (amt.iloc[-k:].sum(min_count=1), p.value.iloc[-k:].sum(min_count=1)) for k in (5, 20)}
    last_close = p.close.iloc[-1]

    def members_live(g: Group) -> list[str]:
        return [c for c in g.members if c in ret_now.index]

    counts: dict[str, int] = {}
    med: dict[str, dict[str, float]] = {}
    med_lag: dict[str, float] = {}
    for g in groups.values():
        mem = members_live(g)
        r = ret_now.loc[mem]
        valid = r[RANK_WINDOW].dropna()
        counts[g.id] = int(valid.size)
        med[g.id] = {k: float(r[k].median()) if r[k].notna().any() else float("nan") for k in WINDOWS}
        rl = ret_lag.loc[mem, RANK_WINDOW].dropna() if mem else pd.Series(dtype=float)
        med_lag[g.id] = float(rl.median()) if rl.size else float("nan")
    layer_of = {g.id: rank_layer(g) for g in groups.values()}
    rk_now = rank_groups({k: v[RANK_WINDOW] for k, v in med.items()}, counts, layer_of)
    rk_lag = rank_groups(med_lag, counts, layer_of)

    stats: dict[str, dict[str, Any]] = {}
    for g in groups.values():
        mem = members_live(g)
        merged = None if counts[g.id] >= MIN_RANKED else ranked_parent(groups, counts, g.id)
        rank_src = merged or g.id
        a = above.reindex(mem).dropna()
        nh = new_high.reindex(mem).dropna()
        ins = {}
        for k, (net, val) in insti.items():
            nsum = float(net.reindex(mem).sum(min_count=1)) if mem else float("nan")
            vsum = float(val.reindex(mem).sum(min_count=1)) if mem else float("nan")
            ins[k] = (
                clean(nsum / vsum * 100, 2) if vsum and np.isfinite(vsum) and vsum > 0 and np.isfinite(nsum) else None
            )
        stats[g.id] = {
            "members": len(g.members),
            "live": len(mem),
            "med": {k: clean(v, 2) for k, v in med[g.id].items()},
            "rank": rk_now.get(rank_src, (None, None))[0],
            "of": rk_now.get(rank_src, (None, None))[1],
            "rank_prev": rk_lag.get(rank_src, (None, None))[0],
            "merged": merged,
            "above60": clean(float(a.mean()) * 100, 1) if a.size else None,
            "high60": int(nh.sum()) if nh.size else 0,
            "insti5": ins[5],
            "insti20": ins[20],
            "new": None,
        }
    rs_now = rs if rs is not None else pd.Series(np.nan, index=p.codes)
    similar = correlated(adj)
    _ = last_close
    net20, val20 = insti[20]
    inst20 = (net20 / val20.where(val20 > 0) * 100).replace([np.inf, -np.inf], np.nan)
    return SectorResult(
        layers=layers, stats=stats, ret=ret_now, rs=rs_now, similar=similar, date=p.dates[-1], inst20=inst20
    )


def correlated(adj: pd.DataFrame, days: int = CORR_DAYS, top: int = CORR_TOP) -> dict[str, list[list[Any]]]:
    """近 days 日日報酬相關係數最高的 top 檔（普通股；窗內任一日缺值者不列）。"""
    cols = [c for c in adj.columns if is_common_stock(str(c))]
    r = adj[cols].iloc[-(days + 1) :].pct_change().iloc[1:]
    r = r.loc[:, r.notna().all() & (r.std() > 0)]
    if r.shape[1] < 2:
        return {}
    z = (r - r.mean()) / r.std(ddof=1)
    m = z.to_numpy()
    c = (m.T @ m) / (m.shape[0] - 1)
    np.fill_diagonal(c, -np.inf)
    codes = list(r.columns)
    k = min(top, len(codes) - 1)
    idx = np.argpartition(-c, k, axis=1)[:, :k]
    out: dict[str, list[list[Any]]] = {}
    for i, code in enumerate(codes):
        sel = sorted(idx[i], key=lambda j: -c[i, j])
        out[str(code)] = [[str(codes[j]), round(float(c[i, j]), 3)] for j in sel]
    return out


# ------------------------------------------------------------------ 歷史（名次走勢、寬度）與等權指數
def group_history(p: Panels, layers: Layers, days: int = HISTORY_DAYS) -> dict[str, dict[str, list[Any]]]:
    """最近 days 日：每日名次（3 個月中位數）與站上 60 日線比例。"""
    adj = p.adj_close.ffill(limit=FILL_LIMIT)
    n = len(adj)
    start = max(0, n - days)
    win = WINDOWS[RANK_WINDOW]
    r63 = (adj / adj.shift(win) - 1) * 100
    ma60 = adj.rolling(60, min_periods=40).mean()
    abv = (adj > ma60).where(ma60.notna() & adj.notna())
    groups = layers.groups
    col = {c: i for i, c in enumerate(adj.columns)}
    R = r63.to_numpy()[start:]
    A = abv.to_numpy(dtype=float)[start:]
    meds: dict[str, np.ndarray] = {}
    breadth: dict[str, np.ndarray] = {}
    for g in groups.values():
        ix = [col[c] for c in g.members if c in col]
        if not ix:
            continue
        with np.errstate(all="ignore"), warnings.catch_warnings():
            warnings.simplefilter("ignore", RuntimeWarning)
            sub = R[:, ix]
            cnt = np.sum(~np.isnan(sub), axis=1)
            md = np.where(
                cnt >= MIN_RANKED,
                np.nanmedian(np.where(np.isnan(sub), np.nan, sub), axis=1) if sub.size else np.nan,
                np.nan,
            )
            meds[g.id] = md
            breadth[g.id] = np.nanmean(A[:, ix], axis=1) * 100
    out: dict[str, dict[str, list[Any]]] = {}
    layers_ids: dict[str, list[str]] = {}
    for g in groups.values():
        if g.id in meds:
            layers_ids.setdefault(rank_layer(g), []).append(g.id)
    ranks: dict[str, list[int | None]] = {gid_: [None] * (n - start) for gid_ in meds}
    for _layer, ids in layers_ids.items():
        M = np.vstack([meds[i] for i in ids])
        for t in range(M.shape[1]):
            colv = M[:, t]
            ok = np.where(np.isfinite(colv))[0]
            order = ok[np.argsort(-colv[ok])]
            for rnk, j in enumerate(order):
                ranks[ids[j]][t] = rnk + 1
    for g_id in meds:
        out[g_id] = {"rank": ranks[g_id], "breadth": arr(breadth[g_id], 1), "median3m": arr(meds[g_id], 2)}
    return out


def equal_weight_index(p: Panels, members: list[str], days: int = INDEX_DAYS) -> list[Any]:
    """族群等權指數：成員每日報酬（還原收盤）的平均連乘，起點 100。"""
    cols = [c for c in members if c in p.codes]
    if not cols:
        return []
    adj = p.adj_close[cols].iloc[-(days + 1) :]
    r = adj.pct_change(fill_method=None).iloc[1:]
    mean = r.mean(axis=1, skipna=True).fillna(0.0)
    idx = (1 + mean).cumprod() * 100
    return arr(idx.to_numpy(), 2)


# ------------------------------------------------------------------ 輸出
def stock_block(res: SectorResult, code: str, names: dict[str, str]) -> dict[str, Any] | None:
    """個股檔 `sectors`：官方產業、細產業（主要在第一個；名次、3 個月中位數、本股在族群內名次）、題材。"""
    L = res.layers
    groups = L.groups
    rs = res.rs

    def in_group(g: Group) -> tuple[int | None, int]:
        mem = [c for c in g.members if c in rs.index and pd.notna(rs.get(c))]
        if code not in mem:
            return None, len(mem)
        order = sorted(mem, key=lambda c: -float(rs[c]))
        return order.index(code) + 1, len(mem)

    def item(g_id: str, stream: str | None = None) -> dict[str, Any]:
        g = groups[g_id]
        st = res.stats.get(g_id, {})
        a, b = in_group(g)
        return {
            "id": g_id,
            "name": g.name,
            "path": g.path,
            "layer": g.layer,
            "stream": stream,
            "rank": st.get("rank"),
            "of": st.get("of"),
            "rank_prev": st.get("rank_prev"),
            "merged": st.get("merged"),
            "merged_name": groups[st["merged"]].name if st.get("merged") else None,
            "med3m": (st.get("med") or {}).get("3M"),
            "members": st.get("members"),
            "pos": a,
            "pos_of": b,
        }

    off = L.official_of.get(code)
    fine = L.fine_of.get(code) or []
    if not off and not fine:
        return None
    return {
        "date": res.date,
        "official": item(off) if off else None,
        "fine": [item(g) for g in fine],
        "themes": [item(g, st) for g, st in L.themes_of.get(code, [])],
    }


def chg_pct(p: Panels, c: str) -> float | None:
    """當日漲跌幅（%）＝漲跌 ÷ 前一日收盤（收盤 − 漲跌）。"""
    close, chg = p.close[c].iloc[-1], p.change[c].iloc[-1]
    if pd.isna(close) or pd.isna(chg) or close - chg <= 0:
        return None
    return clean(chg / (close - chg) * 100, 2)


def write_outputs(p: Panels, res: SectorResult, out: Path) -> dict[str, Any]:
    """sectors.json（三層清單＋統計）與 sectors/{id}.json（等權指數、成員、名次走勢、寬度、上中下游）。"""
    L = res.layers
    hist = group_history(p, L)
    names = p.names
    ret = res.ret
    rs = res.rs
    inst20 = res.inst20 if res.inst20 is not None else pd.Series(dtype=float)
    taiex_dates = p.dates[-(INDEX_DAYS):]
    listed = {g_id: g for g_id, g in L.groups.items() if g.listed and g.members}
    index_rows = []
    for g_id, g in sorted(listed.items(), key=lambda kv: (kv[1].layer, kv[0])):
        st = res.stats[g_id]
        index_rows.append(
            {
                "id": g_id,
                "layer": g.layer,
                "name": g.name,
                "path": g.path,
                "parent": g.parent,
                **st,
                "streams": bool(g.streams) and g.layer == "theme",
            }
        )
    files = 0
    for g_id, g in listed.items():
        members = []
        for c in g.members:
            if c not in ret.index:
                continue
            members.append(
                {
                    "code": c,
                    "name": names.get(c, c),
                    "close": clean(p.close[c].iloc[-1], 2),
                    "chg": clean(p.change[c].iloc[-1], 2),
                    "chg_pct": chg_pct(p, c),
                    "rs": clean(rs.get(c), 1),
                    "r1m": clean(ret.at[c, "1M"], 2),
                    "r3m": clean(ret.at[c, "3M"], 2),
                    "stream": next((s for s, lst in g.streams.items() if c in lst), None),
                    "inst20": clean(inst20.get(c), 2),
                }
            )
        h = hist.get(g_id, {})
        detail = {
            "id": g_id,
            "layer": g.layer,
            "name": g.name,
            "path": g.path,
            "parent": g.parent,
            "parent_name": L.groups[g.parent].name if g.parent in L.groups else None,
            "basis": g.basis,
            "updated": g.date,
            "date": res.date,
            "stats": res.stats[g_id],
            "members": members,
            "streams": g.streams if g.layer in ("theme", "chain") or len(g.streams) > 1 else {},
            "index": {"dates": taiex_dates, "values": equal_weight_index(p, g.members)},
            "history": {"dates": p.dates[-HISTORY_DAYS:], **h},
        }
        write_json(out / "sectors" / f"{g_id}.json", detail)
        files += 1
    # 每檔：主要細產業與全部細產業、官方產業、題材；1／3／6 個月報酬、RS、站上 60 日線、創 60 日新高（自訂族群在前端用這份計算）
    closes = p.adj_close.ffill(limit=FILL_LIMIT)
    ma60 = closes.iloc[-60:].mean()
    hi60 = closes.iloc[-60:].max()
    stocks: dict[str, list[Any]] = {}
    for c, fines in L.fine_of.items():
        if c not in ret.index:
            continue
        last = closes[c].iloc[-1]
        stocks[c] = [
            fines,
            L.official_of.get(c),
            [t for t, _ in L.themes_of.get(c, [])],
            clean(ret.at[c, "1M"], 2),
            clean(ret.at[c, "3M"], 2),
            clean(ret.at[c, "6M"], 2),
            clean(rs.get(c), 1),
            None if pd.isna(last) or pd.isna(ma60[c]) else int(last > ma60[c]),
            None if pd.isna(last) else int(last >= hi60[c]),
            clean(inst20.get(c), 2),
        ]
    summary = {
        "date": res.date,
        "min_ranked": MIN_RANKED,
        "rank_window": RANK_WINDOW,
        "unassigned": L.unassigned,
        "groups": index_rows,
        "stock_cols": ["fine", "official", "themes", "r1m", "r3m", "r6m", "rs", "above60", "high60", "inst20"],
        "stocks": stocks,
    }
    write_json(out / "sectors.json", summary)
    return {"sector_files": files, "sector_groups": len(index_rows), "sector_unassigned": len(L.unassigned)}


def add_triggers(out: Path) -> int:
    """部署時（evidence 之後）：各族群「今日新觸發」檔數＝evidence_today.json 上架策略今日觸發的代號。"""
    import json

    today_path = out / "evidence_today.json"
    sec_path = out / "sectors.json"
    if not today_path.exists() or not sec_path.exists():
        return 0
    today = json.loads(today_path.read_text(encoding="utf-8"))
    d = today.get("date")
    hit: set[str] = set()
    for s in (today.get("strategies") or {}).values():
        hit |= {c for c, td in (s.get("t") or {}).items() if td == d}
    sec = json.loads(sec_path.read_text(encoding="utf-8"))
    n = 0
    for row in sec.get("groups") or []:
        f = out / "sectors" / f"{row['id']}.json"
        if not f.exists():
            continue
        detail = json.loads(f.read_text(encoding="utf-8"))
        codes = [m["code"] for m in detail.get("members") or []]
        cnt = sum(1 for c in codes if c in hit)
        row["new"] = cnt
        detail["stats"]["new"] = cnt
        for m in detail.get("members") or []:
            m["new"] = m["code"] in hit
        write_json(f, detail)
        n += 1
    write_json(sec_path, sec)
    return n
