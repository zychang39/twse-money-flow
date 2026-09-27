"""產生截圖用的使用者資料（自選、持倉、日誌）：價格全部取自真實衍生資料，只有「持倉紀錄」本身是測試輸入。

用法：python scripts/make-seed.py <real-data-dir> > seed.json
"""
import json
import sys
from pathlib import Path

root = Path(sys.argv[1])
summary = json.loads((root / "summary.json").read_text())
cols = summary["columns"]
rows = {r[0]: dict(zip(cols, r)) for r in summary["rows"]}
date = summary["date"]


def hist(code):
    return json.loads((root / "stocks" / f"{code}.json").read_text())


def close_ago(code, n):
    h = hist(code)
    c = [x for x in h["c"] if x is not None]
    return h["d"][-1 - n], c[-1 - n]


def tick(p):
    return round(p, 0) if p >= 1000 else round(p, 1) if p >= 100 else round(p, 2)


trades = []
# 持倉：進場價＝約 40 個交易日前的收盤；停損 −8%、目標 +20%（測試輸入）
for i, (code, shares, ago) in enumerate([("2330", 1000, 40), ("2317", 3000, 35), ("0050", 5000, 60), ("2382", 2000, 12), ("2603", 2000, 25)]):
    d, px = close_ago(code, ago)
    r = rows[code]
    stop = tick(px * 0.92)
    # 其中一檔的停損設得較緊，讓「持股警示」有真實的觸及／接近停損情境
    if code == "2382":
        stop = tick(r["close"] * 1.01)
    trades.append({
        "id": f"seed-open-{i}", "code": code, "name": r["name"], "status": "open", "openedAt": d,
        "entry": px, "shares": shares, "stop": stop, "target": tick(px * 1.2), "reasonType": ["籌碼", "營收", "估值", "動能", "籌碼"][i],
        "checklist": {"market": "中性", "trend": "年線之上、短線整理", "revenue": "成長", "valuation": "合理", "reason": "投信連買、月營收年增"},
    })
# 已平倉：一筆有檢討、一筆待檢討
for j, (code, ago_in, ago_out, review) in enumerate([("2454", 80, 50, "依計畫在停損附近出場；進場時追高，下次等回檔。"), ("2308", 45, 8, "")]):
    d1, p1 = close_ago(code, ago_in)
    d2, p2 = close_ago(code, ago_out)
    r = rows[code]
    trades.append({
        "id": f"seed-closed-{j}", "code": code, "name": r["name"], "status": "closed", "openedAt": d1, "closedAt": d2,
        "entry": p1, "shares": 1000, "stop": tick(min(p1, p2) * 1.01) if j == 0 else tick(p1 * 0.9), "target": tick(p1 * 1.2), "reasonType": "動能",
        "checklist": {"market": "中性", "trend": "多頭（年線、季線之上）", "revenue": "成長", "valuation": "合理", "reason": "RS 強勢"},
        "exit": p2, "review": review, "errorTags": ["追高"] if j == 0 else [], "fees": 0,
    })
watch = ["2454", "2345", "6669", "3231", "2308", "2881", "1101", "2412", "3008", "2303", "6505", "3711"]
watchlist = [{"code": c, "group": "預設" if k < 8 else "觀察", "addedAt": "2026-08-01T12:00:00.000Z", "order": k} for k, c in enumerate(watch) if c in rows]
print(json.dumps({"date": date, "watchlist": watchlist, "trades": trades}, ensure_ascii=False, indent=1))
