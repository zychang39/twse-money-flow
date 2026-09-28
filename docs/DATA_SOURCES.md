# 資料源（DATA_SOURCES）

所有資料皆為公開、免費、不需登入或驗證碼的官方資料。依「政府資料開放授權條款－第 1 版」使用，App 內每頁標示來源。
程式中的端點設定以 `config/sources.yml` 為準（單一事實來源）；本文件說明欄位、更新時間、限制與實測結果。

## 連線實測（2026-09-26）

| 網域 | 本開發環境（雲端容器） | GitHub Actions（capture-fixtures） |
|---|---|---|
| pypi.org、registry.npmjs.org | ✅ 200 | — |
| openapi.twse.com.tw | ❌ 安全性阻擋頁（預期中） | ✅ 200 |
| www.twse.com.tw（rwd） | ❌ 安全性阻擋頁（CDN 快取偶爾命中） | ✅ 200 |
| mopsov.twse.com.tw | ❌ 307 → 阻擋頁 | ✅ 200 |
| mis.twse.com.tw（盤中） | 未測 | ✅ 200（盤中資訊端點可用） |
| www.tpex.org.tw（www 與 openapi） | ✅ 200 | — |
| opendata.tdcc.com.tw | ✅ 200 | — |
| www.taifex.com.tw、openapi.taifex.com.tw | ✅ 200 | — |
| home.treasury.gov | ✅ 200 | — |
| www.cbc.gov.tw | ✅ 200 | — |
| fred.stlouisfed.org | ❌ HTTP/2 stream error | ❌ 連線失敗（000） → **不加入 FRED** |

驗證狀態說明：✅ 已用真實樣本撰寫 parser 並測試；⚠️ 未以真實樣本驗證；⛔ 資料源待處理。
樣本位置：`tests/fixtures/raw/`（Actions 抓取，交易日 2026-09-24）、`tests/fixtures/samples/`（裁切後的代表性樣本，測試使用）。

## 已知限制（實測確認）
- 證交所 OpenAPI 只提供最新一日，`date` 參數無效。
- `rwd/zh/afterTrading/STOCK_DAY_ALL?date=` **會忽略 date**（2026-08-25 查詢回傳 2026-09-24 資料，且格式為 CSV）→ 歷史收盤改用 `MI_INDEX?type=ALLBUT0999`，同一回應也含加權指數與報酬指數。
- 集保股權分散表只提供最新一週，必須每週自行累積（無歷史回補）。
- 期交所 OpenAPI 只有最新一日；歷史用網站下載（POST，Big5 CSV），約 3 年。
- MOPS 月營收彙總表為 Big5 編碼 HTML。
- 櫃買中心網站已改版：端點統一為 `https://www.tpex.org.tw/www/zh-tw/{action}?…&response=json`，action 由各頁面原始碼的 `action:"…"` 取得（實測列於下表）。
- 櫃買「變更面額」端點在新版網站找不到對應 action（舊網址未轉址）→ 以價格跳空推估補足（見 METHODOLOGY 還原價）。
- MOPS 財報彙總（ajax_t163sb04 損益、t163sb05 資產負債、t163sb06 營益分析）與法說會（ajax_t100sb02_1）以 GET 帶參數即可取得（Actions 實測），用於季財報回補與法說會行事曆。
- 2026-09-25（中秋節）、09-28（教師節）休市；休市日查詢會回傳「很抱歉，沒有符合條件的資料!」。

## 核心資料

