"""櫃買中心「產業價值鏈資訊平台」（ic.tpex.org.tw）：產業鏈 › 上中下游 › 類別 › 子類別 › 公司。

用途：細產業分類（比交易所官方產業更細，例：「印刷電路板 › IC 載板」）與族群頁的上中下游分段。
平台是靜態 HTML（不需登入、沒有驗證碼）；每個產業鏈一頁 `introduce.php?ic=<代碼>`，頁面結構：
- `#main_ic_panel` 內依序是 `chain-title-panel`（上游／中游／下游）與該段的 `ic_link_<類別代碼>` 方塊；
- 每個類別有 `companyList_<類別代碼>`（title＝類別名稱）：沒有子類別時直接是公司表格；
  有子類別時是 `sc_link_<子類別代碼>`（名稱）＋ `sc_company_<子類別代碼>`（公司表格）。
- 公司連結 `company_basic.php?stk_code=<代號>`；外國企業是外部網址（略過）。
頁面後段有一份列印用的重複內容（同樣的 id），只取第一次出現的部分。
"""

from __future__ import annotations

import html as _html
import re
from dataclasses import dataclass

BASE = "https://ic.tpex.org.tw/"
INDEX_URL = BASE + "index.php"
CHAIN_URL = BASE + "introduce.php?ic={ic}"

_CHAIN_LINK = re.compile(r"introduce\.php\?ic=([A-Z0-9]{4})\"?[^>]*>")
_OPTION = re.compile(r"<option value='([A-Z0-9]{4})'[^>]*>([^<]+)</option>")
_STREAM = re.compile(r'<div class="chain-title-panel">\s*([^<]+?)\s*</div>')
_IC_LINK = re.compile(r'id="ic_link_([A-Z0-9]{4})"[^>]*>(.*?)</div>', re.S)
_LIST = re.compile(r'<div id="companyList_([A-Z0-9]{4})" title="([^"]*)"')
_SC_LINK = re.compile(r'<div id="sc_link_([A-Z0-9]{4})"[^>]*>(.*?)</div>', re.S)
_SC_TABLE = re.compile(r'<table id="sc_company_([A-Z0-9]{4})"')
_COMPANY = re.compile(r'company_basic\.php\?stk_code=([0-9A-Z]{4,6})"[^>]*title="([^"]*)"')
_COUNT = re.compile(r"&nbsp;\(\d+家\)|\(\d+家\)")


@dataclass(frozen=True)
class ChainMember:
    chain_id: str
    chain: str
    stream: str  # 上游／中游／下游（平台沒標的為空字串）
    cat_id: str
    cat: str
    sub_id: str  # 沒有子類別時與 cat_id 相同
    sub: str
    code: str
    name: str


def _text(fragment: str) -> str:
    t = re.sub(r"<br\s*/?>", "", fragment)
    t = re.sub(r"<[^>]+>", "", t)
    t = _html.unescape(t).replace("►", "").replace("\xa0", " ")
    t = _COUNT.sub("", t)
    return re.sub(r"\s+", "", t).strip()


def parse_index(page: str) -> dict[str, str]:
    """首頁的產業類別下拉選單：{代碼: 名稱}。"""
    out: dict[str, str] = {}
    for code, name in _OPTION.findall(page):
        out.setdefault(code, _text(name))
    if not out:
        for code in _CHAIN_LINK.findall(page):
            out.setdefault(code, "")
    return out


