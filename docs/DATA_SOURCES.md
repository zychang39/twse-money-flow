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
| twse_intraday_index | 加權指數每 5 秒統計（首頁 1D／1W） | `www.twse.com.tw/rwd/zh/TAIEX/MI_5MINS_INDEX?date=…&response=json`（2026-10 改用 rwd 路徑，舊 `exchangeReport/` 路徑同內容；只存時間與發行量加權股價指數，約 3,241 列／日） | 盤後約 14:00；收盤行情段（14:15）與法人段一起抓，每日任務自動補最近 5 個交易日 | ✅ |
| twse_insti_amount / tpex_insti_amount | 三大法人買賣金額（全市場，元） | `…/rwd/zh/fund/BFI82U?type=day&dayDate=…`、`…/www/zh-tw/insti/summary?type=Daily&date=YYYY/MM/DD`（櫃買休市日回空表） | 約 15:00（法人段） | ✅（2026-10 新增；首頁三大法人改用實際金額） |
| yahoo_twii | 加權指數 1 分 K（Yahoo Finance，**非官方**） | `query1.finance.yahoo.com/v8/finance/chart/%5ETWII?interval=1m&range=5d` | 收盤後 | ✅ 只在每 5 秒統計於已收盤的交易日仍取不到時抓（每日任務內，一次請求涵蓋 5 日） |
| yahoo_kbar | 個股 5 分 K（Yahoo Finance，**非官方**） | `query1.finance.yahoo.com/v8/finance/chart/{代號}.TW?interval=5m&range=5d`（上櫃 `.TWO`） | 收盤後；`task=kbar` 14:45 排程（補抓任務備援） | ✅（2026-10 新增；見下方「個股 5 分 K」） |
| twse_short_halt / tpex_short_halt | 停券預告（融券最後回補日） | `…/rwd/zh/marginTrading/BFI84U?response=json`、`openapi/v1/tpex_margin_trading_term` | 隨時 | ✅ |
| taifex_insti | 三大法人期貨（TXF/MXF/TMF） | POST `www.taifex.com.tw/cht/3/futContractsDateDown`（Big5 CSV） | 約 15:00 | ✅ |
| taifex_oi | 各契約全市場未平倉 | POST `www.taifex.com.tw/cht/3/futDataDown`（Big5 CSV，依到期月份，取「一般」時段加總） | 約 15:00 | ✅ |
| taifex_pc | 臺指選擇權 Put/Call 比（成交量比率、未平倉量比率 %） | POST `www.taifex.com.tw/cht/3/pcRatioDown`（表單 `queryStartDate`／`queryEndDate`，Big5 CSV，每列結尾多一個逗號；欄位 `日期, 賣權成交量, 買權成交量, 買賣權成交量比率%, 賣權未平倉量, 買權未平倉量, 買賣權未平倉量比率%`） | 約 15:00；與其他期交所區間查詢一起以月為單位抓取 | ✅ 本機實測 2026-10-03（樣本 `taifex_pcRatio.csv`）；只作市場溫度頁的走勢資訊，不設門檻、不進燈號（DECISIONS #241） |
| fx_usdtwd | 美元兌台幣 | POST `www.taifex.com.tw/cht/3/dailyFXRateDown`（Big5 CSV） | 每日 | ✅ |
| financials | 季財報（上市＋上櫃） | MOPS `ajax_t163sb04`（綜合損益彙總）、`ajax_t163sb05`（資產負債彙總），GET 帶 `TYPEK=sii/otc&year=民國年&season=季`；一次涵蓋一般業、金融、證券、保險等所有格式 | 法定期限後 | ✅（Actions 實測；OpenAPI t187ap06／07 只有最新一季且依產業分檔，改用 MOPS） |
| active_etf | 主動式 ETF 每日持股 | 各發行投信官網的持股揭露／申購買回清單（PCF），逐家實作（見下方「主動式 ETF 持股」） | 每日（多為當晚或次一營業日） | 🟡 已實作 14 家投信（對應 30／32 檔；國泰、兆豐依 User-Agent 擋本工具，2026-10-09）；實際有持股資料的檔數與投信家數依每日抓取結果（市場頁「涵蓋 N/32 檔」、資料健康頁）；2026-10-03 起同時保存受益權單位數（聯博未揭露）（DECISIONS #22、#242；2026-10-03 新增台新、凱基、聯博、第一金、復華） |

其他：`twse_insider`／`tpex_insider`（內部人轉讓事前申報，OpenAPI t187ap12_L／mopsfin_t187ap12_O）列為選配資料並用於風險旗標。

集保欄位：`資料日期, 證券代號, 持股分級, 人數, 股數, 占集保庫存數比例%`；證券代號右側補空白（如 `2330  `）。分級 1–15 為持股區間，16 為差異數調整，17 為合計。

期交所三大法人欄位：`日期, 商品名稱, 身份別, 多方交易口數, 多方交易契約金額(千元), 空方交易口數, …, 多方未平倉口數, 多方未平倉契約金額(千元), 空方未平倉口數, 空方未平倉契約金額(千元), 多空未平倉口數淨額, 多空未平倉契約金額淨額(千元)`。

期交所選擇權 Put/Call 比（taifex_pc）正規化欄位：`date, put_vol, call_vol, pc_vol_ratio, put_oi, call_oi, pc_oi_ratio`（比率為 %＝賣權 ÷ 買權 × 100；只有 `pc_oi_ratio` 為必要欄位）。

### 個股 5 分 K（yahoo_kbar；2026-10，SPEC §3.2 來源評估）
官方沒有免費的個股歷史分鐘資料（證交所 MIS 只有即時快照）。依序評估（2026-10-03 實測）：
1. **Fugle 行情 API**：需要 API 金鑰；repo 的 workflow 只用 `TELEGRAM_BOT_TOKEN`、`TELEGRAM_CHAT_ID`、`ANTHROPIC_API_KEY`、`GITHUB_TOKEN`，沒有 Fugle 金鑰 → 跳過。
2. **FinMind `TaiwanStockKBar`**：免註冊呼叫回 `{"status":400,"msg":"Your level is free. Please update your user level."}`，分 K 需贊助方案 → 跳過（不使用付費來源）。
3. **Yahoo Finance chart API**（非官方、免金鑰）：`range=5d&interval=5m` 一次回傳最近 5 個交易日；2330 回 271 根（最新一日 55 根含 13:30、其他日 54 根），時區 Asia/Taipei；上櫃用 `.TWO`。→ **採用**，頁尾標示「非官方」。

