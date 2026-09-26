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
樣本位置：`tests/fixtures/raw/`（Actions 抓取，交易日 2026-09-24）、`tests/fixtures/local/`（本環境抓取並裁切）。

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
| twse_return_index | 加權報酬指數（月） | `…/rwd/zh/TAIEX/MFI94U?date=…&response=json` | 每日 | ✅ |
| twse_market_volume | 大盤成交資訊（月） | `…/rwd/zh/afterTrading/FMTQIK?date=…&response=json` | 每日 | ✅ |
| tpex_quotes | 上櫃收盤行情 | `www.tpex.org.tw/www/zh-tw/afterTrading/dailyQuotes?date=YYYY/MM/DD&id=&response=json` | 約 14:30 | ✅ |
| tpex_index | 櫃買指數（月） | `…/indexInfo/inx?date=YYYY/MM/DD&response=json` | 每日 | ✅ |
| tpex_insti | 上櫃三大法人 | `…/insti/dailyTrade?type=Daily&sect=EW&date=…&id=&response=json` | 約 15:00–16:30 | ✅ |
| tpex_margin | 上櫃融資融券 | `…/margin/balance?date=…&id=&response=json` | 約 21:00 | ✅ |
| tpex_valuation | 上櫃本益比等 | `…/afterTrading/peQryDate?date=…&id=&response=json` | 約 14:30 | ✅ |
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
| twse_sbl / tpex_sbl | 融券＋借券賣出餘額 | `…/rwd/zh/marginTrading/TWT93U?date=…`、`…/www/zh-tw/margin/sbl?date=…` | 約 21:30 | ✅ |
| twse_qfii / tpex_qfii | 外資持股比率 | `…/rwd/zh/fund/MI_QFIIS?date=…&selectType=ALLBUT0999`、`…/insti/qfii?date=…` | 約 15:30 | ✅ |
| twse_daytrade / tpex_daytrade | 當沖交易 | `…/rwd/zh/dayTrading/TWTB4U?date=…&selectType=All`、`…/intraday/stat?date=…&type=Daily` | 當日晚間（T+2 前可能修正） | ✅ |
| twse_short_halt / tpex_short_halt | 停券預告（融券最後回補日） | `…/rwd/zh/marginTrading/BFI84U?response=json`、`openapi/v1/tpex_margin_trading_term` | 隨時 | ✅ |
| taifex_insti | 三大法人期貨（TXF/MXF/TMF） | POST `www.taifex.com.tw/cht/3/futContractsDateDown`（Big5 CSV） | 約 15:00 | ✅ |
| taifex_oi | 各契約全市場未平倉 | POST `www.taifex.com.tw/cht/3/futDataDown`（Big5 CSV，依到期月份，取「一般」時段加總） | 約 15:00 | ✅ |
| fx_usdtwd | 美元兌台幣 | POST `www.taifex.com.tw/cht/3/dailyFXRateDown`（Big5 CSV） | 每日 | ✅ |
| financials | 季財報（上市＋上櫃） | MOPS `ajax_t163sb04`（綜合損益彙總）、`ajax_t163sb05`（資產負債彙總），GET 帶 `TYPEK=sii/otc&year=民國年&season=季`；一次涵蓋一般業、金融、證券、保險等所有格式 | 法定期限後 | ✅（Actions 實測；OpenAPI t187ap06／07 只有最新一季且依產業分檔，改用 MOPS） |
| active_etf | 主動式 ETF 每日持股 | 各投信官網 PCF（無集中端點；證交所 ETF 專區、櫃買 ETF 訊息中心、FundClear 皆無持股明細 API） | 每日 | ⛔ 資料源待處理（DECISIONS #22；清單由行情代號 00xxxA 判定，計算框架已完成） |

其他：`twse_insider`／`tpex_insider`（內部人轉讓事前申報，OpenAPI t187ap12_L／mopsfin_t187ap12_O）列為選配資料並用於風險旗標。

集保欄位：`資料日期, 證券代號, 持股分級, 人數, 股數, 占集保庫存數比例%`；證券代號右側補空白（如 `2330  `）。分級 1–15 為持股區間，16 為差異數調整，17 為合計。

期交所三大法人欄位：`日期, 商品名稱, 身份別, 多方交易口數, 多方交易契約金額(千元), 空方交易口數, …, 多方未平倉口數, 多方未平倉契約金額(千元), 空方未平倉口數, 空方未平倉契約金額(千元), 多空未平倉口數淨額, 多空未平倉契約金額淨額(千元)`。

## 選配資料

| id | 名稱 | 端點 | 狀態 |
|---|---|---|---|
| ust_10y | 美國 10 年期公債殖利率 | `home.treasury.gov/.../daily-treasury-rates.csv/{年}/all?type=daily_treasury_yield_curve&field_tdr_date_value={年}&page&_format=csv` | ✅ |
| twse_insider / tpex_insider | 內部人持股轉讓事前申報 | `openapi t187ap12_L`、`mopsfin_t187ap12_O` | ✅ |
| cbc_money | 央行 M1B／M2（日平均，月資料） | `www.cbc.gov.tw/public/data/OpenData/經研處/EF15M01.csv`（data.gov.tw dataset 6024，政府資料開放授權第 1 版） | ✅ 本環境實測（DECISIONS #25） |
| fred_dtwexbgs | FRED 美元指數 | `fred.stlouisfed.org/graph/fredgraph.csv?id=DTWEXBGS` | ⛔ Actions 實測連線失敗，依規則不加入 |
| investor_conference | 法說會日期 | `mopsov.twse.com.tw/mops/web/ajax_t100sb02_1?…&TYPEK={sii\|otc}&year={民國年}&month={MM}`（GET） | ✅ Actions 實測（DECISIONS #26） |
| intraday | 盤中即時報價（盤中到價提醒用，每 15 分鐘一次批次請求） | `mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=tse_2330.tw\|otc_6488.tw&json=1&delay=0` | ✅ Actions 可用（`pipeline/alerts.py`） |

## 爬取禮節
- 依序請求（不並行），間隔 3–5 秒加隨機抖動；失敗以 2／4／8／16 秒指數退避重試。
- 同一網域連續失敗 5 次觸發斷路器，本輪停止對該網域的請求並記錄於 manifest。
- 休市日以證交所休市日曆判斷（時區 Asia/Taipei）；週末與休市日不請求。
- 嚴禁繞過驗證碼或違反網站使用條款；User-Agent 標示專案網址。

## 評估後不採用

| 資料 | 原因 |
|---|---|
| 分點券商進出 | 證交所買賣日報表、櫃買券商買賣日報表皆需驗證碼；無官方開放資料（DECISIONS #28） |
| 主動式 ETF 持股 | 僅各投信官網揭露、無集中來源（DECISIONS #22，框架已完成） |
| FRED 美元指數 | Actions 與本環境皆連線失敗 |
