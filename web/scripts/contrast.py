"""WCAG AA 對比檢查：直接讀 src/styles/tokens.css 的 tokens（只做深色，一個 :root 區塊），檢查所有文字色 × 背景（含環境光最亮處、漲跌膠囊底色、表格選取列、圖表提示框、已選取的門檻）≥ 4.5:1。

用法：python3 scripts/contrast.py（有任何一組低於 4.5 時以非 0 結束）
"""
import re
import sys
from pathlib import Path

css = (Path(__file__).parent.parent / "src/styles/tokens.css").read_text(encoding="utf-8")


def block(selector_regex):
    m = re.search(selector_regex + r"\s*\{(.*?)\n\}", css, re.S)
    return dict(re.findall(r"--([\w-]+):\s*([^;]+);", m.group(1)))


dark = block(r"\n:root")


def parse(c):
    c = c.strip()
    if c.startswith("#"):
        return tuple(int(c[i : i + 2], 16) for i in (1, 3, 5)) + (1.0,)
    p = [x.strip() for x in re.match(r"rgba?\(([^)]+)\)", c).group(1).split(",")]
    return (int(p[0]), int(p[1]), int(p[2]), float(p[3]) if len(p) > 3 else 1.0)


def over(fg, bg):
    a = fg[3]
    return tuple(round(fg[i] * a + bg[i] * (1 - a)) for i in range(3)) + (1.0,)


def lum(c):
    def ch(v):
        v = v / 255
        return v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4

    return 0.2126 * ch(c[0]) + 0.7152 * ch(c[1]) + 0.0722 * ch(c[2])


def ratio(a, b):
    la, lb = lum(a), lum(b)
    return (max(la, lb) + 0.05) / (min(la, lb) + 0.05)


failed = []
for name, t in (("dark", dark),):
    P = {k: parse(v) for k, v in t.items() if v.strip().startswith(("#", "rgb"))}
    bgs = {"bg": P["bg"], "surface-1": P["surface-1"], "surface-2": P["surface-2"]}
    # 環境光：最亮處在 y=0（狀態列底下，只有導覽列圖示，非文字）；第一行文字（大標題）約在 y=56 以下，
    # 漸層在 --ambient-h（576px）內線性淡出 → 文字處最強約 90%。環境光只跟隨漲跌（up／down／neutral）。
    for g in ("up", "down", "neutral"):
        c = P[f"glow-{g}"]
        bgs[f"glow-{g}"] = over((c[0], c[1], c[2], c[3] * 0.9), P["bg"])
    # 第三輪：表格選取列（surface-row 疊在卡片上）、圖表提示框（glass-strong 疊在背景上）
    bgs["surface-row on surface-1"] = over(P["surface-row"], P["surface-1"])
    bgs["glass-strong on bg"] = over(P["glass-strong"], P["bg"])
    worst = 99.0
    # 2026-10 改版：彩色文字（漲跌、風險、可點）只放在背景與卡片上（不放在次層 surface-2、按壓底色、玻璃上）；
    # 主文字與次文字對所有底色都要 ≥ 4.5:1
    colored_bgs = {"bg", "surface-1"} | {k for k in bgs if k.startswith("glow-")}
    for fg in ("text-1", "text-2", "up", "down", "risk", "brand"):
        for bk, b in bgs.items():
            if fg not in ("text-1", "text-2") and bk not in colored_bgs:
                continue
            f = P[fg]
            r = ratio(over(f, b) if f[3] < 1 else f, b)
            worst = min(worst, r)
            if r < 4.5:
                failed.append((name, fg, bk, round(r, 2)))
    for fg, tint in (("up", "up-tint"), ("down", "down-tint"), ("risk", "risk-tint")):
        for base in ("surface-1", "bg"):
            b = over(P[tint], P[base])
            r = ratio(P[fg], b)
            worst = min(worst, r)
            if r < 4.5:
                failed.append((name, fg, f"{tint} on {base}", round(r, 2)))
    # 淡藍底上的主文字（已選取的常用門檻）
    for base in ("surface-1", "surface-2"):
        r = ratio(P["text-1"], over(P["brand-tint"], P[base]))
        worst = min(worst, r)
        if r < 4.5:
            failed.append((name, "brand", f"brand-tint on {base}", round(r, 2)))
    r = ratio(P["on-brand"], P["brand-fill"])
    worst = min(worst, r)
    if r < 4.5:
        failed.append((name, "on-brand", "brand-fill", round(r, 2)))
    # 四級灰階墨色（分數環、紀律三環、籌碼結構比例條；非文字圖形）：每級對 bg／surface-1／surface-2 ≥ 3:1（WCAG 1.4.11），
    # 相鄰兩級 ≥ 1.5:1 才在灰階截圖下分得出來
    inks = [P[f"ink-{i}"] for i in (1, 2, 3, 4)]
    for i, ink in enumerate(inks, 1):
        for bk in ("bg", "surface-1", "surface-2"):
            r = ratio(ink, P[bk])
            if r < 3:
                failed.append((name, f"ink-{i}", bk, round(r, 2)))
    for i in range(3):
        r = ratio(inks[i], inks[i + 1])
        if r < 1.5:
            failed.append((name, f"ink-{i + 1}", f"ink-{i + 2}", round(r, 2)))
    ink_worst = min(ratio(ink, P[bk]) for ink in inks for bk in ("bg", "surface-1", "surface-2"))
    print(f"{name}: 最低對比 {worst:.2f}:1；灰階墨色對底色最低 {ink_worst:.2f}:1（門檻 3:1）")
if failed:
    print("低於門檻（文字 4.5:1、灰階墨色 3:1、相鄰墨色 1.5:1）：", failed)
    sys.exit(1)
print("全部 ≥ 4.5:1（WCAG AA）；灰階墨色 ≥ 3:1 且相鄰可分辨")
