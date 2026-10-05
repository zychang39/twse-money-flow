from __future__ import annotations

import subprocess
from datetime import date

import pandas as pd
import pytest
import requests

from pipeline.core.calendar import TradingCalendar, classify_holidays
from pipeline.core.dates import parse_date, parse_ym
from pipeline.core.http import CircuitOpenError, FetchError, PoliteClient
from pipeline.core.normalize import is_common_stock, is_etf, is_security_code, sign_from_html, to_num
from pipeline.core.validate import validate_frame
from pipeline.sources.base import cn_number, match_interval_minutes, split_period


@pytest.mark.parametrize(
    "text,expected",
    [
        ("1150924", date(2026, 9, 24)),
        ("115/09/24", date(2026, 9, 24)),
        ("115年09月24日", date(2026, 9, 24)),
        ("115.08.26", date(2026, 8, 26)),
        ("2026/09/24", date(2026, 9, 24)),
        ("20260924", date(2026, 9, 24)),
        ("2024-01-01", date(2024, 1, 1)),
        ("09/25/2026", date(2026, 9, 25)),
        ("--", None),
        ("", None),
    ],
)
def test_parse_date(text, expected):
    assert parse_date(text) == expected


def test_parse_ym():
    assert parse_ym("11508") == date(2026, 8, 1)
    assert parse_ym("202608") == date(2026, 8, 1)


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("1,234.5", 1234.5),
        ("--", None),
        ("-0.28", -0.28),
        ("N/A", None),
        ("12.3%", 12.3),
        (" ", None),
        ("<p>1,000</p>", 1000.0),
        (5, 5.0),
        ("X", None),
    ],
)
def test_to_num(raw, expected):
    assert to_num(raw) == expected


def test_codes_and_signs():
    assert is_security_code("2330") and is_security_code("00400A") and is_security_code("2881A")
    assert not is_security_code("22211") and not is_security_code("030001") and not is_security_code("020011")
    assert is_common_stock("2330") and not is_common_stock("0050") and is_etf("0050")
    assert sign_from_html("<p style= color:red>+</p>") == 1
    assert sign_from_html("<p style ='color:green'>-</p>") == -1
    assert sign_from_html("X") == 0


def test_cn_numbers_and_intervals():
    assert [cn_number(x) for x in ["二", "五", "十", "二十", "二十五", "60"]] == [2, 5, 10, 20, 25, 60]
    assert match_interval_minutes("以人工管制之撮合終端機執行撮合作業（約每二十分鐘撮合一次）") == 20
    assert match_interval_minutes("約每５分鐘撮合一次") == 5
    assert split_period("115/08/24～115/08/28") == ("2026-08-24", "2026-08-28")


def test_calendar_rules():
    df = pd.DataFrame(
        {
            "date": ["2026-01-01", "2026-01-02", "2026-02-11", "2026-02-12", "2026-09-25"],
            "name": [
                "中華民國開國紀念日",
                "國曆新年開始交易日",
                "農曆春節前最後交易日",
                "市場無交易，僅辦理結算交割作業",
                "中秋節",
            ],
            "description": ["", "", "", "", ""],
        }
    )
    closed = classify_holidays(df)
    assert date(2026, 1, 1) in closed and date(2026, 2, 12) in closed and date(2026, 9, 25) in closed
    assert date(2026, 1, 2) not in closed and date(2026, 2, 11) not in closed
    cal = TradingCalendar.from_frames([df])
    assert cal.previous(date(2026, 9, 28)) == date(2026, 9, 24)
    assert cal.next(date(2026, 9, 24)) == date(2026, 9, 28)  # 本測試日曆未含 9/28
    assert cal.trading_days(date(2026, 9, 21), date(2026, 9, 27)) == [
        date(2026, 9, 21),
        date(2026, 9, 22),
        date(2026, 9, 23),
        date(2026, 9, 24),
    ]


def test_validate_frame():
    df = pd.DataFrame({"code": ["1101", "1101"], "close": ["1", "x"]})
    res = validate_frame(
        df,
        request_date=date(2026, 9, 24),
        response_date=date(2026, 9, 23),
        numeric_cols=["close"],
        prev_rows=10,
        min_rows=1,
    )
    assert not res.ok
    text = res.summary()
    assert "回應日期" in text and "重複" in text and "可解析" in text and "差距" in text


class FakeResponse:
    def __init__(self, status: int, content: bytes = b"{}"):
        self.status_code = status
        self.content = content


class FakeSession:
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = 0

    def request(self, *args, **kwargs):
        self.calls += 1
        item = self.responses.pop(0)
        if isinstance(item, Exception):
            raise item
        return item


def test_http_retry_backoff_and_breaker():
    sleeps: list[float] = []
    session = FakeSession([requests.ConnectionError("x"), FakeResponse(503), FakeResponse(200, b"ok")])
    client = PoliteClient(delay=(0, 0), max_retries=4, sleep=sleeps.append, session=session)  # type: ignore[arg-type]
    assert client.get_bytes("https://example.com/a") == b"ok"
    assert sleeps[:2] == [2, 4]  # 指數退避

    blocked = FakeResponse(200, "因為安全性考量，您所執行的頁面無法呈現".encode())
    session2 = FakeSession([blocked] * 50)
    c2 = PoliteClient(delay=(0, 0), max_retries=0, breaker_threshold=2, sleep=lambda s: None, session=session2)  # type: ignore[arg-type]
    for _ in range(2):
        with pytest.raises(FetchError):
            c2.get_bytes("https://www.twse.com.tw/x")
    with pytest.raises(CircuitOpenError):
        c2.get_bytes("https://www.twse.com.tw/y")