| id | 名稱 | 端點 | 更新時間 | 狀態 |
|---|---|---|---|---|
| twse_quotes / twse_index | 上市每日收盤行情＋指數 | `www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX?date=YYYYMMDD&type=ALLBUT0999&response=json` | 約 14:00 | ✅ |
| twse_insti | 上市三大法人 | `…/rwd/zh/fund/T86?date=…&selectType=ALLBUT0999&response=json` | 約 15:00–16:30 | ✅ |
| twse_margin | 上市融資融券 | `…/rwd/zh/marginTrading/MI_MARGN?date=…&selectType=ALL&response=json` | 約 21:00 | ✅ |
| twse_valuation | 上市本益比／殖利率／淨值比 | `…/rwd/zh/afterTrading/BWIBBU_d?date=…&selectType=ALL&response=json` | 約 14:30 | ✅ |
| twse_exright | 上市除權息結果 | `…/rwd/zh/exRight/TWT49U?startDate=…&endDate=…&response=json` | 除權息日 | ✅ |
| twse_exright_notice | 上市除權息預告 | `…/rwd/zh/exRight/TWT48U?response=json` | 隨時 | ✅ |
| twse_capreduce | 上市減資恢復買賣 | `…/rwd/zh/reducation/TWTAUU?startDate=…&endDate=…&response=json` | 事件 | ✅ |
| twse_parchange | 上市變更面額恢復買賣參考價 | `…/rwd/zh/change/TWTB8U?startDate=…&endDate=…&response=json` | 事件 | ✅ |
| twse_etfsplit | 上市 ETF 分割／反分割 | `…/rwd/zh/split/TWTCAU?startDate=…&endDate=…&response=json`（含 0050 於 2025-06-18 一拆四） | 事件 | ✅ |
| twse_attention | 上市注意股 | `…/rwd/zh/announcement/notice?querytype=1&startDate=…&endDate=…&response=json` | 約 17:00 | ✅ |
| twse_disposition | 上市處置股 | `…/rwd/zh/announcement/punish?startDate=…&endDate=…&response=json` | 約 17:00 | ✅ |
| twse_attention_accum | 注意累計可能達處置 | `openapi.twse.com.tw/v1/announcement/notetrans` | 每日 | ✅ |
| twse_revenue | 上市月營收（最新） | `openapi.twse.com.tw/v1/opendata/t187ap05_L` | 每月 10 日前陸續 | ✅ |
| twse_company | 上市基本資料（產業、股本） | `openapi.twse.com.tw/v1/opendata/t187ap03_L` | 每日 | ✅ |
| twse_holidays | 休市日曆 | `…/rwd/zh/holidaySchedule/holidaySchedule?date=YYYY0101&response=json` | 年度 | ✅ |
| twse_return_index | 加權報酬指數（月） | `…/rwd/zh/TAIEX/MFI94U?date=…&response=json` | 每日 | ⚠️ 端點實測可用但未實作（報酬指數改由 MI_INDEX 取得，程式沒有使用這個來源） |
| twse_market_volume | 大盤成交資訊（月） | `…/rwd/zh/afterTrading/FMTQIK?date=…&response=json` | 每日 | ⚠️ 端點實測可用但未實作（程式沒有使用這個來源） |
| tpex_quotes | 上櫃收盤行情 | `www.tpex.org.tw/www/zh-tw/afterTrading/dailyQuotes?date=YYYY/MM/DD&id=&response=json` | 約 14:30 | ✅ |
| tpex_index | 櫃買指數（月） | `…/indexInfo/inx?date=YYYY/MM/DD&response=json` | 每日 | ✅ |
| tpex_insti | 上櫃三大法人 | `…/insti/dailyTrade?type=Daily&sect=EW&date=…&id=&response=json` | 約 15:00–16:30 | ✅ |
| tpex_margin | 上櫃融資融券 | `…/margin/balance?date=…&id=&response=json` | 約 21:00 | ✅ |
| tpex_valuation | 上櫃本益比等 | `…/afterTrading/peQryDate?date=…&id=&response=json`（**格式隨年份不同**：2025 年起有 8 欄含「財報年/季」；2024 年（含）以前只有 7 欄 `股票代號,公司名稱,本益比,每股股利,股利年度,殖利率(%),股價淨值比`，2026-09-27 實測 2023-10-02、2024-01-02 為舊格式、2025-06-02 起為新格式；「財報年/季」改為選用欄位，兩種格式都可解析，舊格式記錄「格式變動警告」） | 約 14:30 | ✅ |
| tpex_exright | 上櫃除權息結果 | `…/bulletin/exDailyQ?startDate=…&endDate=…&response=json` | 除權息日 | ✅ |
| tpex_exright_notice | 上櫃除權息預告 | `www.tpex.org.tw/openapi/v1/tpex_exright_prepost` | 隨時 | ✅ |
| tpex_capreduce | 上櫃減資恢復買賣 | `…/bulletin/revivt?startDate=…&endDate=…&response=json` | 事件 | ✅ |
| tpex_etfsplit / tpex_etfrevsplit | 上櫃 ETF 分割／反分割 | `…/bulletin/etfSplitRslt`、`…/bulletin/etfRvsRslt`（2020 年至今實測 0 筆） | 事件 | ✅ |
| tpex_attention | 上櫃注意股 | `…/bulletin/attention?startDate=…&endDate=…&response=json` | 約 17:00 | ✅ |
| tpex_disposition | 上櫃處置股 | `…/bulletin/disposal?startDate=…&endDate=…&response=json` | 約 17:00 | ✅ |
| tpex_attention_accum | 上櫃注意累計可能達處置 | `…/bulletin/warning?response=json`（實測 date 參數無效，只有最新） | 每日 | ✅ |
| tpex_revenue | 上櫃月營收（最新） | `www.tpex.org.tw/openapi/v1/mopsfin_t187ap05_O` | 每月 10 日前陸續 | ✅ |
| tpex_company | 上櫃基本資料 | `www.tpex.org.tw/openapi/v1/mopsfin_t187ap03_O` | 每日 | ✅ |
| mops_revenue | 月營收歷史（上市／上櫃） | `mopsov.twse.com.tw/nas/t21/{sii|otc}/t21sc03_{民國年}_{月}_0.html`（Big5） | 每月 | ✅ |

