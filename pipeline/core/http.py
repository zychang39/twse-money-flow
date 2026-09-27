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

BLOCK_MARKERS = ("FOR SECURITY REASONS", "因為安全性考量")


class FetchError(RuntimeError):
    """抓取失敗（重試後仍失敗、被阻擋、HTTP 錯誤）。"""


class CircuitOpenError(FetchError):
    """同一網域連續失敗達上限，本輪不再請求。"""


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
                    headers={"User-Agent": self.user_agent, "Accept": "*/*"},
                    allow_redirects=True,
                )
                self._last_request = time.monotonic()
                head = resp.content[:600].decode("utf-8", errors="ignore")
                if any(m in head for m in BLOCK_MARKERS):
                    raise FetchError(f"被網站安全機制阻擋：{url}")
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
                if isinstance(exc, FetchError) and "HTTP 4" in str(exc):
                    break
                if attempt < self.max_retries:
                    backoff = 2 ** (attempt + 1)
                    log.warning("請求失敗（第 %d 次），%d 秒後重試：%s", attempt + 1, backoff, exc)
                    self.sleep(backoff)
        self._failures[host] = self._failures.get(host, 0) + 1
        raise FetchError(str(last_error)) from last_error

    def get_bytes(self, url: str) -> bytes:
        return self.request(url).content

    def post_bytes(self, url: str, data: dict[str, str]) -> bytes:
        return self.request(url, method="POST", data=data).content

    def post_json(self, url: str, body: dict[str, Any]) -> bytes:
        """POST JSON 本文（部分投信 API 只接受 application/json）。"""
        return self.request(url, method="POST", json_body=body).content