抓取：`python -m pipeline run --task kbar`（data.yml 14:45 排程、`kbar` concurrency 群組，每段最多 60 分鐘、未完成自動觸發下一段；2026-10-06 起排程沒觸發時由補抓任務觸發）。**涵蓋全部上市＋上櫃個股**（不是只有自選或熱門）：範圍＝近 20 日有收盤的證券，優先順序只決定先後。每檔每日一次請求、間隔 0.5–1.0 秒（1–2 次／秒，含抖動）、失敗依 PoliteClient 重試與斷路器；優先順序：近 20 日平均成交金額前 500 名 → 近 60 日任一策略觸發過（讀已部署網站 `data/signals.json`，取不到就略過這一級）→ 其餘（依成交金額）。範圍＝近 20 日有收盤的證券（＝有個股頁的股票，約 2,360 檔）。續傳：目標日檔案已有的代號視為完成，查無 K 棒的代號記在 manifest `kbar.empty`；進度在 manifest `kbar`（target、total、covered、remaining、failed）。存檔 `raw/yahoo_kbar/{YYYY}/{YYYYMMDD}.csv.gz`（date, code, time, open, high, low, close, volume），只保留最近 10 個交易日。

實測（本機 2026-10-03，21 檔含上櫃 7 檔）：10/02 的 5 分 K 彙總成日線開高低收與證交所／櫃買日線 **21/21 完全一致**；較早 4 天開盤 84/84 一致，但缺 13:30 收盤集合競價那一根（Yahoo 只對最新一日提供），收盤 19/84 一致——每日抓取會保存當天的 13:30，之後每一天都完整。成交量：09:00 與 13:30 兩根（集合競價）Yahoo 回 0 → 存成空值；其餘 K 棒合計約為日成交量的 61–91%（中位數上市 81%、上櫃 85%）。

### 細產業與題材（2026-10 恢復環境光改版 M1.2）
| 來源 | 端點 | 用途 | 狀態 |
|---|---|---|---|
| 櫃買中心「產業價值鏈資訊平台」 | `https://ic.tpex.org.tw/introduce.php?ic={產業鏈代碼}`（47 條產業鏈，靜態 HTML） | 細產業＝「產業鏈 › 子類別」；上中下游分段 | 2026-10-03 實測可連；快照 `config/sectors/tpex_chain.csv`（7,463 筆／2,432 檔），`python -m pipeline sectors-refresh` 以禮貌爬取（3–5 秒間隔）更新 |
| 公開資訊觀測站「公司基本資料」主要經營業務 | `mopsov.twse.com.tw/mops/web/ajax_t05st03` | 產業價值鏈未涵蓋股票的主要產品 | **資料源待處理**：雲端環境回「因為安全性考量，您所執行的頁面無法呈現」；改以 `config/sectors/fine.yml` 人工對照（62 檔，標示自行整理與日期） |
| 自行整理 | `config/sectors/fine.yml`、`config/sectors/themes.yml` | 手動細產業（IC 載板）、ETF 分類、17 個題材的上中下游成員 | 自行整理・可編輯；不轉載其他網站的說明或評等 |

**分鐘資料實測（2026-10-03，Actions run 158／159）**：yahoo_kbar 10/2 涵蓋 2,335／2,367 檔（另 32 檔當日沒有收盤價＝無成交）；證交所每 5 秒指數回補 9/24、9/29–10/2 共 5 個交易日（9/25–9/28 休市）。抽 10 檔（上櫃 5347、6488、8299、3064、6904；低成交量 3064、6904）比對 1D 開高低收與日線：10／10 完全一致。

## 主動式 ETF 持股（各投信官網；32 檔中 30 檔，2026-10-09）

法規要求投信每日揭露主動式 ETF 的完整持股，但只公告在各投信官網，格式不一；證交所、櫃買「ETF 訊息中心」與 FundClear 都沒有集中的持股明細端點。2026-09-27 再試兩個方向：

**1. 證交所 ETF 專區（e添富，`www.twse.com.tw/zh/ETFortune/…`）**：本環境連不到證交所，改由 Actions 取樣 `ETFortune/index` 與 `ETFortune/etfInfo/00980A`（`tests/fixtures/raw/twse_etfortune_*.html`）。個別 ETF 頁只有基本資料、規模、受益人數、配息、淨值與折溢價、分割預告與績效，**沒有持股或申購買回清單**；而且 e添富使用條款寫明「非依臺灣證券交易所同意之方式……禁止透過包括但不限於自動化裝置、指令碼、自動程式、蜘蛛程式、爬蟲程式或擷取程式等方式下載本網站之軟體或資料」→ 不採用。

**2. 各投信官網的持股揭露／申購買回清單（PCF）**：以行情代號 `00xxxA` 找出 32 檔主動式 ETF（2026-09-24：上市 30、上櫃 2），依名稱判定 16 家發行投信，逐家實測。原則（2026-10-09 起，DECISIONS #436）：以本工具的 User-Agent（含專案網址）請求；網站發給每位訪客的工作階段 cookie、匿名權杖、防偽權杖照一般瀏覽流程使用（不登入、沒有驗證碼）；依 User-Agent 阻擋的網站不偽裝瀏覽器：