### 標準化欄位（正規化後 CSV）
共通規則：日期一律西元 `YYYY-MM-DD`；數值去除千分位、`--`／`---`／`N/A`／`-`／空白轉為空值；證券代號去除空白；名稱去除尾端空白。

- **quotes**：`date, code, name, open, high, low, close, volume`（股）`, value`（元）`, trades, change`（元，含正負號）
  - 上市 `MI_INDEX` 表「每日收盤行情」：漲跌以 HTML `<p style= color:red>+</p>` 表示正負，須與「漲跌價差」合併；`X` 表示不比價（除權息、新上市），此時 change 為空值。
  - 上櫃 `dailyQuotes` 含權證、債券等 1 萬餘筆 → 只保留 4–6 碼股票與 ETF（代號以數字開頭且長度 ≤ 6，排除權證 7 碼以上）。上櫃另有 `avg`（均價）欄。
- **insti**（單位：股）：`foreign_buy, foreign_sell, foreign_net`（外陸資不含外資自營商）`, foreign_dealer_net, trust_buy, trust_sell, trust_net, dealer_net`（自營商合計）`, dealer_self_net, dealer_hedge_net, total_net`
  - 上櫃 24 欄順序：外資(不含自營) 買/賣/超、外資自營 買/賣/超、外資合計 買/賣/超、投信 買/賣/超、自營(自行) 買/賣/超、自營(避險) 買/賣/超、自營合計 買/賣/超、三大法人合計。
  - **買進／賣出股數（2026-09-27 起保存）**：另存 `foreign_dealer_buy, foreign_dealer_sell, dealer_self_buy, dealer_self_sell, dealer_hedge_buy, dealer_hedge_sell`（選用欄位；官方一直都有提供，但較早的檔案只存了買賣超）。舊檔可用 `python -m pipeline backfill --source twse_insti,tpex_insti --start … --end … --refresh true`（或 Data workflow 的 `refresh` 選項）重抓補齊；驗證失敗時仍保留原檔。法人買賣超報表的外資、投信買賣張數舊檔就有，自營商與三大法人的買賣張數要回補後才完整。
- **margin**（單位：張）：`margin_buy, margin_sell, margin_redeem, margin_prev, margin_balance, margin_limit, short_sell, short_buy, short_redeem, short_prev, short_balance, short_limit, offset, note`
  - 上市「融資融券彙總」表 16 欄；上櫃 20 欄（另有資使用率、券使用率、資屬證金等）。
- **valuation**：`pe, pb, dividend_yield, dividend_year, fin_period`（本益比 `-` 代表虧損 → 空值）
- **exright**：`date`（除權息日）`, code, name, pre_close, ref_price, rights_dividend`（權值＋息值）`, cash_dividend`（上櫃有；上市「息」事件＝權值＋息值）`, kind`（權／息／權息）`, factor = ref_price ÷ pre_close`
- **capreduce**：`date`（恢復買賣日）`, code, name, pre_close, ref_price, reason, factor = ref_price ÷ pre_close`
- **attention**：`date, code, name, count, reason`；**disposition**：`announce_date, code, name, count, start, end, reason, measure, interval_minutes`
- **revenue**：`ym, code, name, market, industry, revenue`（千元）`, revenue_prev_month, revenue_last_year, mom, yoy, cum_revenue, cum_last_year, cum_yoy, note, report_date`

