# 決策紀錄（DECISIONS）

依時間順序記錄不確定時自行做出的決定與理由。

## 2026-09-26 開工
1. **Workflow 位置**：`.github/workflows/hello.yml` 推送成功 → 新 workflow 直接放 `.github/workflows/`，已刪除 hello.yml。
2. **連線實測**：本環境連不到證交所（openapi、www、mopsov 皆為安全性阻擋頁，符合預期）；櫃買、集保、期交所、美國財政部、央行可連。證交所樣本一律透過 `capture-fixtures.yml` 由 Actions 抓取。FRED 在本環境與 Actions 都連線失敗 → 依規則不加入 DTWEXBGS。
3. **歷史收盤端點**：實測 `rwd STOCK_DAY_ALL?date=` 忽略日期並回傳 CSV，改用 `MI_INDEX?type=ALLBUT0999`（含所有證券收盤行情，也含加權指數與加權報酬指數），一次請求同時取得行情與指數。
4. **櫃買端點**：櫃買網站改版後以 `/www/zh-tw/{action}` 提供 JSON；action 名稱從各頁面原始碼 `action:"…"` 取得並實測（dailyQuotes、dailyTrade、balance、peQryDate、sbl、qfii、intraday/stat、attention、disposal、warning、exDailyQ、revivt、inx、tradingDate）。
5. **樣本存放**：Actions 抓的原始樣本在 `tests/fixtures/raw/`（由 capture workflow 覆寫，測試不直接依賴其內容變動）；本環境抓的樣本裁切後放 `tests/fixtures/local/`；測試用的代表性片段放 `tests/fixtures/samples/`（保留原始欄位結構，只減少列數），避免 capture workflow 重跑後測試失效。
6. **data 分支結構**：孤兒分支 `data` 根目錄為 `raw/{來源}/{YYYY}/{YYYYMMDD}.csv.gz` 與 `manifest.json`；Actions 將它 checkout 到工作目錄的 `data/`，因此本機路徑為 `data/raw/…`。月資料（月營收）以該月 1 日為檔名；年資料（休市日曆、美債）以 1 月 1 日為檔名；區間查詢的資料（除權息、注意、處置）依事件日期切檔。
7. **Python 3.12 + pandas 3**：衍生計算涉及全市場約 2,000 檔 × 3 年日資料，採 pandas/numpy。版本以 `==` 鎖定。
8. **TypeScript 6.0.3**：typescript-eslint 8.70 的 peer 範圍為 `<6.1.0`，因此不採用 TS 7。
9. **法人成本線**：只納入視窗內淨買超日（Σ淨買超 × 均價 ÷ Σ淨買超），避免淨買賣相抵時分母趨近 0 造成數值爆炸；UI 註明為估算值。
10. **分數映射**：採分段線性、事前設定的透明參數（見 `config/scores.yml`），不做資料最佳化；缺資料的因子不計入並標示。
11. **現金股利**：上市除權息結果只有「權值＋息值」合計。「息」事件直接視為現金股利；「權息」事件若有預告表的現金股利就用預告值，否則以合計值近似並在 UI 標示（多數公司近年僅配息，影響有限）。
12. **月營收生效日**：pipeline 每日抓取最新一期月營收時，記錄每家公司「首次出現」的日期作為公布日；回補的歷史資料取不到公布日，保守假設次月 10 日收盤後生效。
13. **處置預警規則**：官方「注意累計次數可能達處置標準」名單優先；自行累計的門檻採「再一次就達標」的保守設定（連續 2 日、10 日 5 次、30 日 11 次）。
14. **分割／面額變更**：證交所 TWTB8U（面額變更）與 TWTCAU（ETF 分割）實測可用，列為核心事件來源；櫃買新版網站找不到面額變更的 action，改以「價格跳空推估」補足（門檻 ±35%，排除新上市前 5 日），推估事件會列在資料健康頁。
15. **回補順序**：由近到遠、一天抓齊所有每日來源；時間預算用完就停，已存在的檔案跳過，可重複執行續跑。正式環境由 data.yml 以 workflow_dispatch 自動串接下一輪（GITHUB_TOKEN 觸發 workflow_dispatch 會建立新執行）；只有在本輪有進度時才串接，避免永久失敗的日期造成無限循環。
16. **開發期 dev-pipeline.yml**：本環境連不到證交所，暫時以「修改 ci/dev-run.txt 並 push」在 Actions 執行 pipeline（每日任務、回補），藉此用真實資料驗證並預先建立 data 分支。合併前移除。
17. **逐日指標面板**：分數、選股、回測共用同一套逐日面板（dates × codes），T 日的值只用 T 日（含）以前已公布的資料；月營收依公布日（或次月 10 日）展開，避免前視偏差。
18. **合理價所需 EPS／每股淨值**：由「收盤價 ÷ 交易所本益比／淨值比」反推（交易所本益比即採近四季 EPS），可得到逐日歷史，季財報不足時也能計算本益比河流與淨值比法。