| 投信 | 主動式 ETF | 狀態 | 端點／原因 |
|---|---|---|---|
| 野村 | 00980A、00985A、00999A | ✅ 已實作 | POST JSON `www.nomurafunds.com.tw/API/ETFAPI/api/Fund/GetFundAssets`（`FundID`、`SearchDate`）；可查歷史；非交易日回 `StatusCode 5`；持股日＝`FundAsset.NavDate` |
| 群益 | 00982A、00992A、00997A（00415A 待掛牌） | ✅ 已實作 | POST JSON `www.capitalfund.com.tw/CFWeb/api/etf/items` 取內部基金代碼 → `…/etf/buyback`（`fundId`、`date`＝清單適用日，`null`＝最新）；持股日＝`pcf.date2`（比查詢日早 1 個交易日） |
| 元大 | 00990A | ✅ 已實作 | GET `etfapi.yuantaetfs.com/ectranslation/api/bridge?APIType=ETFAPI&AppName=ETF&Device=3&Platform=ETF&FuncId=PCF/Daily&ticker=…[&date=公告日]`；持股日＝`PCF.trandate`（00990A 為全球型，比公告日早 2 個交易日）；海外持股不列入 |
| 富邦 | 00405A | ✅ 已實作 | GET HTML `websys.fsit.com.tw/FubonETF/Trade/Assets.aspx?stkId=…&ddate=YYYY/MM/DD`；非交易日會回傳最近一次的資料，以頁面「資料日期」為準 |
| 國泰 | 00400A | ⛔ 跳過（依 User-Agent 阻擋） | `cwapi.cathaysite.com.tw/api/ETF/GetETFDetailStockList` 前有網站防火牆（Akamai）：以本工具的 User-Agent 請求回 403；只有偽裝成瀏覽器才取得到，不做。解析器已依真實樣本完成並有測試，網站開放後把 `config/sources.yml` 的 `status` 改為 `verified` 即可啟用 |
| 統一 | 00403A、00411A、00981A、00988A | ✅ 已實作（2026-10-09） | GET `www.ezmoney.com.tw/ETF/Transaction/PCF`（`<div id="DataFundList" data-content>` 取代號 → `sFundCode`，同時建立工作階段 cookie）→ POST JSON `…/GetPCF`（`fundCode`、`date`＝公告日民國 `YYY/MM/DD`、`specificDate` true；未來日＋false＝最新）；`asset` 的 `AssetCode`＝`ST` 為股票（`DetailCode`、`DetailName`、`Share`、`NavRate`）；`pcf` 以 `PCFCode` 為鍵：`TranDate`＝持股日（.NET 日期，比公告日早 1 個交易日）、`NAV`＝淨資產、`OUT_UNIT`＝單位數。2026-10-03 記為「導向循環」是因為當時沒有保留網站設定的 cookie。本環境連不到，以 Actions 冒煙測試（`pipeline smoke`）驗證與取樣 |
| 兆豐 | 00996A | ⛔ 跳過（依 User-Agent 阻擋） | `www.megafunds.com.tw/MEGA/etf/trade_pcf.aspx`（ASP.NET WebForms）對本工具回 403（2026-10-09 再測） |
| 安聯 | 00402A、00984A、00993A | ✅ 已實作（2026-10-09） | GET `etf.allianzgi.com.tw/list-trade` 建立 cookie → GET `webapi/api/AntiForgery/GetAntiForgeryToken` 取防偽權杖 → 之後 POST 帶 `X-XSRF-TOKEN`：`Category/GetFundTypeDropdownOptions` 找「主動式」類別、`GetFundDropdownOptions` 取代號 → `FundNo`、`Fund/GetFundTradeInfo`（`Date`＝公告日）；`CNavDt`＝持股日（台股型早 1 個交易日、美股型 00402A 早 2 個）；`DynamicTableData` 標題「股票 (…)」的表為持股；`CAnceTotalIssues`＝單位數、`CAnceTotalAv`＝淨資產 |
| 台新 | 00986A、00987A | ✅ 已實作（2026-10-03） | GET HTML `www.tsit.com.tw/ETF/Home/Pcf/{etf}?FundType=ALL[&DataDate=YYYY-MM-DD]`（`DataDate`＝清單適用日，不帶＝最新）；表頭「代號／名稱／股數／持股權重」，代號為彭博格式（`2330 TT`，海外如 `NVDA US` 不列入）；持股日＝頁面「YYYY/M/D預估發行受益權單位數」的日期（清單製作時的最新淨值日，通常為適用日前 1 個交易日）；查無資料時版面仍在、日期為 `0001/1/1` |
| 凱基 | 00407A | ✅ 已實作（2026-10-03） | POST 表單 `www.kgifund.com.tw/Fund/RedemptionVC`（`fundID`、`queryDate`＝清單適用日 YYYY/MM/DD，空＝最新；網頁以 jQuery `.load` 取得的局部 HTML，中文為 `&#x…;` 實體）；表頭「股票代號／股票名稱／股數／權重(%)」，含「看更多」隱藏列；持股日＝「(YYYY/MM/DD)每受益權單位淨資產價值」的淨值日；基金代碼 `00407A→J024` 無清單端點，寫在 `config` 的 `funds` |
| 聯博 | 00404A | ✅ 已實作（2026-10-03） | GET JSON `webapi.alliancebernstein.com/v2/funds/tw/zh-tw/investor/{ISIN}/holdings[?date=YYYY-MM-DD]`（官網 PCF 頁 React 元件的資料來源；`date`＝持股日）；ISIN＝`TW000`＋代號＋Luhn 檢查碼（`isin_of`，`00404A→TW00000404A5`）；`domesticHoldings` 的 `holdings-section-equity` 為股票（`holdingCode`、`holdingShares`、`holdingPerc`），期貨、選擇權另段；`asOfDate` 為 MM/DD/YYYY |
| 第一金 | 00408A、00994A | ✅ 已實作（2026-10-03） | POST JSON `www.fsitc.com.tw/WebAPI.aspx/Get_hd`（ASP.NET WebMethod；`pStrFundID`、`pStrDate`＝公告日 YYYY/MM/DD，空＝最新）；回應 `{"d": JSON 字串}`，`group 1`＝股票（`A` 代號、`B` 名稱、`C` 權重、`D` 股數）、`4` 現金、`5` 配置摘要；持股日＝`sdate`（比公告日早 1 個交易日：查 10/01 回 09/30）；基金代碼 `183→00408A`、`182→00994A`（`FundDetail.aspx?ID=` 頁的「股票代號」）寫在 `config` 的 `funds` |
| 復華 | 00409A、00991A、00998A | ✅ 已實作（2026-10-03） | GET xlsx `www.fhtrust.com.tw/api/assetsExcel/{基金代碼}/{YYYYMMDD}`（ETF 專區明細頁「申購買回清單」的下載連結；日期＝持股日）；工作表「日期: YYYY/MM/DD」＋「證券代號／證券名稱／股數／金額／權重(%)」，海外持股（`LITE US`）不列入；無資料時回 HTTP 200 的 JSON 文字「查無資料」；以標準函式庫（zipfile＋ElementTree）解析，不引入 openpyxl；基金代碼 `00409A→ETF26`、`00991A→ETF23`、`00998A→ETF24`（`/ETF/index` 基金卡片）寫在 `config` 的 `funds`。明細頁另有 JSON API（`getAssets`，`fundID`＋`qDate`），但網址藏在未取得的共用模組，未採用 |
| 永豐 | 00410A | ✅ 已實作（2026-10-09） | GET HTML `sitc.sinopac.com/SinopacEtfs/Etfs/SinglePcf/{etf}`（2026-10-03 嘗試的 `www.sinopacfunds.com.tw` 連不上）；只有最新一份（網址不吃日期）；「資料日期：YYYY/MM/DD」＝持股日；頁面留有全系列 ETF 的空白表格模板，取資料日期之後第一張有資料的「證券代碼／證券名稱／股數／佔基金淨資產之權重(%)」表；單位數、淨資產取同一段 |
| 摩根 | 00401A、00989A | ✅ 已實作（2026-10-09） | GET xlsx `am.jpmorgan.com/FundsMarketingHandler/excel?type=holding_pcf&cusip={ISIN}&country=tw&role=twetf&locale=zh-TW&date=YYYY-MM-DD`（`date`＝持股日；`locale` 與 `date` 都必填，沒有資料回 404）；第 1 張工作表「基金資產 - 股票 (YYYY-MM-DD)」；單位數與淨資產在 `type=m12_pcf`（現金申購買回清單公告，`date`＝公告日：台股型為持股日的下一個交易日、美股型 00989A 晚 2 日），淨值日＝持股日才採用 |
| 中國信託 | 00406A、00983A、00995A | ✅ 已實作（2026-10-09） | POST `www.ctbcinvestments.com.tw/API/home/AuthToken?token=www.ctbcinvestments.com`（本文 `{}`）取匿名工作階段權杖（網站發給每位訪客）→ `API/etf/ETFList?token=…` 取 `ETF_ID` → `FID` → `API/etf/ETFHoldingWeight?token=…`（`FID`、`StartDate` YYYY/MM/DD，回該日含以前最近一次揭露）；`FundAssets[0].資料日期`＝持股日、`基金在外流通單位數`、`基金淨資產`；`FundAssetsDetail` 的 `Code`＝`STOCK` 為股票（期貨、選擇權、保證金另段）；回應可能是雙層編碼的 JSON 字串 |

