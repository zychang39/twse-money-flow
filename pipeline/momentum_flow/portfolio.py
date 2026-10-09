"""組合試算（規格第五節；純計算，不送單）。前端 web/src/momentum/lib/portfolio.ts 為同一套規則的 TS 版本。

- 每名額金額 S＝M ÷ N；可用名額＝floor(N × 曝險上限)。
- 依排序逐檔填入；同一主族群最多 group_max_count 檔、試算金額合計 ≤ group_max_weight × M；超過者跳過。
- 股數（P＝未還原收盤）：整股張數＝floor(S ÷ (P × 1000))、零股＝floor((S − 張數 × 1000 × P) ÷ P)。
- 未填滿的名額＝「現金」；不因名額未滿放寬任何門檻。
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any

from pipeline.momentum_flow.params import PARAMS


@dataclass(frozen=True)
class Pick:
    code: str
    name: str
    group: str | None
    price: float | None


def plan(
    picks: list[Pick], total: int, slots: int, exposure: float, params: dict[str, Any] | None = None
) -> dict[str, Any]:
    p = params or PARAMS
    if total <= 0 or slots <= 0:
        return {"total": total, "slots": slots, "per_slot": 0, "usable": 0, "rows": [], "skipped": []}
    per = total / slots
    usable = math.floor(slots * exposure + 1e-9)
    max_n = int(p["group_max_count"])
    max_w = float(p["group_max_weight"]) * total
    count: dict[str, int] = {}
    amount: dict[str, float] = {}
    rows: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []
    for pk in picks:
        if len(rows) >= usable:
            break
        if pk.price is None or not (pk.price > 0):
            skipped.append({"code": pk.code, "why": "資料不足"})
            continue
        g = pk.group or ""
        if g and count.get(g, 0) >= max_n:
            skipped.append({"code": pk.code, "why": f"同一主族群已 {max_n} 檔"})
            continue
        lots = math.floor(per / (pk.price * 1000))
        odd = math.floor((per - lots * 1000 * pk.price) / pk.price)
        amt = (lots * 1000 + odd) * pk.price
        if g and amount.get(g, 0.0) + amt > max_w + 1e-6:
            skipped.append({"code": pk.code, "why": f"同一主族群試算金額合計超過 {float(p['group_max_weight']):.0%}"})
            continue
        if g:
            count[g] = count.get(g, 0) + 1
            amount[g] = amount.get(g, 0.0) + amt
        rows.append(
            {
                "code": pk.code,
                "name": pk.name,
                "group": pk.group,
                "price": pk.price,
                "lots": lots,
                "odd": odd,
                "amount": round(amt),
            }
        )
    for _ in range(len(rows), usable):
        rows.append(
            {"code": None, "name": "現金", "group": None, "price": None, "lots": 0, "odd": 0, "amount": round(per)}
        )
    return {"total": total, "slots": slots, "per_slot": round(per), "usable": usable, "rows": rows, "skipped": skipped}
