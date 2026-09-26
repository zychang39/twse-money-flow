"""選配 AI 盤後摘要：只有設定 ANTHROPIC_API_KEY 時才執行（deploy.yml 的 build-web 步驟）。

- 輸入只用已產生的衍生資料（市場概況、法人、燈號、分數變化最大的個股），不另外抓資料。
- 模型：預設以 Models API 取得最新可用模型；可用環境變數 ANTHROPIC_MODEL 指定。
- 定位是決策輔助：提示詞禁止使用「買進／賣出」等建議字眼，輸出後再過濾一次；前端標示「AI 生成」。
- 任何錯誤只記錄警告，不影響部署。
"""

from __future__ import annotations

import json
import logging
import os
import re
from datetime import datetime
from pathlib import Path
from typing import Any

import requests

from pipeline.core.dates import TPE

log = logging.getLogger(__name__)
API = "https://api.anthropic.com/v1"
VERSION = "2023-06-01"
FORBIDDEN = re.compile(r"買進|賣出|買入|賣掉|建議買|建議賣|進場|出場|加碼|減碼|停損|目標價")

SYSTEM = (
    "你是台股盤後資料的摘要助理。只根據使用者提供的 JSON 數據，用繁體中文寫 4 到 6 點條列摘要，"
    "每點一句、40 字以內，描述大盤、法人資金、市場燈號與分數變化明顯的產業或個股。"
    "只陳述數據與變化，不預測走勢，不提供任何交易建議，"
    "禁止使用「買進」「賣出」「進場」「出場」「加碼」「減碼」「停損」「目標價」等字眼。"
    "只輸出條列內容，每行以「・」開頭。"
)


def _headers(key: str) -> dict[str, str]:
    return {"x-api-key": key, "anthropic-version": VERSION, "content-type": "application/json"}


def pick_model(key: str) -> str | None:
    if os.environ.get("ANTHROPIC_MODEL"):
        return os.environ["ANTHROPIC_MODEL"]
    r = requests.get(f"{API}/models", headers=_headers(key), params={"limit": 20}, timeout=30)
    r.raise_for_status()
    models = r.json().get("data", [])  # 依發布時間由新到舊
    return models[0]["id"] if models else None


def build_input(out: Path) -> dict[str, Any]:
    summary = json.loads((out / "summary.json").read_text(encoding="utf-8"))
    market = json.loads((out / "market.json").read_text(encoding="utf-8"))
    cols = summary["columns"]
    rows = [dict(zip(cols, r, strict=True)) for r in summary["rows"]]
    liquid = sorted(rows, key=lambda r: -(r.get("value_million") or 0))[:300]

    def pick(r: dict[str, Any]) -> dict[str, Any]:
        keys = ("code", "name", "industry", "change_pct", "composite", "composite_chg", "foreign_net_lots")
        return {k: r.get(k) for k in keys}

    movers = sorted((r for r in liquid if r.get("composite_chg") is not None), key=lambda r: -r["composite_chg"])
    return {
        "date": summary["date"],
        "taiex": market.get("taiex"),
        "breadth": market.get("breadth"),
        "flows_億": market.get("flows", [])[-5:],
        "sectors_top": market.get("sectors", [])[:8],
        "env": [
            {k: x[k] for k in ("label", "state", "value")}
            for x in (market.get("env") or {}).get("lights", []) + (market.get("temperature") or {}).get("lights", [])
        ],
        "composite_up": [pick(r) for r in movers[:8]],
        "composite_down": [pick(r) for r in movers[-8:]],
    }


def clean_lines(text: str) -> list[str]:
    lines = []
    for line in text.splitlines():
        s = line.strip().lstrip("・-*• ").strip()
        if s and not FORBIDDEN.search(s):
            lines.append(s)
    return lines[:6]


def generate(out: Path) -> dict[str, Any] | None:
    key = os.environ.get("ANTHROPIC_API_KEY")
    if not key or not (out / "summary.json").exists() or not (out / "market.json").exists():
        return None
    try:
        model = pick_model(key)
        if not model:
            log.warning("AI 摘要：找不到可用模型")
            return None
        payload = build_input(out)
        r = requests.post(
            f"{API}/messages",
            headers=_headers(key),
            json={
                "model": model,
                "max_tokens": 800,
                "system": SYSTEM,
                "messages": [{"role": "user", "content": json.dumps(payload, ensure_ascii=False)}],
            },
            timeout=120,
        )
        r.raise_for_status()
        text = "".join(b.get("text", "") for b in r.json().get("content", []) if b.get("type") == "text")
    except (requests.RequestException, ValueError, KeyError) as exc:
        log.warning("AI 摘要失敗（略過）：%s", exc)
        return None
    lines = clean_lines(text)
    if not lines:
        return None
    result = {
        "date": payload["date"],
        "lines": lines,
        "model": model,
        "generated_at": datetime.now(TPE).isoformat(timespec="seconds"),
    }
    (out / "ai_summary.json").write_text(json.dumps(result, ensure_ascii=False), encoding="utf-8")
    return result