## 進階資料

| id | 名稱 | 端點 | 更新 | 狀態 |
|---|---|---|---|---|
| tdcc_holders | 集保股權分散表 | `opendata.tdcc.com.tw/getOD.ashx?id=1-5`（CSV，約 2.3MB，6.9 萬列） | 每週最後營業日資料，次日公布 | ✅ |
| tdcc_history | 集保股權分散表（個股歷史） | POST `www.tdcc.com.tw/portal/zh/smWeb/qryStock`（HTML；表單 token＋`scaDate`＋`stockNo`） | 官方保存約一年（51 週）；只在回補時執行 | ✅ 本機實測（2026-09-27） |
| twse_sbl / tpex_sbl | 融券＋借券賣出餘額 | `…/rwd/zh/marginTrading/TWT93U?date=…`、`…/www/zh-tw/margin/sbl?date=…` | 約 21:30 | ✅ |
| twse_qfii / tpex_qfii | 外資持股比率 | `…/rwd/zh/fund/MI_QFIIS?date=…&selectType=ALLBUT0999`、`…/insti/qfii?date=…` | 約 15:30 | ✅ |
| twse_daytrade / tpex_daytrade | 當沖交易 | `…/rwd/zh/dayTrading/TWTB4U?date=…&selectType=All`、`…/intraday/stat?date=…&type=Daily` | 當日晚間（T+2 前可能修正） | ✅ |
| twse_short_halt / tpex_short_halt | 停券預告（融券最後回補日） | `…/rwd/zh/marginTrading/BFI84U?response=json`、`openapi/v1/tpex_margin_trading_term` | 隨時 | ✅ |
| taifex_insti | 三大法人期貨（TXF/MXF/TMF） | POST `www.taifex.com.tw/cht/3/futContractsDateDown`（Big5 CSV） | 約 15:00 | ✅ |
| taifex_oi | 各契約全市場未平倉 | POST `www.taifex.com.tw/cht/3/futDataDown`（Big5 CSV，依到期月份，取「一般」時段加總） | 約 15:00 | ✅ |
| fx_usdtwd | 美元兌台幣 | POST `www.taifex.com.tw/cht/3/dailyFXRateDown`（Big5 CSV） | 每日 | ✅ |
| financials | 季財報（上市＋上櫃） | MOPS `ajax_t163sb04`（綜合損益彙總）、`ajax_t163sb05`（資產負債彙總），GET 帶 `TYPEK=sii/otc&year=民國年&season=季`；一次涵蓋一般業、金融、證券、保險等所有格式 | 法定期限後 | ✅（Actions 實測；OpenAPI t187ap06／07 只有最新一季且依產業分檔，改用 MOPS） |
| active_etf | 主動式 ETF 每日持股 | 各發行投信官網的持股揭露／申購買回清單（PCF），逐家實作（見下方「主動式 ETF 持股」） | 每日（多為當晚或次一營業日） | 🟡 部分涵蓋：4 家投信、8／32 檔（DECISIONS #22） |

其他：`twse_insider`／`tpex_insider`（內部人轉讓事前申報，OpenAPI t187ap12_L／mopsfin_t187ap12_O）列為選配資料並用於風險旗標。

集保欄位：`資料日期, 證券代號, 持股分級, 人數, 股數, 占集保庫存數比例%`；證券代號右側補空白（如 `2330  `）。分級 1–15 為持股區間，16 為差異數調整，17 為合計。

期交所三大法人欄位：`日期, 商品名稱, 身份別, 多方交易口數, 多方交易契約金額(千元), 空方交易口數, …, 多方未平倉口數, 多方未平倉契約金額(千元), 空方未平倉口數, 空方未平倉契約金額(千元), 多空未平倉口數淨額, 多空未平倉契約金額淨額(千元)`。

## 主動式 ETF 持股（各投信官網，部分涵蓋）