實作細節（`pipeline/sources/etf_holdings.py`、`pipeline/tasks_advanced.py::run_etf_holdings`；投信清單與狀態在 `config/sources.yml` 的 `active_etf.issuers`）：

- 欄位：`date`（持股日＝淨值日）、`etf`、`code`、`name`、`shares`（股）、`weight`（%）、`units`（該 ETF 當日已發行／在外流通受益權單位數，每列相同；2026-10-03 起）、`aum`（基金淨資產，元；投信有揭露才有）、`foreign`（海外持股；2026-10-09 起）；存成 `raw/etf_holdings/{YYYY}/{YYYYMM01}.csv.gz`（月檔），同一檔 ETF 同一天整批取代。
- 受益權單位數（SPEC §3.4，2026-10-03 以真實回應逐家確認；每家都以「淨資產 ÷ 單位數 ＝ 每單位淨值」對照，確認與持股同一個淨值日）：

  | 投信 | 股數 | 權重 | 受益權單位數 | 來源欄位 |
  |---|---|---|---|---|
  | 野村 | ✅ | ✅ | ✅ | `Entries.Data.FundAsset.Units`（Aum 20,193,219,739 ÷ 786,230,000 ＝ 25.68） |
  | 群益 | ✅ | ✅ | ✅ | `data.pcf.totUnit`（nav ÷ totUnit ＝ pUnit；對應 `date2` 持股日） |
  | 元大 | ✅ | ✅ | ✅ | `PCF.osunit`（totalav ÷ osunit ＝ nav；`preunit` 是下一日預估，不用） |
  | 富邦 | ✅ | ✅ | ✅ | 頁面「基金在外流通單位數(單位)」（歷史日期查詢也有；2026-09-24 的舊樣本裁切時沒保留此區塊，新增樣本 `etf_fubon_00405A_20261002.html`） |
  | 台新 | ✅ | ✅ | ✅ | 頁面「已發行受益權單位總數」 |
  | 凱基 | ✅ | ✅ | ✅ | 頁面「已發行受益權單位總數」 |
  | 第一金 | ✅ | ✅ | ✅（另一個請求） | `Get_hd` 沒有；同一公告日的 `WebAPI.aspx/Get_BuySellA`（申購買回清單摘要）「已發行受益權單位總數-台幣交易」（`config` 的 `units_url`；樣本 `etf_fsitc_pcf_183.json`）；每個持股日多 1 次請求 |
  | 復華 | ✅ | ✅ | ✅ | xlsx 摘要區「基金在外流通單位數」的下一列 |
  | 聯博 | ✅ | ✅ | ❌ 未揭露 | `holdings` 只有各段資產市值與比例；`/investor/{ISIN}` 基金資訊沒有單位數；試過 `/pcf`、`/overview`、`/prices` 皆 404。加減碼判定改用共同持股股數比的中位數估計單位數變化（METHODOLOGY §8） |
  | 統一 | ✅ | ✅ | ✅ | `GetPCF` 的 `pcf`：`OUT_UNIT`（`NAV` ÷ `OUT_UNIT` ＝ `P_UNIT`） |
  | 中信 | ✅ | ✅ | ✅ | `FundAssets`「基金在外流通單位數」 |
  | 安聯 | ✅ | ✅ | ✅ | `CAnceTotalIssues` |
  | 摩根 | ✅ | ✅ | ✅（另一個請求） | `m12_pcf`「已發行受益權單位總數」 |
  | 永豐 | ✅ | ✅ | ✅ | 頁面「基金在外流通單位數」 |
  | 國泰（跳過） | ✅ | ✅ | ❌ 未揭露 | `GetETFDetailStockList` 只有持股列 |

  改版前存的持股沒有 `units`；有揭露單位數的投信，回補（`backfill --source active_etf`）時把這些持股日視為缺漏重抓，聯博不重抓。