def test_gitdata_commit_and_monthly_squash(tmp_path, monkeypatch):
    from pipeline import gitdata

    def git(*a, cwd):
        subprocess.run(["git", *a], cwd=cwd, check=True, capture_output=True)

    remote = tmp_path / "remote.git"
    git("init", "--bare", "-q", str(remote), cwd=tmp_path)
    work = tmp_path / "work"
    work.mkdir()
    git("init", "-q", "-b", "main", cwd=work)
    git("config", "user.email", "t@t", cwd=work)
    git("config", "user.name", "t", cwd=work)
    (work / "a.txt").write_text("a")
    git("add", ".", cwd=work)
    git("commit", "-qm", "init", cwd=work)
    git("remote", "add", "origin", str(remote), cwd=work)
    git("push", "-q", "origin", "main", cwd=work)
    monkeypatch.chdir(work)
    data = work / "data"
    assert gitdata.prepare(data) == "created"
    (data / "raw").mkdir()
    (data / "raw" / "x.csv").write_text("1")
    assert gitdata.commit_and_push(data, "first", squash_monthly=False).startswith("pushed")
    assert gitdata.commit_and_push(data, "noop") == "no-changes"
    # 模擬新的 Actions 執行：移除 worktree 後重新 prepare，會從遠端 checkout
    git("worktree", "remove", "--force", str(data), cwd=work)
    git("branch", "-D", "data", cwd=work)
    data2 = work / "data2"
    assert gitdata.prepare(data2) == "checked-out"
    assert (data2 / "raw" / "x.csv").read_text() == "1"


class RedirectedResponse(FakeResponse):
    def __init__(self, status: int, content: bytes, url: str, history_status: int):
        super().__init__(status, content)
        self.url = url
        self.history = [FakeResponse(history_status)]


def test_http_waf_307_is_block_not_format_change():
    """E-09：證交所 WAF 以 307 轉到錯誤頁 → BlockedError（訊息含「阻擋」）、較長退避、計入斷路器；不交給解析器誤判成格式變動。"""
    from pipeline.core.http import BLOCK_BACKOFF, BlockedError

    sleeps: list[float] = []
    waf = RedirectedResponse(200, b"<html>error page</html>", "https://www.twse.com.tw/zh/page/error.html", 307)
    ok = FakeResponse(200, b'{"stat":"OK"}')
    session = FakeSession([waf, ok])
    client = PoliteClient(delay=(0, 0), max_retries=4, sleep=sleeps.append, session=session)  # type: ignore[arg-type]
    assert client.get_bytes("https://www.twse.com.tw/rwd/zh/fund/T86?date=20260923") == b'{"stat":"OK"}'
    assert sleeps == [BLOCK_BACKOFF]  # 一次長退避，不是 2、4、8 秒的密集重試

    blocked = FakeResponse(
        200, b"<html><body>" + b" " * 1000 + b"FOR SECURITY REASONS</body></html>"
    )  # 標記在 600 bytes 之後
    session2 = FakeSession([blocked] * 10)
    c2 = PoliteClient(delay=(0, 0), max_retries=4, breaker_threshold=3, sleep=lambda s: None, session=session2)  # type: ignore[arg-type]
    with pytest.raises(BlockedError, match="阻擋"):
        c2.get_bytes("https://www.twse.com.tw/a")
    assert session2.calls == 2  # 最多再試一次
    with pytest.raises(BlockedError):
        c2.get_bytes("https://www.twse.com.tw/b")
    with pytest.raises(CircuitOpenError):
        c2.get_bytes("https://www.twse.com.tw/c")
    # 正常的 307（同一路徑，例如加上查詢參數）不算阻擋
    same = RedirectedResponse(200, b"{}", "https://example.com/a?x=1", 307)
    c3 = PoliteClient(delay=(0, 0), sleep=lambda s: None, session=FakeSession([same]))  # type: ignore[arg-type]
    assert c3.get_bytes("https://example.com/a") == b"{}"


def test_http_403_backs_off_and_retries_like_waf():
    """2026-10-06：櫃買夜間對 Actions runner 回 403（本機同網址 200）→ 視同阻擋：長退避後再試一次，成功就用；不是立刻放棄。"""
    from pipeline.core.http import BLOCK_BACKOFF, BlockedError

    sleeps: list[float] = []
    session = FakeSession([FakeResponse(403, b"Forbidden"), FakeResponse(200, b"{}")])
    client = PoliteClient(delay=(0, 0), max_retries=4, sleep=sleeps.append, session=session)  # type: ignore[arg-type]
    assert client.get_bytes("https://www.tpex.org.tw/www/zh-tw/insti/dailyTrade?date=2026/10/05") == b"{}"
    assert sleeps == [BLOCK_BACKOFF]
    c2 = PoliteClient(
        delay=(0, 0), max_retries=4, sleep=lambda s: None, session=FakeSession([FakeResponse(403, b"")] * 5)
    )  # type: ignore[arg-type]
    with pytest.raises(BlockedError, match="403"):
        c2.get_bytes("https://www.tpex.org.tw/a")
    # 404 仍然不重試
    s3 = FakeSession([FakeResponse(404, b""), FakeResponse(200, b"{}")])
    c3 = PoliteClient(delay=(0, 0), max_retries=4, sleep=lambda s: None, session=s3)  # type: ignore[arg-type]
    with pytest.raises(FetchError):
        c3.get_bytes("https://example.com/x")
    assert s3.calls == 1