法規要求投信每日揭露主動式 ETF 的完整持股，但只公告在各投信官網，格式不一；證交所、櫃買「ETF 訊息中心」與 FundClear 都沒有集中的持股明細端點。2026-09-27 再試兩個方向：

**1. 證交所 ETF 專區（e添富，`www.twse.com.tw/zh/ETFortune/…`）**：本環境連不到證交所，改由 Actions 取樣 `ETFortune/index` 與 `ETFortune/etfInfo/00980A`（`tests/fixtures/raw/twse_etfortune_*.html`）。個別 ETF 頁只有基本資料、規模、受益人數、配息、淨值與折溢價、分割預告與績效，**沒有持股或申購買回清單**；而且 e添富使用條款寫明「非依臺灣證券交易所同意之方式……禁止透過包括但不限於自動化裝置、指令碼、自動程式、蜘蛛程式、爬蟲程式或擷取程式等方式下載本網站之軟體或資料」→ 不採用。

**2. 各投信官網的持股揭露／申購買回清單（PCF）**：以行情代號 `00xxxA` 找出 32 檔主動式 ETF（2026-09-24：上市 30、上櫃 2），依名稱判定 16 家發行投信，逐家實測（遇到反爬、導向循環或驗證機制就跳過，不嘗試繞過）：

| 投信 | 主動式 ETF | 狀態 | 端點／原因 |
|---|---|---|---|
| 野村 | 00980A、00985A、00999A | ✅ 已實作 | POST JSON `www.nomurafunds.com.tw/API/ETFAPI/api/Fund/GetFundAssets`（`FundID`、`SearchDate`）；可查歷史；非交易日回 `StatusCode 5`；持股日＝`FundAsset.NavDate` |
| 群益 | 00982A、00992A、00997A（00415A 待掛牌） | ✅ 已實作 | POST JSON `www.capitalfund.com.tw/CFWeb/api/etf/items` 取內部基金代碼 → `…/etf/buyback`（`fundId`、`date`＝清單適用日，`null`＝最新）；持股日＝`pcf.date2`（比查詢日早 1 個交易日） |
| 元大 | 00990A | ✅ 已實作 | GET `etfapi.yuantaetfs.com/ectranslation/api/bridge?APIType=ETFAPI&AppName=ETF&Device=3&Platform=ETF&FuncId=PCF/Daily&ticker=…[&date=公告日]`；持股日＝`PCF.trandate`（00990A 為全球型，比公告日早 2 個交易日）；海外持股不列入 |
| 富邦 | 00405A | ✅ 已實作 | GET HTML `websys.fsit.com.tw/FubonETF/Trade/Assets.aspx?stkId=…&ddate=YYYY/MM/DD`；非交易日會回傳最近一次的資料，以頁面「資料日期」為準 |
| 國泰 | 00400A | ⛔ 跳過（反爬） | `cwapi.cathaysite.com.tw/api/ETF/GetETFDetailStockList` 前有網站防火牆（Akamai）：以本工具的 User-Agent（含專案網址）請求回 403 Access Denied；換成瀏覽器 User-Agent 雖可取得，但屬繞過反爬機制，依規則不做。解析器已依真實樣本完成並有測試，網站開放後把 `config/sources.yml` 的 `status` 改為 `verified` 即可啟用 |
| 統一 | 00403A、00411A、00981A、00988A | ⛔ 跳過（導向循環） | `www.ezmoney.com.tw` 302 導向超過 50 次 |
| 兆豐 | 00996A | ⛔ 跳過（拒絕存取） | `www.megafunds.com.tw` 回 403 |
| 安聯 | 00402A、00984A、00993A | ⛔ 跳過（驗證機制） | `etf.allianzgi.com.tw` 的 API 需先取得 AntiForgery 權杖 |
| 永豐 | 00410A | ⏳ 待處理 | `www.sinopacfunds.com.tw` 本環境連線逾時，未取得樣本 |
| 台新 | 00986A、00987A | ⏳ 待處理 | `www.tsit.com.tw`／`www.taishinfunds.com.tw` 本環境連線逾時 |
| 摩根 | 00401A、00989A | ⏳ 待處理 | `am.jpmorgan.com/tw` 回 HTTP 500 |
| 凱基 | 00407A | ⏳ 待處理 | 首頁可連，基金明細頁逾時，未找到持股端點 |
| 聯博 | 00404A | ⏳ 待處理 | 首頁可連（靜態網站），未找到持股端點 |
| 中國信託 | 00406A、00983A、00995A | ⏳ 待處理 | 單頁應用程式，未找到持股端點 |
| 第一金 | 00408A、00994A | ⏳ 待處理 | 首頁可連，未找到主動式 ETF 持股端點 |
| 復華 | 00409A、00991A、00998A | ⏳ 待處理 | 首頁可連，未找到持股端點 |