- 本機回補實測（2025-10-01～2026-10-02，每家投信一個行程、間隔 3–5 秒，2026-10-03）：17 檔中 15 檔取得歷史持股（每檔自掛牌日起；台新 00986A 最早只到 2025-12-08，網站保留期間）。
  發現並修正：台新國內型 00987A 的頁面沒有「預估發行受益權單位數」列（只有跨國型 00986A 有），原解析器每次都失敗（184 次），改以「YYYY/M/D每基數實際申購總價金」的日期為持股日（淨值 17.76 對應 10/02 收盤 17.68；樣本 `etf_taishin_00987A.html`）。
  復華 00998A（全球金融股息）持股全為海外證券；2026-10-09 起海外持股也保留（見下）。
  回補時同一檔連續 10 個交易日查無資料就停止往前（`BACKFILL_EMPTY_STOP`，避免掛牌前的無效請求）。
- 台灣掛牌證券（4–6 碼，可帶 1 碼英文；彭博格式 `2330 TT` 去掉 TT）與海外持股都保留，海外持股 `foreign`＝True、代號保留原樣（`NVDA US`、`8411 JP`、摩根美股型為 `NVDA`）；期貨、選擇權、現金不列入。2026-10-09 以前只存台股：有海外持股的 ETF，舊持股日視為缺漏（回補時重抓），ETF 詳細頁也不用這些日子（避免海外持股全被當成新增）。跨檔加碼／減碼、個股頁「主動式 ETF」一列只用台股（`derive/etf.domestic`）。
- 日期定義以「淨值 ÷ 收盤價」對照驗證：各家的持股日欄位都與當日收盤價對應（例：國泰 00400A 淨值 15.53／15.66／15.74 對應 9/22–9/24 收盤 15.49／15.57／15.66）。2026-10-03 新增的五家以回應本身的日期欄位為持股日（聯博 `asOfDate`、第一金 `sdate`、復華「日期」、凱基與台新的淨值日標籤），尚未以收盤價對照（本環境連不到證交所）；凱基與台新同一份 10/05 清單的淨值日都是 10/02，彼此一致。
- 每日任務：最近 3 個交易日缺的持股日各試一次；第一次看到的 ETF 若不到兩天，最多往回 20 個交易日取得第二天（計算加碼／減碼需要）。同一投信出現 HTTP 4xx 或基金清單取不到，本輪就不再請求該投信。回補：`python -m pipeline backfill --source active_etf --start … --end …`。
- 查詢日與持股日：野村、聯博、復華、國泰以持股日查詢（`lag_days` 0）；群益、台新、凱基、第一金以申購買回清單的適用日／公告日查詢（`lag_days` 1，回應裡的日期才是持股日）；元大 00990A 為 2。
- 內部基金代碼：群益、國泰有清單端點（每輪查一次）；凱基、第一金、復華沒有，寫在 `config/sources.yml` 的 `issuers.*.funds`（新 ETF 掛牌時要補）；聯博以 ISIN 識別（由代號算出）。
- 禮節：與其他來源相同（依序、3–5 秒間隔、退避、斷路器）；robots.txt：群益、元大允許全部，富邦允許 `/FubonETF`，野村與元大 API 主機沒有 robots.txt；富邦使用條款未見禁止自動化擷取的條文，其他投信未找到條款頁。
- 實測（2026-09-27，真實網站）：24 次請求、約 160 秒取得 8 檔的 2–3 個持股日（834 列）；樣本在 `tests/fixtures/samples/etf_*`，測試在 `tests/pipeline/test_etf_holdings.py`。
- 實測（2026-10-03，真實網站，本工具 User-Agent、每家 2–8 次請求、不繞過任何機制）：台新 7、凱基 6、聯博 6、第一金 8、復華 8 次（含找端點），各取得 1–2 個持股日並確認歷史查詢與查無資料的回應；樣本 `etf_taishin_*`、`etf_kgi_*`、`etf_ab_*`、`etf_fsitc_*`、`etf_fhtrust_*`。
- 限制：涵蓋 9 家投信、17／32 檔（野村 3、群益 3、元大 1、富邦 1、台新 2、凱基 1、聯博 1、第一金 2、復華 3），跨檔加碼／減碼排行只反映這些投信，市場頁與個股頁都標示「部分涵蓋」。

### 主動式 ETF 策略標籤（config/active_etf.yml；2026-10-09）
- 32 檔各 1～3 個標籤（大型股、動能、成長、高息、量化、品質、權利金、科技、AI、創新、金融、美股、全球）、一句摘要與依據網址，依各投信官網、公開說明書或證交所 ETF 資訊站（ETFortune，`https://www.twse.com.tw/zh/ETFortune/etfInfo/{code}`）的「投資策略」文字歸納；只描述選股方式與範圍，依規則整理、非推薦（DECISIONS #443）。
- 不是抓取的資料：人工整理後存在 config，web 直接讀（`web/src/lib/etfTags.ts`），pipeline 不處理；vitest `etfTags.test.ts` 檢查詞彙、字數與來源格式。新掛牌的 ETF 要補一筆，否則清單不顯示標籤。
- 無法連線的官網（國泰、兆豐、統一、野村、中信、台新）改以證交所 ETF 資訊站或公開說明書轉載頁為依據（`source_kind` 標明）。

### 集保個股歷史（tdcc_history）
- 開放資料 1-5 只有最新一週；集保官網「股權分散表查詢」可逐檔查過去一年（無驗證碼）。頁面上也註明多檔需求請用開放資料，因此**只對關注清單回補一次**，之後每週的新資料一律由開放資料取得，不排入排程。
- 流程：GET 查詢頁取得 `SYNCHRONIZER_TOKEN` 與可查詢的週別（`scaDate` 選單，新到舊）→ 逐檔逐週 POST（`method=submit&firDate={最新週}&scaDate={週}&sqlMethod=StockNo&stockNo={代號}`，附 Referer／Origin），每次回應會帶下一次用的新 token；token 失效時重新 GET。
- 解析（`advanced.parse_tdcc_stock`）：`資料日期：114年09月26日`＋表格「序、持股/單位數分級、人數、股數/單位數、占集保庫存數比例 (%)」；分級 1–15 與開放資料相同，「合計」存成分級 17（開放資料的 16 為差異數調整，這裡沒有）。查無資料的代號只查一次就停止。
- 關注清單：`config/ui.yml` → `holders.history`（指定代號＋範例自選＋最近交易日成交值前 30 名，不含 ETF；最多 60 檔），每次執行最多 1,500 次查詢（3–5 秒間隔約 1.5 小時），可中斷續跑（已有的週別與股票略過）。
- 儲存：`raw/tdcc_history/{YYYY}/{YYYYMMDD}.csv.gz`（同一週、同一檔以新資料取代）；衍生時與開放資料合併，同一週以開放資料為準。
- 執行：`python -m pipeline backfill --source tdcc_history`（或 Data workflow：task＝backfill、source＝tdcc_history）。失敗只記錄在資料健康頁，不影響「最新資料」的警示。
- 樣本：`tests/fixtures/samples/tdcc_qryStock_3406.html`（本環境 2026-09-27 抓取，裁切保留表單與結果表格）。

