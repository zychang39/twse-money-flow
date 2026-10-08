"""禮貌爬取的 HTTP 客戶端：依序請求、3–5 秒間隔＋抖動、指數退避、斷路器。"""

from __future__ import annotations

import logging
import random
import time
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import urlparse

import requests

from pipeline.core import config

log = logging.getLogger(__name__)

BLOCK_MARKERS = ("FOR SECURITY REASONS", "因為安全性考量", "Request Rejected")
# 被阻擋時的退避秒數（每次 ×2）與同一請求最多再試幾次：WAF 阻擋時密集重試只會延長封鎖
BLOCK_BACKOFF = 30.0
BLOCK_RETRIES = 1


class FetchError(RuntimeError):
    """抓取失敗（重試後仍失敗、被阻擋、HTTP 錯誤）。"""


class BlockedError(FetchError):
    """E-09：被網站安全機制（WAF）阻擋：HTTP 307 轉址到錯誤頁，或回應含「FOR SECURITY REASONS」。

    不是格式變動：以較長的退避重試、計入斷路器；訊息含「阻擋」，資料健康頁顯示為暫時連不上。
    """


class CircuitOpenError(FetchError):
    """同一網域連續失敗達上限，本輪不再請求。"""


def is_blocked(resp: Any, url: str) -> bool:
    """E-09：證交所 WAF 以 307 轉到錯誤頁（或直接回 307），頁面含 FOR SECURITY REASONS。"""
    if getattr(resp, "status_code", 200) == 307:
        return True
    for hop in getattr(resp, "history", None) or []:
        if getattr(hop, "status_code", None) == 307:
            final = urlparse(str(getattr(resp, "url", "") or url))
            asked = urlparse(url)
            if (final.netloc, final.path) != (asked.netloc, asked.path):
                return True
    head = bytes(resp.content[:4096])
    text = head.decode("utf-8", errors="ignore") + head.decode("cp950", errors="ignore")
    return any(m in text for m in BLOCK_MARKERS)


@dataclass
class PoliteClient:
    delay: tuple[float, float] = (3.0, 5.0)
    timeout: float = 60.0
    max_retries: int = 4
    breaker_threshold: int = 5
    user_agent: str = "twse-money-flow/1.0"
    sleep: Any = time.sleep
    session: requests.Session = field(default_factory=requests.Session)
    _last_request: float = 0.0
    _failures: dict[str, int] = field(default_factory=dict)
    request_count: int = 0

    @classmethod
    def from_config(cls) -> PoliteClient:
        c = config.crawl()
        lo, hi = c.get("delay_seconds", [3, 5])
        return cls(
            delay=(float(lo), float(hi)),
            timeout=float(c.get("timeout_seconds", 60)),
            max_retries=int(c.get("max_retries", 4)),
            breaker_threshold=int(c.get("circuit_breaker", 5)),
            user_agent=str(c.get("user_agent", "twse-money-flow/1.0")),
        )

    def _wait_turn(self) -> None:
        if self._last_request:
            gap = random.uniform(*self.delay)
            elapsed = time.monotonic() - self._last_request
            if elapsed < gap:
                self.sleep(gap - elapsed)

    def request(
        self,
        url: str,
        *,
        method: str = "GET",
        data: dict[str, str] | None = None,
        json_body: dict[str, Any] | None = None,
        headers: dict[str, str] | None = None,
    ) -> requests.Response:
        host = urlparse(url).netloc
        if self._failures.get(host, 0) >= self.breaker_threshold:
            raise CircuitOpenError(f"斷路器開啟：{host} 連續失敗 {self._failures[host]} 次")
        last_error: Exception | None = None
        for attempt in range(self.max_retries + 1):
            self._wait_turn()
            try:
                self.request_count += 1
                resp = self.session.request(
                    method,
                    url,
                    data=data,
                    json=json_body,
                    timeout=self.timeout,
                    headers={"User-Agent": self.user_agent, "Accept": "*/*", **(headers or {})},
                    allow_redirects=True,
                )
                self._last_request = time.monotonic()
                if is_blocked(resp, url):
                    raise BlockedError(f"被網站安全機制阻擋（WAF，HTTP 307／FOR SECURITY REASONS）：{url}")
                if resp.status_code == 403:
                    # 2026-10-06：櫃買 10/5 夜間對 Actions runner 回 403（同網址本機 200）→ 視同 WAF 阻擋，退避後重試；
                    # 仍失敗由補抓任務 1 小時後（換一台 runner）再試
                    raise BlockedError(f"被網站拒絕（HTTP 403）：{url}")
                if resp.status_code in (429, 500, 502, 503, 504):
                    raise FetchError(f"HTTP {resp.status_code}：{url}")
                if resp.status_code >= 400:
                    self._failures[host] = self._failures.get(host, 0) + 1
                    raise FetchError(f"HTTP {resp.status_code}：{url}")
                self._failures[host] = 0
                return resp
            except (requests.RequestException, FetchError) as exc:
                self._last_request = time.monotonic()
                last_error = exc
                if isinstance(exc, FetchError) and not isinstance(exc, BlockedError) and "HTTP 4" in str(exc):
                    break
                if isinstance(exc, BlockedError):
                    # 被阻擋：計入斷路器，較長退避後最多再試 BLOCK_RETRIES 次
                    self._failures[host] = self._failures.get(host, 0) + 1
                    if (
                        attempt >= min(self.max_retries, BLOCK_RETRIES)
                        or self._failures[host] >= self.breaker_threshold
                    ):
                        raise
                    wait = BLOCK_BACKOFF * 2**attempt
                    log.warning("被網站安全機制阻擋，%d 秒後重試：%s", wait, url)
                    self.sleep(wait)
                    continue
                if attempt < self.max_retries:
                    backoff = 2 ** (attempt + 1)
                    log.warning("請求失敗（第 %d 次），%d 秒後重試：%s", attempt + 1, backoff, exc)
                    self.sleep(backoff)
        self._failures[host] = self._failures.get(host, 0) + 1
        raise FetchError(str(last_error)) from last_error

    def get_bytes(self, url: str, headers: dict[str, str] | None = None) -> bytes:
        return self.request(url, headers=headers).content

    def post_bytes(self, url: str, data: dict[str, str], headers: dict[str, str] | None = None) -> bytes:
        return self.request(url, method="POST", data=data, headers=headers).content

    def post_json(self, url: str, body: dict[str, Any], headers: dict[str, str] | None = None) -> bytes:
        """POST JSON 本文（部分投信 API 只接受 application/json）；headers 例：安聯的防偽權杖 X-XSRF-TOKEN。"""
        return self.request(url, method="POST", json_body=body, headers=headers).content
