"""讀取 /config 下的 YAML（pipeline 與 web 共用的單一事實來源）。"""

from __future__ import annotations

from functools import cache
from pathlib import Path
from typing import Any

import yaml

ROOT = Path(__file__).resolve().parents[2]
CONFIG_DIR = ROOT / "config"


@cache
def load(name: str) -> dict[str, Any]:
    path = CONFIG_DIR / f"{name}.yml"
    with path.open(encoding="utf-8") as fh:
        data = yaml.safe_load(fh) or {}
    if not isinstance(data, dict):
        raise ValueError(f"{path} 必須是 mapping")
    return data


def sources() -> dict[str, dict[str, Any]]:
    return load("sources")["sources"]


def source(source_id: str) -> dict[str, Any]:
    return sources()[source_id]


def history() -> dict[str, Any]:
    """歷史長度設定（收盤行情 10 年、其他 3 年、衍生計算視窗、各來源最早日期）。"""
    return dict(load("sources").get("history") or {})


def crawl() -> dict[str, Any]:
    return load("sources")["crawl"]


def thresholds() -> dict[str, Any]:
    return load("thresholds")


def scores() -> dict[str, Any]:
    return load("scores")


def ui() -> dict[str, Any]:
    """介面行為參數（config/ui.yml）；pipeline 只用到個股籌碼明細的天數。"""
    return load("ui")


def costs() -> dict[str, Any]:
    return load("costs")


def industries() -> dict[str, str]:
    return {str(k): v for k, v in load("industries")["codes"].items()}