def parse_chain(page: str, chain_id: str, chain_name: str) -> list[ChainMember]:
    """一個產業鏈頁 → 成員列（同一代號在同一子類別只出現一次）。"""
    panel_start = page.find('id="main_ic_panel"')
    if panel_start < 0:
        return []
    first_list = page.find('<div id="companyList_', panel_start)
    panel = page[panel_start : first_list if first_list > 0 else len(page)]
    # 類別 → 上中下游
    stream_of: dict[str, str] = {}
    cat_label: dict[str, str] = {}
    marks = [(m.start(), _text(m.group(1))) for m in _STREAM.finditer(panel)]
    for m in _IC_LINK.finditer(panel):
        stream = ""
        for pos, name in marks:
            if pos < m.start():
                stream = name
        stream_of.setdefault(m.group(1), stream)
        cat_label.setdefault(m.group(1), _text(m.group(2)))
    # 只取第一份（列印版重複同樣的 id）
    rows: list[ChainMember] = []
    seen_lists: set[str] = set()
    seen: set[tuple[str, str]] = set()
    lists = list(_LIST.finditer(page))
    for i, m in enumerate(lists):
        cat_id, cat = m.group(1), _text(m.group(2)) or cat_label.get(m.group(1), "")
        if cat_id in seen_lists:
            continue
        seen_lists.add(cat_id)
        end = lists[i + 1].start() if i + 1 < len(lists) else len(page)
        block = page[m.start() : end]
        subs = {sid: _text(name) for sid, name in _SC_LINK.findall(block)}
        tables = list(_SC_TABLE.finditer(block))
        stream = stream_of.get(cat_id, "")
        if subs and tables:
            for j, t in enumerate(tables):
                sid = t.group(1)
                seg = block[t.start() : tables[j + 1].start() if j + 1 < len(tables) else len(block)]
                for code, name in _COMPANY.findall(seg):
                    key = (sid, code)
                    if key in seen:
                        continue
                    seen.add(key)
                    rows.append(
                        ChainMember(
                            chain_id, chain_name, stream, cat_id, cat, sid, subs.get(sid, cat), code, _text(name)
                        )
                    )
        else:
            for code, name in _COMPANY.findall(block):
                key = (cat_id, code)
                if key in seen:
                    continue
                seen.add(key)
                rows.append(ChainMember(chain_id, chain_name, stream, cat_id, cat, cat_id, cat, code, _text(name)))
    return rows


CSV_HEADER = "code,name,chain_id,chain,stream,cat_id,cat,sub_id,sub"


def to_csv(rows: list[ChainMember], fetched: str) -> str:
    """快照檔（config/sectors/tpex_chain.csv）：首兩行為來源與抓取日期的註解。"""
    lines = [
        f"# 來源：櫃買中心產業價值鏈資訊平台 {BASE}（政府資料開放授權）；抓取日期 {fetched}",
        "# 由 `python -m pipeline sectors-refresh` 產生；人工調整請寫在 config/sectors/fine.yml，不要改這個檔",
        CSV_HEADER,
    ]
    for r in sorted(rows, key=lambda x: (x.code, x.chain_id, x.sub_id)):
        cells = [r.code, r.name, r.chain_id, r.chain, r.stream, r.cat_id, r.cat, r.sub_id, r.sub]
        lines.append(",".join(c.replace(",", "，") for c in cells))
    return "\n".join(lines) + "\n"


def fetch_all(client: object, cache_dir: str | None = None) -> list[ChainMember]:
    """抓全部產業鏈（禮貌爬取：client 為 PoliteClient；cache_dir 有檔案時直接讀，供重跑與離線測試）。"""
    from pathlib import Path

    def get(url: str, name: str) -> str:
        if cache_dir:
            f = Path(cache_dir) / name
            if f.exists() and f.stat().st_size > 1000:
                return f.read_text(encoding="utf-8", errors="replace")
        body = client.get_bytes(url).decode("utf-8", errors="replace")  # type: ignore[attr-defined]
        if cache_dir:
            Path(cache_dir).mkdir(parents=True, exist_ok=True)
            (Path(cache_dir) / name).write_text(body, encoding="utf-8")
        return body

    first = get(CHAIN_URL.format(ic="D000"), "D000.html")
    names = parse_index(first)
    rows: list[ChainMember] = []
    for ic, name in names.items():
        page = first if ic == "D000" else get(CHAIN_URL.format(ic=ic), f"{ic}.html")
        rows.extend(parse_chain(page, ic, name))
    return rows