實作細節（`pipeline/sources/etf_holdings.py`、`pipeline/tasks_advanced.py::run_etf_holdings`；投信清單與狀態在 `config/sources.yml` 的 `active_etf.issuers`）：

- 欄位：`date`（持股日＝淨值日）、`etf`、`code`、`name`、`shares`（股）、`weight`（%）；存成 `raw/etf_holdings/{YYYY}/{YYYYMM01}.csv.gz`（月檔），同一檔 ETF 同一天整批取代。
- 只保留台灣掛牌證券（4–6 碼，可帶 1 碼英文）；期貨、現金、海外持股不列入。
- 日期定義以「淨值 ÷ 收盤價」對照驗證：各家的持股日欄位都與當日收盤價對應（例：國泰 00400A 淨值 15.53／15.66／15.74 對應 9/22–9/24 收盤 15.49／15.57／15.66）。
- 每日任務：最近 3 個交易日缺的持股日各試一次；第一次看到的 ETF 若不到兩天，最多往回 20 個交易日取得第二天（計算加碼／減碼需要）。同一投信出現 HTTP 4xx 或基金清單取不到，本輪就不再請求該投信。回補：`python -m pipeline backfill --source active_etf --start … --end …`。
- 禮節：與其他來源相同（依序、3–5 秒間隔、退避、斷路器）；robots.txt：群益、元大允許全部，富邦允許 `/FubonETF`，野村與元大 API 主機沒有 robots.txt；富邦使用條款未見禁止自動化擷取的條文，其他投信未找到條款頁。
- 實測（2026-09-27，真實網站）：24 次請求、約 160 秒取得 8 檔的 2–3 個持股日（834 列）；樣本在 `tests/fixtures/samples/etf_*`，測試在 `tests/pipeline/test_etf_holdings.py`。
- 限制：只涵蓋 8／32 檔，跨檔加碼／減碼排行只反映這 4 家投信，市場頁與個股頁都標示「部分涵蓋」。

### 集保個股歷史（tdcc_history）
- 開放資料 1-5 只有最新一週；集保官網「股權分散表查詢」可逐檔查過去一年（無驗證碼）。頁面上也註明多檔需求請用開放資料，因此**只對關注清單回補一次**，之後每週的新資料一律由開放資料取得，不排入排程。
- 流程：GET 查詢頁取得 `SYNCHRONIZER_TOKEN` 與可查詢的週別（`scaDate` 選單，新到舊）→ 逐檔逐週 POST（`method=submit&firDate={最新週}&scaDate={週}&sqlMethod=StockNo&stockNo={代號}`，附 Referer／Origin），每次回應會帶下一次用的新 token；token 失效時重新 GET。
- 解析（`advanced.parse_tdcc_stock`）：`資料日期：114年09月26日`＋表格「序、持股/單位數分級、人數、股數/單位數、占集保庫存數比例 (%)」；分級 1–15 與開放資料相同，「合計」存成分級 17（開放資料的 16 為差異數調整，這裡沒有）。查無資料的代號只查一次就停止。
- 關注清單：`config/ui.yml` → `holders.history`（指定代號＋範例自選＋最近交易日成交值前 30 名，不含 ETF；最多 60 檔），每次執行最多 1,500 次查詢（3–5 秒間隔約 1.5 小時），可中斷續跑（已有的週別與股票略過）。
- 儲存：`raw/tdcc_history/{YYYY}/{YYYYMMDD}.csv.gz`（同一週、同一檔以新資料取代）；衍生時與開放資料合併，同一週以開放資料為準。
- 執行：`python -m pipeline backfill --source tdcc_history`（或 Data workflow：task＝backfill、source＝tdcc_history）。失敗只記錄在資料健康頁，不影響「最新資料」的警示。
- 樣本：`tests/fixtures/samples/tdcc_qryStock_3406.html`（本環境 2026-09-27 抓取，裁切保留表單與結果表格）。

