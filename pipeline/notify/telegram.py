"""Telegram 推播：盤後日報摘要、風險旗標、盤中到價提醒。

使用 repo secrets TELEGRAM_BOT_TOKEN、TELEGRAM_CHAT_ID（環境變數）；沒有設定時自動略過。
"""

from __future__ import annotations

import html
import json
import logging
import os
from pathlib import Path
from typing import Any

import requests

log = logging.getLogger(__name__)
MAX_LEN = 3900  # Telegram 單則上限 4096 字元


def configured() -> bool:
    return bool(os.environ.get("TELEGRAM_BOT_TOKEN") and os.environ.get("TELEGRAM_CHAT_ID"))


def send(text: str) -> bool:
    if not configured():
        log.info("未設定 TELEGRAM_BOT_TOKEN／TELEGRAM_CHAT_ID，略過推播")
        return False
    token, chat = os.environ["TELEGRAM_BOT_TOKEN"], os.environ["TELEGRAM_CHAT_ID"]
    ok = True
    for chunk in split_message(text):
        r = requests.post(
            f"https://api.telegram.org/bot{token}/sendMessage",
            json={"chat_id": chat, "text": chunk, "parse_mode": "HTML", "disable_web_page_preview": True},
            timeout=30,
        )
        if r.status_code >= 300:
            log.warning("Telegram 推播失敗：%s %s", r.status_code, r.text[:200])
            ok = False
    return ok


def split_message(text: str, limit: int = MAX_LEN) -> list[str]:
    parts, cur = [], ""
    for line in text.split("\n"):
        if len(cur) + len(line) + 1 > limit and cur:
            parts.append(cur)
            cur = ""
        cur += line + "\n"
    if cur.strip():
        parts.append(cur)
    return parts


def _arrow(v: float | None) -> str:
    if v is None:
        return ""
    return "▲" if v > 0 else "▼" if v < 0 else "－"


def _lots(v: Any) -> str:
    if v is None:
        return "—"
    v = float(v)
    return f"{'+' if v > 0 else ''}{v:,.0f}"


def build_digest(web_data: Path, codes: list[str], site_url: str = "", failures: list[str] | None = None) -> str:
    """盤後日報：大盤、法人金額、自選／持股的漲跌、法人、融資、分數變化與新風險旗標。

    codes 來自 config/alerts.yml 的 digest（App「匯出提醒設定」會帶入自選股與持股）；
    沒有設定時改列綜合分數上升最多的 5 檔（成交值前 300 檔）。
    """
    summary = json.loads((web_data / "summary.json").read_text(encoding="utf-8"))
    cols = summary["columns"]
    rows = {r[0]: dict(zip(cols, r, strict=True)) for r in summary["rows"]}
    lines = [f"<b>📊 台股盤後日報 {summary['date']}</b>"]
    market_path = web_data / "market.json"
    if market_path.exists():
        m = json.loads(market_path.read_text(encoding="utf-8"))
        tx = m.get("taiex", {})
        if tx.get("close") is not None:
            chg = tx.get("change")
            lines.append(f"加權指數 {tx['close']:,.2f} {_arrow(chg)}{abs(chg or 0):,.2f}")
        if m.get("flows"):
            f = m["flows"][-1]
            lines.append(f"法人（億）外資 {f['foreign']:+.1f}／投信 {f['trust']:+.1f}／自營 {f['dealer']:+.1f}")
        if m.get("env"):
            lines.append(f"資金燈號：{m['env']['summary']}")
    lines.append("")
    if not codes:
        liquid = sorted(rows.values(), key=lambda r: -(r.get("value_million") or 0))[:300]
        top = sorted((r for r in liquid if r.get("composite_chg")), key=lambda r: -r["composite_chg"])[:5]
        codes = [r["code"] for r in top]
        if codes:
            lines.append("<b>綜合分數上升最多（成交值前 300 檔）</b>")
    new_flags = []
    for code in codes:
        r = rows.get(code)
        if not r:
            continue
        chg = r.get("change")
        comp = r.get("composite")
        cchg = r.get("composite_chg")
        lines.append(
            f"<b>{html.escape(str(r['name']))}</b> {code} {r.get('close')} {_arrow(chg)}{abs(chg or 0):g}"
            f"（{r.get('change_pct') or 0:+.2f}%）綜合 {comp if comp is not None else '—'}"
            + (f"（{cchg:+g}）" if cchg else "")
        )
        lines.append(
            f"  外資 {_lots(r.get('foreign_net_lots'))}・投信 {_lots(r.get('trust_net_lots'))}・融資 {_lots(r.get('margin_change'))} 張"
        )
        ids = set(r.get("new_flags") or [])
        for f in r.get("flags") or []:
            if f["id"] in ids:
                new_flags.append(
                    f"⚠️ {html.escape(str(r['name']))}：{f['label']}"
                    + (f"（{html.escape(f.get('detail', ''))}）" if f.get("detail") else "")
                )
    if new_flags:
        lines += ["", "<b>新出現的風險旗標</b>", *new_flags]
    if failures:
        lines += ["", f"資料源異常 {len(failures)} 項（詳見 GitHub Issue「data-failure」）"]
    if site_url:
        lines += ["", site_url]
    lines += ["", "僅供研究參考，非投資建議。"]
    return "\n".join(lines)


def send_daily_digest(web_data: Path, codes: list[str], site_url: str = "", failures: list[str] | None = None) -> bool:
    if not configured():
        log.info("未設定 Telegram secrets，略過日報推播")
        return False
    if not (web_data / "summary.json").exists():
        log.warning("找不到 summary.json，略過日報推播")
        return False
    return send(build_digest(web_data, codes, site_url, failures))
