"""盤中到價提醒：依 config/alerts.yml 以證交所基本市況報導網站的即時報價（mis.twse.com.tw）檢查，
達到價格時推送 Telegram。

- 每 15 分鐘由 data.yml 的獨立 job 執行；一次請求批次查詢所有代號（上市、上櫃前綴都帶）。
- 以當日最高／最低判斷是否「曾經」到價，避免兩次檢查之間穿越未被偵測。
- 同一條件當日只推送一次；狀態存在 Actions cache（--state 檔案），不寫入 data 分支。
- 回應日期不是今天（休市）時直接略過。
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

import yaml

from pipeline.core.dates import now_tpe

log = logging.getLogger(__name__)
MIS_URL = "https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch={ch}&json=1&delay=0"
ROOT = Path(__file__).resolve().parents[1]


def load_rules(path: Path | None = None) -> dict[str, Any]:
    path = path or ROOT / "config" / "alerts.yml"
    raw = yaml.safe_load(path.read_text(encoding="utf-8")) if path.exists() else None
    raw = raw or {}
    rules = []
    for r in raw.get("alerts") or []:
        code = str(r.get("code", "")).strip()
        if not code:
            continue
        above = _num(r.get("above"))
        below = _num(r.get("below"))
        if not above and not below:
            continue
        rules.append({"code": code, "above": above, "below": below, "note": str(r.get("note") or "")})
    digest = [str(c).strip() for c in raw.get("digest") or [] if str(c).strip()]
    return {"alerts": rules, "digest": digest}


def _num(v: Any) -> float | None:
    try:
        f = float(str(v).replace(",", ""))
    except (TypeError, ValueError):
        return None
    return f if f == f and f > 0 else None


def mis_url(codes: list[str]) -> str:
    ch = "|".join(f"{ex}_{c}.tw" for c in dict.fromkeys(codes) for ex in ("tse", "otc"))
    return MIS_URL.format(ch=ch)


def parse_mis(payload: bytes | str) -> dict[str, dict[str, Any]]:
    """回傳 {code: {name, price, high, low, prev, date, time, market}}；無成交欄位以 None 表示。"""
    data = json.loads(payload)
    out: dict[str, dict[str, Any]] = {}
    for item in data.get("msgArray") or []:
        code = str(item.get("c", "")).strip()
        prev = _num(item.get("y"))
        if not code or prev is None:
            continue
        bid = _num(str(item.get("b", "")).split("_")[0])
        price = _num(item.get("z")) or _num(item.get("pz")) or bid or prev
        out[code] = {
            "name": item.get("n", code),
            "price": price,
            "high": _num(item.get("h")),
            "low": _num(item.get("l")),
            "prev": prev,
            "date": item.get("d", ""),
            "time": item.get("%") or item.get("t", ""),
            "market": item.get("ex", ""),
        }
    return out


def evaluate(rules: list[dict[str, Any]], quotes: dict[str, dict[str, Any]], sent: set[str]) -> list[dict[str, Any]]:
    """回傳本次新觸發的提醒（已送過的條件略過）。"""
    hits = []
    for r in rules:
        q = quotes.get(r["code"])
        if not q or q["price"] is None:
            continue
        high = max(x for x in (q["high"], q["price"]) if x is not None)
        low = min(x for x in (q["low"], q["price"]) if x is not None)
        for side, level, reached in (("above", r["above"], high), ("below", r["below"], low)):
            if level is None:
                continue
            key = f"{r['code']}:{side}:{level:g}"
            ok = reached >= level if side == "above" else reached <= level
            if ok and key not in sent:
                hits.append({**r, "side": side, "level": level, "key": key, **q})
    return hits


def format_hits(hits: list[dict[str, Any]]) -> str:
    lines = ["<b>🔔 盤中到價提醒</b>"]
    for h in hits:
        arrow = "≥" if h["side"] == "above" else "≤"
        chg = (h["price"] - h["prev"]) / h["prev"] * 100 if h["prev"] else 0
        mark = "▲" if chg > 0 else "▼" if chg < 0 else "－"
        lines.append(
            f"{h['name']} {h['code']}：{h['price']:g}（{mark}{abs(chg):.2f}%）已{('觸及' if h['side'] == 'above' else '跌至')}"
            f" {arrow} {h['level']:g}" + (f"｜{h['note']}" if h["note"] else "") + f"（{h['time']}）"
        )
    lines.append("僅供研究參考，非投資建議。")
    return "\n".join(lines)


def load_state(path: Path, today: str) -> set[str]:
    try:
        st = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return set()
    return set(st.get("sent", [])) if st.get("date") == today else set()


def save_state(path: Path, today: str, sent: set[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"date": today, "sent": sorted(sent)}, ensure_ascii=False), encoding="utf-8")


def run_alerts(ctx: Any, state_path: Path | None = None, rules_path: Path | None = None) -> dict[str, Any]:
    from pipeline.notify import telegram

    cfg = load_rules(rules_path)
    rules = cfg["alerts"]
    if not rules:
        return {"alerts": "skipped", "reason": "config/alerts.yml 沒有提醒條件"}
    now = now_tpe()
    if now.weekday() >= 5:
        return {"alerts": "skipped", "reason": "週末"}
    today = now.strftime("%Y%m%d")
    state_path = state_path or Path(".alerts-state/state.json")
    sent = load_state(state_path, today)
    quotes = parse_mis(ctx.client.get_bytes(mis_url([r["code"] for r in rules])))
    if not quotes or all(q["date"] != today for q in quotes.values()):
        return {"alerts": "skipped", "reason": "今日無盤中資料（休市）"}
    quotes = {c: q for c, q in quotes.items() if q["date"] == today}
    hits = evaluate(rules, quotes, sent)
    pushed = False
    if hits:
        pushed = telegram.send(format_hits(hits))
        if pushed or not telegram.configured():
            sent |= {h["key"] for h in hits}
    save_state(state_path, today, sent)
    log.info("盤中提醒：%d 條規則、%d 檔報價、觸發 %d", len(rules), len(quotes), len(hits))
    return {
        "alerts": "ok",
        "rules": len(rules),
        "quotes": len(quotes),
        "hits": [h["key"] for h in hits],
        "pushed": pushed,
    }