### 研究報告與法人分析
- **券商（賣方）研究報告、目標價**：由各券商發布給自己的客戶，多數需要付費或開戶；證交所、櫃買中心、公開資訊觀測站都沒有彙整，也沒有免費的開放資料或 API。新聞網站轉述的目標價屬於媒體著作，擷取或轉載有著作權疑慮。因此**不擷取**，個股頁只提供連結並標示「第三方」：Google 新聞搜尋（目標價、研究報告）、鉅亨網個股頁、Yahoo 股市個股新聞。
- **官方可用的替代**：公開資訊觀測站的法說會一覽表（`investor_conference`，已在排程中）。公告文字常寫明受哪家券商邀請或由誰主辦（例：「受 BofA 邀請參加投資人會議」），個股頁「研究參考」整理成「主辦／邀請券商」，並連到觀測站一覽表下載簡報。
- **八大行庫（公股行庫）買賣超**：**不採用**（v3，DECISIONS #84）。只有付費來源（分點進出資料的免費查詢頁需驗證碼），公開網站轉載付費資料可能違反條款；對波段與長期投資的決策價值有限（主要反映大盤急跌時的護盤行為，且混有一般客戶委託）。個股頁與法人買賣超報表已移除相關分頁、佔位畫面與外部連結。本輪不使用任何付費資料源。

## 選配資料

| id | 名稱 | 端點 | 狀態 |
|---|---|---|---|
| ust_10y | 美國 10 年期公債殖利率 | `home.treasury.gov/.../daily-treasury-rates.csv/{年}/all?type=daily_treasury_yield_curve&field_tdr_date_value={年}&page&_format=csv` | ✅ |
| twse_insider / tpex_insider | 內部人持股轉讓事前申報 | `openapi t187ap12_L`、`mopsfin_t187ap12_O` | ✅ |
| cbc_money | 央行 M1B／M2（日平均，月資料） | `www.cbc.gov.tw/public/data/OpenData/經研處/EF15M01.csv`（data.gov.tw dataset 6024，政府資料開放授權第 1 版） | ✅ 本環境實測（DECISIONS #25） |
| fred_dtwexbgs | FRED 美元指數 | `fred.stlouisfed.org/graph/fredgraph.csv?id=DTWEXBGS` | ⛔ Actions 實測連線失敗，依規則不加入 |
| investor_conference | 法說會日期 | `mopsov.twse.com.tw/mops/web/ajax_t100sb02_1?…&TYPEK={sii\|otc}&year={民國年}&month={MM}`（GET） | ✅ Actions 實測（DECISIONS #26） |
| intraday | 盤中即時報價（盤中到價提醒用，每 15 分鐘一次批次請求） | `mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=tse_2330.tw\|otc_6488.tw&json=1&delay=0` | ✅ Actions 可用（`pipeline/alerts.py`） |

## 歷史長度與資料量（v3 M5）

| 資料 | 回補長度 | 最早可取得（實測 2026-09-28，Actions 擷取 `tests/fixtures/raw/*_2004/2010/2016*`） |
|---|---|---|
| 上市收盤行情 `twse_quotes`（MI_INDEX） | 10 年（backfill 只指定收盤行情且未給起日時的預設） | 2004-02-11（696 筆，欄位與現在相同） |
| 上櫃收盤行情 `tpex_quotes`（dailyQuotes） | 10 年 | 2010-01-04（538 筆，欄位相同）；2007-01-02（交易日）回傳空表，2007–2009 未逐日實測，`earliest` 暫設 2010-01-04 |
| 籌碼、信用、借券、估值等其他來源 | 維持 3 年 | — |