### 全市場集保歷史回補（M0，2026-09-29）
**評估**（每週千張大戶的過去一年，全市場）：

| 方案 | 條款／費用 | 請求量 | 實測 | 結論 |
|---|---|---|---|---|
| 集保官網「股權分散表查詢」（`tdcc_history`） | 無驗證碼、沒有 robots.txt、網站沒有禁止自動化查詢的使用條款（只有隱私權政策）；頁面註明「多檔需求可至開放資料下載現行資料」（開放資料只有最新一週，無法取代歷史）；依禮貌爬取規則（依序、3–5 秒間隔） | 每檔每週 1 次：1,990 檔 × 50 週（最新一週由開放資料取得）≈ 98,000 次 | 2026-09-29 本環境 10 次查詢：每次（含 3–5 秒間隔）平均 **4.6 秒**，回應 0.5–1.5 秒；查詢頁偶有連線重設（自動退避重試成功） | **採用** |
| FinMind `TaiwanStockHoldingSharesPer` | 2026-09-29 實測：免費等級回傳「Your level is free. Please update your user level」；官方文件標示「只限 backer、sponsor 會員使用」（付費） | 每檔 1 次 | — | **不採用**（產品原則 3：不使用付費資料源） |

**做法**（`python -m pipeline holders_backfill`，Data workflow `task=holders_backfill`，`tasks_advanced.run_tdcc_full`）：
- 範圍：近 370 天內出現在上市／上櫃收盤行情的 4 碼普通股（含之後下市者，1,990 檔），ETF、ETN、存託憑證、受益證券不查。
- 順序：**由最舊的週開始**（官方只保存約 51 週，最舊的週最先消失），同一週內依成交值由大到小。
- 可中斷續跑：已有的週別（開放資料）、已補的（週, 代號）、查無資料的（週, 代號）都略過；每 200 筆與換週時存檔。
- 分段：每段最多 40 分鐘，未完成就自動觸發下一段；交易日 13:30–22:30 不開始新的一段（記在 `holders_backfill_pending`，22:40 resume 接續）；resume 也會在「還有剩餘但超過 3 小時沒有新的一段」時重新觸發（接續失敗的自我修復）。
- 獨立 concurrency group `holders-backfill`（和籌碼回補 `data-backfill`、每日任務 `data-pipeline` 互不排隊）；寫入 data 分支時沿用 rebase＋manifest 合併（`holders_backfill` 進度取較新的一段、查無資料取聯集）。
- 進度寫在 manifest `holders_backfill`：`total`、`done`、`remaining`、`per_query_sec`、`runtime_hours_left`、`eta`、`segments`。
- **預估總時程**：約 98,000 次 × 4.6 秒 ≈ 125 小時實際執行；扣掉交易日 13:30–22:30 的暫停（每週可用 123／168 小時）與分段銜接損耗（×0.9）≈ **190 小時，約 8 天**（2026-09-30 開始，預估 10/8 前後完成）。
- 資料補齊前，用到千張大戶的計算標示「樣本範圍受限」；「受限」依實際涵蓋率判斷（任一欄位的股票數 < 同期有價格股票數的 50%），補齊後每日 pipeline 重算時自動移除標示。
- **v3（2026-09-30）改為兩道平行**：`task=holders_backfill, source=lanes=2`（分派者）→ `lane=0/2`、`lane=1/2` 兩道，依 ISO 週序號分道（同一週只由同一道寫入），各自的 concurrency group；延後時待續槽記 `lanes=2`，main 的 22:40 接續一次觸發兩道。manifest `holders_backfill.lane_state` 記各道剩餘量，`runtime_hours_left` 已除以道數。進度（2026-09-30 13:26）：12,972／99,500 次（13%）、21 段、每次 4.39 秒；兩道的預估完成約 10/4（DECISIONS #166）。
- **每週新資料**：data.yml 週六 10:00（`0 2 * * 6`）的 periodic 任務在週六、日抓開放資料 1-5（`run_tdcc`），全市場每週一份持續累積；最近一次成功為 2026-09-24 那週（manifest `sources.tdcc_holders`）。
- **族群大戶週流向**（2026-10-10）：開放資料與個股歷史合併後，部署時算出持股市值 ≥ 5,000 萬的大戶每週淨流向並依族群加總（`sector_flows.json`，METHODOLOGY §4.7.7）；不需要新的資料源，也不增加抓取量。

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

## 上市櫃狀態：下市與變更交易（v3 實驗室 M1，2026-09-30）

| id | 名稱 | 端點 | 內容 | 更新 | 狀態 |
|---|---|---|---|---|---|
| twse_delisted | 上市終止上市公司 | `openapi.twse.com.tw/v1/company/suspendListingCsvAndHtml` | 2001 年起全部（265 筆）：終止日期、公司、代號 | 每日快照（內容變動才存） | ✅ Actions 實測 |
| tpex_delisted | 上櫃終止上櫃公司 | `www.tpex.org.tw/www/zh-tw/company/deListed?date={西元年}&reason={-1 全部｜2 轉上市}&response=json` | 依年份（2015 起），欄位：股票代號、公司名稱、終止上櫃日期（民國 115-09-03）、原因；「轉上市」標為 transfer，不算下市 | 週六、日（periodic，約 24 次請求） | ✅ 本環境實測 |
| twse_cmode | 上市變更交易（全額交割）目前名單 | `openapi.twse.com.tw/v1/exchangeReport/TWT85U` | 代號、名稱、分盤集合競價 | 每日快照 | ✅ |
| tpex_cmode | 上櫃變更交易、管理股票與停止交易 | `www.tpex.org.tw/openapi/v1/tpex_cmode` | 變更交易、分盤、管理股票、停止交易（Ｙ） | 每日快照 | ✅ 本環境實測 |
| twse_fulldelivery | 上市新增之變更交易證券 | `…/rwd/zh/fullDelivery/BFIHBU?startDate=…&endDate=…&response=json` | 只列當天臨時新增（2016、2024 整年查詢皆為空表） | 每日（近 10 天） | ✅（不是歷史） |

