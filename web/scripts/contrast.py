"""WCAG AA 對比檢查：直接讀 src/styles/tokens.css 的淺色與深色 tokens，檢查所有文字色 × 背景（含環境光最亮處、漲跌膠囊底色）≥ 4.5:1。

用法：python3 scripts/contrast.py（有任何一組低於 4.5 時以非 0 結束）
"""
import re
import sys
from pathlib import Path

css = (Path(__file__).parent.parent / "src/styles/tokens.css").read_text(encoding="utf-8")


def block(selector_regex):
    m = re.search(selector_regex + r"\s*\{(.*?)\n\}", css, re.S)
    return dict(re.findall(r"--([\w-]+):\s*([^;]+);", m.group(1)))


light = block(r"\n:root")
dark = {**light, **block(r":root\[data-theme='dark'\]")}


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
for name, t in (("light", light), ("dark", dark)):
    P = {k: parse(v) for k, v in t.items() if v.strip().startswith(("#", "rgb"))}
    bgs = {"bg": P["bg"], "surface-1": P["surface-1"], "surface-2": P["surface-2"]}
    for g in ("up", "down", "risk", "neutral"):
        bgs[f"glow-{g}"] = over(P[f"glow-{g}"], P["bg"])
    worst = 99.0
    for fg in ("text-1", "text-2", "up", "down", "risk", "brand"):
        for bk, b in bgs.items():
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
    r = ratio(P["on-brand"], P["brand-fill"])
    worst = min(worst, r)
    if r < 4.5:
        failed.append((name, "on-brand", "brand-fill", round(r, 2)))
    print(f"{name}: 最低對比 {worst:.2f}:1")
if failed:
    print("低於 4.5:1：", failed)
    sys.exit(1)
print("全部 ≥ 4.5:1（WCAG AA）")