- 休市日曆：證交所 2016 年的 `holidaySchedule` 回傳空清單（舊年度沒有資料），回補時改以「當天沒有上市行情」判斷休市（例：2016-09-28 梅姬颱風停市，上市回傳「沒有符合條件的資料」）。
- 回補方式：`python -m pipeline backfill --source twse_quotes,tpex_quotes`（起日預設 10 年前），或 Data workflow `task=backfill, source=twse_quotes,tpex_quotes`；由近到遠、已存在略過、3–5 秒間隔＋抖動、時間預算用完自動接續。約 2,450 個交易日 × 2 個市場 ≈ 4,900 次請求 ≈ 5.5 小時（兩次接續執行）。
- **實際資料量（2026-09-28 量測，回補前）**：data 分支工作目錄 159 MB（7,331 個 `.csv.gz`）；收盤行情每日約 42 KB（上市）＋約 40 KB（上櫃），目前自 2024-04-11 起 → `raw/twse_quotes` 25 MB、`raw/tpex_quotes` 23 MB。正式站單一個股 JSON（2330，600 個交易日）127 KB，gzip 41 KB。
- **預估（回補 10 年後）**：收盤行情再增加約 2,000 個交易日 × 82 KB ≈ 165 MB → data 分支約 330 MB（< 500 MB）。個股檔以衍生計算視窗 1,100 個交易日為上限：約 230 KB（gzip 約 70 KB）；長歷史檔 `stocks/{code}.hist.json` 約 2,450 筆日期＋收盤＋還原因子 ≈ 70 KB（gzip 約 20 KB），只在選 5Y／10Y／ALL 時載入。回補完成後請以 `du -sh` 與 `stocks/2330*.json` 更新本段實測值。
- **若 data 分支超過 500 MB 的方案**：①把 3 年以前的每日檔依年合併成 `raw/{來源}/archive/{YYYY}.csv.gz`（一年一檔，gzip 對同欄位的長表壓縮率高，預估縮小 30–40%），`DataStore.read_range` 先讀年檔再讀日檔；②data 分支本身是孤兒分支，定期以「單一快照 commit」重建（`git checkout --orphan` → 強制推送），移除歷史 blob，倉庫大小回到工作目錄大小；③最後手段：10 年以前的上櫃行情改成週資料。

## 格式變動的偵測與相容

- **解析策略**（所有來源）：欄位以「主名稱＋別名」對應，只有必要欄位缺少才整批失敗；其他欄位缺少時補空值並在 manifest 的 `sources.{id}.format_warnings` 記錄警告（資料健康頁顯示「相容模式」，技術細節收在「詳細資訊」）。詳見 METHODOLOGY 第 1 節。
- **冒煙測試**：`python -m pipeline smoke --date YYYY-MM-DD [--source a,b] [--strict]` 對每個已登錄來源抓取＋解析一次，檢查必要欄位（鍵＋關鍵數值欄位）是否存在並可解析，輸出 Markdown 表格（正常／相容模式／無資料／格式變動／連線失敗）。`smoke-test.yml` 的 `fields` job 會執行這個指令（`--strict`：有格式變動時 job 失敗）。
- **樣本**：`tests/fixtures/samples/tpex_pe.json`（2026-09-24，新格式）與 `tpex_pe_hist.json`（2024-01-02，舊格式，本環境 2026-09-27 抓取）都有測試。

## 爬取禮節
- 依序請求（不並行），間隔 3–5 秒加隨機抖動；失敗以 2／4／8／16 秒指數退避重試。
- 同一網域連續失敗 5 次觸發斷路器，本輪停止對該網域的請求並記錄於 manifest。
- 休市日以證交所休市日曆判斷（時區 Asia/Taipei）；週末與休市日不請求。
- 嚴禁繞過驗證碼或違反網站使用條款；User-Agent 標示專案網址。

## 評估後不採用

| 資料 | 原因 |
|---|---|
| 分點券商進出 | 證交所買賣日報表、櫃買券商買賣日報表皆需驗證碼；無官方開放資料（DECISIONS #28、#69） |
| 八大行庫買賣超 | **不採用**：只有付費來源、轉載有條款風險、決策價值有限（DECISIONS #84） |
| 券商研究報告、目標價 | 付費或只提供客戶，無官方來源；新聞轉述有著作權疑慮，只提供標示「第三方」的連結（DECISIONS #72） |
| 證交所 e添富（ETF 專區）持股 | 個別 ETF 頁沒有持股或申購買回清單，且使用條款禁止以爬蟲等自動化方式下載（主動式 ETF 持股改由各投信官網取得，見上方） |
| FRED 美元指數 | Actions 與本環境皆連線失敗 |