- **沒有歷史名單**：兩所都查不到全額交割的逐日歷史（櫃買 `trading/cmode` 與證交所 BFIHBU 都只列當天臨時新增；櫃買每日行情的「管理股票」表格實測 2022-06-01 為空）。目前名單自 2026-09-30 起每日快照累積；更早的期間由 universe 的成交值（≥ 2,000 萬元）與股價（≥ 10 元）門檻排除（DECISIONS #173）。
- 樣本：`tests/fixtures/raw/twse_openapi_suspendListing.json`、`twse_openapi_TWT85U.json`、`twse_rwd_BFIHBU_{2016,2024}.json`（Actions）、`tests/fixtures/samples/tpex_delisted_2024*.json`、`tpex_cmode.json`（本環境）。

## 基準組（v3 實驗室 M2，2026-09-30）

| 基準 | 來源 | 起始日（data 分支） | 還原與更新 |
|---|---|---|---|
| (a) 同日等權 universe | 由上市櫃每日收盤行情計算 | 與行情相同（2016-09-01） | 衍生計算，不另抓 |
| (b) 發行量加權股價報酬指數（含息） | 證交所 MI_INDEX（`twse_quotes` 同一個回應的指數表，`twse_index`，名稱「發行量加權股價報酬指數」） | 2016-09-01（2,448 個交易日） | 報酬指數本身含息；每日 14:15 收盤行情那段更新。取不到時改用加權指數並在報告註明 |
| (c) 0050 元大台灣50 | 證交所 MI_INDEX 個股行情（`twse_quotes`）＋除權息（TWT49U）＋ETF 分割（TWTCAU：2025-06-18 一拆四） | 2016-09-01 | 還原價＝原始價 × 還原因子（含息、分割）；官方除權息資料自 2020-09 起，指標效度評估自 2022 起，期間內的配息都有還原 |
| (d) 00631L 元大台灣50正2 | 同上（TWTCAU：2026-03-31 分割，因子 0.0454） | 2016-09-01 | 同上；每日再平衡的 2 倍槓桿 ETF，長期有波動耗損 |

- 更新方式：都來自既有的每日來源，沒有新增請求。證交所 2016 年的除權息歷史（TWT49U 2016 整年）Actions 實測可取得（`tests/fixtures/raw/twse_rwd_TWT49U_2016.json`），若之後要把評估期間往前延伸，可先回補 2016–2020 的除權息。
- 加權報酬指數只有收盤：事件的 (b) 以「進場前一日收盤 → 出場前一日收盤」近似開盤到開盤；(c)(d) 用 ETF 的還原開盤價，時點與事件相同。

## 法人、信用的舊版面（v3 實驗室 M0-6，2026-09-30 Actions 實測）

| 來源 | 期間 | 版面差異 | 處理 |
|---|---|---|---|
| 上市三大法人 T86 | 2017-12-18 以前 | 欄名「外資買進股數／賣出／買賣超」，沒有外資自營商欄 | 別名對應到 `foreign_*`；`foreign_dealer_*` 為空值（當時沒有這個身分別） |
| 上市三大法人 T86 | 2014-12-01 以前 | 自營商不拆自行買賣／避險（只有自營商買進、賣出、買賣超） | 自行買賣／避險欄為空值；自營商避險急增指標自 2014-12 起才有資料 |
| 上櫃三大法人 dailyTrade | 2018 年以前 | 第一個表格是空的 `{}`，明細在第二個表格；16 欄（外資及陸資不拆外資自營商） | `tpex._parse_insti_old` 依欄名解析 |
| 上市融資融券 MI_MARGN | 2015 | 與現在相同 | — |

- 樣本：`tests/fixtures/raw/twse_rwd_T86_{2014,2015,2017}.json`、`twse_rwd_MI_MARGN_2015.json`（Actions 擷取）、`tests/fixtures/samples/tpex_insti_2015.json`（本環境擷取後裁切）。
- 回補：2026-09-30 觸發 `task=backfill, source=twse_insti,tpex_insti,twse_margin,tpex_margin,twse_disposition,tpex_disposition, start=2015-01-01, end=2023-09-06`（由近到遠、已存在略過、每段 40 分鐘自動接續）。約 2,100 個交易日 × 4 個每日來源 ≈ 8,400 次請求 ≈ 10 小時實際執行（扣暫停時段約 2 天）。

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

## 資料新鮮度與補抓排程（2026-10-06，取代下方分段更新的排程）

**為什麼改**：10/5（一）GitHub 排程大幅延遲與遺漏——14:15 那一次延到 22:38 才觸發，15:30 延到隔天 00:15，21:30 完全沒觸發；而且分段更新每段只抓自己那一段的來源，22:38 跑的「收盤行情段」不會順手抓早已公布的三大法人、融資融券、期貨法人，結果 10/5 只有收盤行情，盤後簡報顯示「三大法人合計 0.0 億」、個股頁法人 10/5 為「—」。
（查證：Actions run 37326335628 的排程字串是 `15 6 * * 1-5`、建立於 14:38 UTC；run 37339413057 是 `30 7 * * 1-5`、建立於 16:15 UTC；10/5 沒有任何 `30 13 * * 1-5` 的 run。當天 manifest `runs` 只有一筆 `stage close`（22:40，5 個請求）。）

**新規則**（`config/schedule.yml` `freshness`；前端 `web/src/lib/freshness.ts`、pipeline `pipeline/freshness.py` 讀同一張表）：

| 資料集 | 預期公布時間（台北，交易日當天，含餘裕） | 判斷來源 |
|---|---|---|
| 收盤行情、指數、分鐘 K（指數 1D） | 15:00 | twse/tpex_quotes、twse/tpex_index、twse_intraday_index |
| 三大法人、法人買賣金額、期貨法人、本益比 | 16:00 | twse/tpex_insti、twse/tpex_insti_amount、taifex_insti、twse/tpex_valuation |
| 外資持股比 | 17:00 | twse/tpex_qfii |
| 融資融券（含融資總計）、借券、當沖 | 22:00 | twse/tpex_margin、twse/tpex_sbl、twse/tpex_daytrade |

- D(X)＝最近一個「預期公布時間已經過了」的交易日；資料日 ≥ D(X) 為最新，否則落後（以交易日計）。
- **補抓**（`task=catchup`）：data.yml 台北 08:05、10:05、12:05、15:15、16:30、22:30（UTC `5 0`、`5 2`、`5 4`、`15 7`、`30 8`、`30 14`，週一至五）。每次只抓 D(X) 與之前 5 個交易日內缺的來源與日子，與是哪一次觸發無關；任何一次觸發都會把該有的補齊。
- **每日任務的其他來源**（2026-10-08）：不在上表的每日來源（主動式 ETF 持股、注意／處置、除權息與減資、ETF 分割、全額交割、公司資料、月營收快照、停券、內部人轉讓、美債殖利率）在每個時段的第一次補抓一起跑（`tasks.task_daily_extras`；時段起點＝08:00 與上表各預期公布時間，`freshness.extras_due`）。10/6 改成只跑補抓後，這些來源停在 10/5，10/8 修正並手動觸發 `task=daily` 補回。
- **接力**（2026-10-07）：每次補抓結束時以 workflow_dispatch 預約下一次＝今天下一個還沒到的預期公布時間＋2 分鐘（15:02／16:02／17:02／22:02），有重試時取較早的（`freshness.plan_next`）。接力在 `data-retry` 群組睡到 `not_before`（單次最多 300 分鐘，更久就先睡到上限再接下一棒）。當天只要有一次排程觸發（08:05／10:05／12:05 是起跑點，15:15／16:30／22:30 是備援），之後的補抓就不再依賴 GitHub 排程。今天的資料集都過了預期時間（22:00 之後）或休市 → 不接力，隔天由排程起跑。
- **同時只留一棒**：接力的執行標題是「Data · 補抓接力 <not_before>」（data.yml `run-name`）；要預約前先查還沒結束的接力，已有不晚於目標的就不再觸發，只有比目標晚的就先取消再觸發（`freshness.relay_decision`）。被取消的那棒不回報失敗。下一棒的時間記在 manifest `freshness.next_run`。
- **重試**：補抓後仍有缺 → 下一棒是 1 小時後（`attempt`+1；若下一個預期公布時間更早就先在那時醒來，仍照算重試次數），最多 3 次。dispatch 事件不會像 schedule 一樣被延遲或丟掉。
- **不靜默失敗**：每次結果寫在 manifest `freshness`（缺哪些資料集與日子、第幾次、下次重試時間）；預期時間已過仍沒有資料記為 pending，3 次重試後仍沒有記為 failed（執行摘要與 data-failure issue）。
- 分鐘 K 還欠（manifest `kbar.target` 不是 D(分鐘 K) 或還有剩餘）→ 補抓順便觸發 `task=kbar`（14:45 的 kbar 排程沒觸發時的備援）。
- 分段更新（`task=stage`）保留給手動觸發；頁面狀態列的三段時間改為 15:15／16:30／22:30。

**10/5 資料補回**：2026-10-06 00:33 手動觸發 `task=stage stage=credit`（全部每日來源，目標日 10/5）；排程 `30 7`（延到 00:15 才觸發）也抓了 10/5 的三大法人。

## 公布時間實測與分段更新（M3.4）

**分段更新**（`config/schedule.yml`、`pipeline/stages.py`；data.yml 以 UTC cron 觸發）：

| 段 | 台北時間 | 抓取 | 完成條件（目標交易日都有檔案） | 之後 |
|---|---|---|---|---|
| 收盤行情 | 14:15 | 上市／上櫃收盤行情、櫃買指數 | twse_quotes、tpex_quotes | 部署：價格與價格類訊號 |
| 法人 | 15:30 | 行情＋三大法人、估值、外資持股 | twse_insti、tpex_insti | 部署：法人、訊號、今日新觸發、策略健康度；推送 Telegram（有設定時） |
| 信用 | 21:30 | 全部每日來源（融資融券、借券、當沖、注意／處置、期交所、主動式 ETF…） | twse_margin、tpex_margin | 部署 |

- 未公布時每 5 分鐘重試，最多 60 分鐘；逾時記為 late（今晚頁狀態列以琥珀色顯示），下一段或下一次執行自動補抓（E-05 的補抓機制）。
- 三段共用 data 分支（`data-pipeline` concurrency group），推送被拒時沿用 rebase＋manifest 合併並重試；回補使用 `data-backfill`、`holders-backfill` 群組，互不排隊。回補在交易日 13:30–22:30 不開始新的一段。
- 今晚頁狀態列：「收盤行情 14:20 完成・法人 等待（約 15:30）・信用 等待（約 21:30）」（`meta.json` 的 `stages`）。

**公布時間實測**（交易日 5 分鐘間隔探測）：
- 正式排程：分段更新的每一次重試都記下每個來源第一次看到目標日資料的時間（manifest `publish_times`，5 分鐘粒度），資料健康頁每個來源顯示「實測公布 中位數（最早–最晚，N 天）」，DATA_SOURCES 的預估時間以此校正。
- 合併前的一次性實測：`python -m pipeline run --task probe`（Data workflow task=probe，只抓取、不寫資料，`publish-probe` 群組）從 13:30 起每 5 分鐘探測 14 個來源（每個來源在預估時間前 30 分鐘才開始、看到就停止），結果寫在 data 分支 manifest `publish_probe`。本分支已於 2026-09-30 觸發一次（交易日），結果見 data 分支 manifest（本文件撰寫時是 2026-09-30 凌晨，當天的實測尚未發生，因此下表仍是官方與過去觀察的預估值）。

| 來源 | 預估公布時間（官方說明與過去觀察） | 分段 |
|---|---|---|
| 上市收盤行情 MI_INDEX | 約 14:00 | 收盤行情 |
| 上櫃收盤行情 dailyQuotes | 約 14:30 | 收盤行情（14:15 若未公布 → 重試） |
| 本益比等（上市、上櫃） | 約 14:30 | 法人 |
| 三大法人（上市 T86、上櫃） | 約 15:00–16:30 | 法人 |
| 外資持股比率 | 約 15:30 | 法人 |
| 融資融券 | 約 21:00 | 信用 |
| 借券賣出餘額 | 約 21:30 | 信用 |
| 當沖 | 當日晚間 | 信用 |

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
