# 訊號審查、精簡與波段策略（2026-10-01）

> 僅供研究參考，非投資建議。所有改動與理由都在本說明；數字可用第 9 節指令重現。PR：https://github.com/zychang39/twse-money-flow/pull/26
> 資料：data 分支 `35fdaa29`（2026-10-02 02:57，含本次回補的 2015-01 起月營收）；比較基準 main `f7bd5cbc`。

## 1. 結論摘要
- **修了 7 個確定的錯誤**（前視 1、跌停賣不掉 1、成本 3、觸發定義 1、資料 1），每個一個 commit（第 2 節）。
- **有效清單由 10 套 → 1 套**：成本修正（手續費不打折＋滑價、基準不扣成本）後，持有 10 日沒有任何現有訊號的扣成本超額顯著為正，13 套內建策略依精簡規則全部停用（註冊旗標，一行可還原）；唯一上架的是新策略「營收高強勢」。
- **新策略 1 套通過、2 套未通過**（第 4 節）：營收高強勢（月營收創 12 個月新高・RS ≥ 70・乖離 ≤ 10%・持有 40 日）在月營收回補到 2015 後六項門檻全過（最終測試段 +4.54%、全樣本校正後 t 3.24、每月 25 檔）；但 5 檔組合的絕對報酬差（年化 +0.7%、最大回撤 −69%），報告與畫面並列。嘗試 5 次（上限 10），沒有放寬門檻。
- **資料**：月營收由 2023-06 回補到 **2015-01**（MOPS 官方、Actions 執行、17 分鐘），FinMind 276 檔交叉比對 99.9% 一致；集保全市場回補 20%（10/7 完成後自動重算，旗標仍需人工改回）。
- 一個時間相關的 e2e（示範資料過期橫幅）在 main 上同樣失敗；其餘 261 個通過。

## 2. 錯誤修正清單（每項一個 commit；數字為 data 分支 2026-10-01、持有 10 日）

| # | 問題 | 為何確定是錯誤 | 修法 | 修正前 → 後 | commit |
|---|---|---|---|---|---|
| 1 | 評估成本：手續費打 0.6 折、無滑價 | 審查規格 0.1425%×2＋稅 0.3%＋滑價 0.1%×2；來回 0.471% vs 0.783%，少算 0.31 個百分點（成本漏算） | `evidence.yml costs`（折扣 1.0、滑價 0.001）；quintile、exits、組合模擬同步 | 不漲不跌淨報酬 −0.471% → −0.783%；RS 站上 90 淨報酬 +0.72% → +0.40% | ac6083e4 |
| 2 | 同日等權基準也扣成本 → 「扣成本超額」不含成本 | 成本設 0 時 RS 站上 90 超額 +0.630% → +0.633%（不變）；同一組事件主表 +0.68% vs 出場表「相對等權」+0.19%（口徑不一致） | 基準改毛報酬；`benchmark_net_of_costs: true` 還原 | RS 站上 90 +0.63%（t 2.47）→ −0.16%（−0.63）；接近 52 週高點 +0.61%（4.02）→ −0.18%（−1.15）；營收創高 +1.16%（3.99）→ +0.36%（1.26）；有效 11 → 0 | 1a0c565d |
| 3 | 月營收生效日晚於資料最後一天時落在最後一列 | 截斷測試：資料截到 1/9、營收 1/10 生效 → 訊號出現在 1/9（前視） | 生效日 > 最後一天 → 列設為資料之外 | 人造資料訊號 2 → 0；真實資料不變（最新月份 2026-08 已生效） | a85de565 |
| 4 | 集保個股歷史兩個壞資料日期（2022-10-23 週日、2035-02-28） | 集保資料日一定是營業日且不晚於最新行情日 | 載入時過濾（raw 不刪） | 載入列 −32；評估的集保起始 2022-10-23 → 2025-10-09 | f1509e9b |
| 5 | 使用者回測頁（Python＋TS）出場日跌停鎖死仍以開盤價出場；無滑價 | 評估引擎已順延，兩引擎不一致；滑價規格 | 面板加 `high`、鎖死順延、`slippage_pct 0.1`、`limit_down_pct` | 接近 52 週高點 10 日淨報酬 +0.898% → +0.897%（順延 42 筆）→ +0.695%（滑價）；RS 站上 90 +0.720 → +0.705 → +0.503 | a23a2cd3 |
| 6 | 策略頁今日新觸發、訊號追蹤列出持有中再次觸發的事件 | 回測只計首次觸發（去重）；畫面與回測定義不一致 | `engine.first_triggers` | 近一年高點近 250 日 5,435 → 3,414；外資投信買 4,909 → 3,377；今日 12 → 9、26 → 21 | 84168719 |
| 7 | （併入 2）出場規則表與主表的「相對等權」口徑不同 | 同上 | 同上 | — | 1a0c565d |

## 3. 訊號總表（修正前＝main 程式＋2026-10-01 資料；修正後＝本分支＋月營收回補後資料；10 日＝判定持有天數；依有效性排序，其餘依校正後 t）

| 排名 | 策略 | 類別 | 修正前 10 日超額 / t / 上架 | 修正後 10 日超額 / 校正後 t / 每月 | 修正後 40 日超額 | 處置 | 理由 |
|---|---|---|---|---|---|---|---|
| 1 | 營收高強勢 | 基本面 | —（新） | 40 日 2.76% / 3.24 / 25.0 | 2.76%（40 日） | 新增・有效 | 全部門檻通過 |
| — | 大戶週增 | 籌碼 | 5.419% / 3.91 / 未上架 | 4.607% / 2.04 / 84.7 | 18.393% | 停用 | 樣本範圍受限（集保涵蓋率 21%）；校正後 t 2.04、10 日 +4.6% 但樣本外 +0.86% < 樣本內 +6.36% 的 50%；集保回補完成後重評 |
| — | 近高點外資買 | 動能 | —（新） | 20 日 0.812% / 1.7 / 75.8 | 0.812%（20 日） | 新增・未通過 | 未通過：test_beats_best；t_corrected；test_vs_dev；years |
| — | 三方同買 | 組合 | 3.169% / 1.98 / 未上架 | 2.368% / 1.55 / 7.3 | 17.704% | 停用 | 樣本範圍受限（集保涵蓋率 21%）、校正後 t 1.55（< 2）、每月 7.3 檔；集保回補完成後重評 |
| — | 先漲營收升 | 基本面 | 1.505% / 2.72 / 上架 | 0.434% / 1.37 / 35.3 | 2.861% | 停用 | 10 日扣成本超額 +0.43%、校正後 t 1.37（< 2）（月營收回補後重算） |
| — | 營收一年高 | 基本面 | 1.165% / 3.99 / 上架 | 0.204% / 1.35 / 106.7 | 2.026% | 停用 | 10 日扣成本超額 +0.20%、校正後 t 1.35（< 2）（月營收回補 2015 起後重算，訊號期間 2017-03 起）；40 日 +2.03% 仍為正 |
| — | 強勢股外資買 | 動能 | —（新） | 40 日 2.158% / 1.31 / 20.2 | 2.158%（40 日） | 新增・未通過 | 未通過：test_beats_best；t_corrected；test_vs_dev；perturb_positive；years |
| — | 漲多投信買 | 組合 | 0.887% / 5.15 / 上架 | 0.097% / 0.26 / 57.9 | 1.942% | 停用 | 10 日扣成本超額 +0.10%、校正後 t 0.26（< 2） |
| — | 遠離月線 | 動能 | 0.826% / 3.32 / 上架 | 0.036% / -0.21 / 125.9 | 0.762% | 停用 | 10 日扣成本超額 +0.04%、校正後 t −0.21（< 2） |
| — | 漲幅前一成 | 動能 | 0.63% / 2.47 / 上架 | -0.16% / -0.52 / 62.9 | 1.422% | 停用 | 10 日扣成本超額 −0.16%（≤ 0）、校正後 t −0.52（< 2） |
| — | 近一年高點 | 動能 | 0.614% / 4.02 / 上架 | -0.175% / -1.23 / 215.5 | 1.228% | 停用 | 10 日扣成本超額 −0.18%（≤ 0）、校正後 t −1.23（< 2） |
| — | K值高檔 | 動能 | 0.464% / 2.16 / 上架 | -0.325% / -1.81 / 98.0 | 1.372% | 停用 | 10 日扣成本超額 −0.33%（≤ 0）、校正後 t −1.81 |
| — | 年增連三升 | 基本面 | 0.644% / 4.66 / 上架 | -0.213% / -2.58 / 108.7 | 0.325% | 停用 | 10 日扣成本超額 −0.21%（≤ 0）、校正後 t −2.58（月營收回補後重算）；與營收創高相關 0.97（重複） |
| — | 投信連買 | 籌碼 | 0.109% / 0.55 / 未上架 | -0.679% / -2.93 / 18.6 | -0.598% | 停用 | 10 日扣成本超額 −0.68%（≤ 0）、校正後 t −2.93 |
| — | 價漲融資增 | 籌碼 | 0.186% / 2.32 / 上架 | -0.602% / -6.61 / 380.8 | -0.301% | 停用 | 10 日扣成本超額 −0.60%（≤ 0）、校正後 t −6.61 |
| — | 外資投信買 | 籌碼 | 0.324% / 5.81 / 上架 | -0.464% / -6.84 / 274.9 | 0.028% | 停用 | 10 日扣成本超額 −0.46%（≤ 0）、校正後 t −6.84 |

修正前的「10 日超額」是基準也扣成本的舊定義（實際不含成本），不能與修正後直接相減（差額約等於來回成本 0.78 個百分點）。門檻代號：test_beats_best＝測試段 > 現有最佳、t_corrected＝校正後 t > 3、test_vs_dev＝測試段 ≥ 開發段 50%、perturb_positive＝參數 ±20%、years＝逐年七成、per_month＝每月 ≥ 10。

## 4. 新策略

### 營收高強勢（`rev_strong`）——通過，有效
- **假設**（docs/swing/HYPOTHESIS.md H1）：月營收創 12 個月新高是公開、可驗證的基本面事件，公布後的價格反應不會一次到位（法人在公布後數週逐步上修與加碼）；加「RS 百分位 ≥ 70」要求市場已在定價（避免價值陷阱）、「20 日乖離 ≤ 10%」排除公布前已炒高、利多出盡的股票。
- **規則**：訊號日＝月營收生效日（次月 10 日）之前最後一個交易日，條件：當月營收 > 前 12 個月最高（12 個月都有資料）、RS 百分位 ≥ 70、20 日乖離 ≤ 10%、在 universe 內；T+1 開盤進場、持有 40 個交易日後開盤出場（跌停鎖死、停牌順延）；成本手續費 0.1425%×2＋稅 0.3%＋滑價 0.1%×2。參數 3 個：rs_min 70、bias_max 0.10、hold 40。
- **門檻對照**（超額＝相對同日等權、扣成本）：

| 門檻 | 要求 | 實際 | 結果 |
|---|---|---|---|
| 測試段超額 > 修正後現有最佳（同段、同 40 日） | > +4.34%（RS80＋投信連買，906 筆） | **+4.54%**（716 筆） | ✅（只贏 0.2 個百分點） |
| 校正後 t（全樣本） | > 3 | **3.24**（日曆時間法 t 2.92、NW 3.24、區塊 3.52） | ✅（測試段本身 t 2.35） |
| 測試段 ≥ 開發段 50% | ≥ +1.11% | +4.54% | ✅ |
| 參數各 ±20%（開發＋驗證） | 全部 > 0 | rs_min 56／84：+2.18／+2.89；bias 0.08／0.12：+1.28／+2.93；hold 32／48：+1.11／+2.35 | ✅ |
| 逐年 ≥ 70% 為正 | 7/10 | 9/10（2018 −1.3%） | ✅ |
| 每月觸發 ≥ 10 | ≥ 10 | 25.0（測試段 29.8） | ✅ |

- **三段績效並列**（去重事件、相對同日等權、扣成本）：

| 段 | 期間 | 樣本 | 每月 | 平均超額 | t | 校正後 t | 勝率 |
|---|---|---|---|---|---|---|---|
| 開發 60% | 2017-03-07～2022-12-03 | 1,620 | 23.1 | +2.23% | 1.68 | 1.68 | ~50% |
| 驗證 20% | 2022-12-03～2024-11-01 | 561 | 23.4 | +2.55% | 2.64 | 2.64 | — |
| 最終測試 20% | 2024-11-01～2026-10-02 | 716 | 29.8 | +4.54% | 2.35 | 2.35 | — |
| 全樣本 | 2017-03～2026-10 | 2,897 | 25.0 | +2.76% | 2.92 | 3.24 | 50.1% |

- **逐年超額**：2017 +0.2、2018 −1.3、2019 +2.6、2020 +2.3、2021 +7.9、2022 +0.3、2023 +1.9、2024 +2.5、2025 +3.0、2026 +8.4。
- **事件分布**：勝率 50.1%、平均獲利 +22.8%、平均虧損 −12.4%、賺賠比 1.84；連續虧損最長 16 筆（中位數 2、最差 10% 為 5）；最大不利波動中位數 −11.5%、最差 10% −28.2%。
- **5 檔組合**（每月進場日依成交值取前 5、固定 40 日、扣成本，不含環境濾網與停損）：年化 **+0.7%**、年化波動 34.1%、**Sharpe 0.19**、Calmar 0.01、**最大回撤 −68.8%**（回撤 1,890 個交易日）、回撤分布 9 次（中位數 −15.1%、最深 10% −39.5%）、週轉率每槽 62.6 次／年（每年 313 筆）。
  → **超額為正不等於絕對報酬好**：2018 與 2022 空頭整段持有，等權基準同樣大跌。組合層指標是這套策略最弱的一環，策略頁與報告都並列。
- **最可能失效的情境**：所有部位在每月同一天進場（日曆時間法只有約 115 個觀測，統計力低、分散效果差）；大盤在公布後兩週內大跌；營收創高來自一次性認列或併購；2024–2026 的營收創高股集中在 AI 伺服器供應鏈；RS 百分位依賴 universe 的組成（上市櫃普通股）。
- **畫面**：策略庫列表第 1（有效性排名 1、校正後 t 3.24、每月 25 檔）；策略頁多一張「三段績效／上線門檻／參數 ±20%／分布」卡（SwingCard）；今日新觸發與訊號追蹤同其他策略（首次觸發）。

### 未通過的兩套（只列在報告與策略頁「未通過驗證」）
| 策略 | 規則 | 開發 | 驗證 | 最終測試 | 全樣本校正後 t | 每月 | 未通過的門檻 |
|---|---|---|---|---|---|---|---|
| 近高點外資買（`high_flow`） | 收盤首次回到 52 週高點 95%、外資 5 日買超、大盤 240 日線上、20 日均成交值 ≥ 1 億，持有 20 日 | −0.06%（2,442） | +1.58%（614） | +2.17%（1,340，t 1.56） | 1.70 | 75.8 | 測試段未勝過現有最佳（+3.72%）、t、測試 vs 開發、逐年 3/5 |
| 強勢股外資買（`rs_flow`） | RS 百分位首次站上 90、其餘同上，持有 40 日 | −0.05%（649） | +1.22%（249） | +8.25%（275，t 1.67） | 1.31 | 20.2 | 現有最佳 +8.80%、t、測試 vs 開發、擾動（value_min ±20% 為負）、逐年 3/5 |

兩套的 alpha 都集中在 2025 年；濾網（成交值 ≥ 1 億、大盤年線上）在等權基準下反而減少超額（TRIALS #3）。

## 5. TRIALS.md 總嘗試次數
**5 次**（上限 10）：#1 rev_strong（舊資料，失敗）、#2 high_flow 20 日（失敗）、#3 high_flow 40 日（失敗）、#4 rs_flow（失敗）、#5 rev_strong 在月營收回補後重算（通過）。最終測試對三套各算一次（回補前曾算過一次，已揭露）。

## 6. 資料
| 資料 | 來源 | 涵蓋 | 缺口 | 交叉比對 |
|---|---|---|---|---|
| 收盤行情、指數 | 證交所 MI_INDEX、櫃買 dailyQuotes | 2016-09-01～2026-10-01，0 缺檔 | 2016-09 以前未回補 | — |
| 三大法人、融資融券 | T86、櫃買 insti；MI_MARGN、櫃買 margin | 2016-11-17～2026-10-01，0 缺檔 | **2016-09-01～11-16**（待續槽被本次回補取代；指令在 DATA_AUDIT.md） | — |
| 月營收 | **MOPS 彙總表（官方，Actions run #95 回補 2015-01～2023-05，17 分鐘，202 次請求）** | **2015-01～2026-08（140 個月）**，每月 1,521～1,870 家 | 0 | FinMind 276 檔 × 140 個月（34,073 組）：營收相差 > 0.5% 只有 31 組（0.09%，公司事後更正）；年增率 > 1 個百分點 403 組（1.2%）；採用 MOPS |
| 集保股權分散 | 開放資料（每週）＋官網個股歷史（全市場回補） | 2025-10-03～2026-09-18，51 週；全市場回補 **20%**（20,313／99,500 次，ETA 10/7） | 回補中 | 兩檔壞日期已過濾 |
| 除權息、減資、分割 | 兩所公告 | 2020-09 起 | 更早無官方資料（價格類評估自 2022 起的原因） | — |
| 本益比、借券、當沖、外資持股 | 兩所 | 2023-09 起 | 3 年 | — |
可得日：價量、法人、信用＝資料日；月營收＝次月 10 日；集保＝資料日＋1 且只引用上週；季報＝法定期限。詳見 docs/DATA_AUDIT.md。

## 7. 檔案清單

commit 分四類：資料回補（data 分支 `35fdaa29`，由 Actions run #95 寫入；本分支沒有資料檔）、錯誤修正（`ac6083e4`、`1a0c565d`、`a85de565`、`f1509e9b`、`a23a2cd3`、`84168719`）、訊號停用（`b2f45a4d`、停用理由更新）、新策略與 UI（`597c87a6` 審查工具、`38c92c17`、`d15b39b8`、文件與截圖）。

**新增**
- `pipeline/evidence/audit.py`（審查統計）、`pipeline/evidence/selection.py`（精簡清單）、`pipeline/evidence/swing.py`（波段策略）
- `config/swing.yml`、`tests/pipeline/test_swing.py`（截斷測試等 5 個）
- `web/src/components/SwingCard.tsx`、`web/scripts/audit-shots.mjs`
- `docs/AUDIT.md`、`docs/DATA_AUDIT.md`、`docs/swing/HYPOTHESIS.md`、`docs/swing/TRIALS.md`、`docs/audit/signals/`（AUDIT_TABLES.md、audit.json、shots/）

**修改（每一處）**
- `config/evidence.yml`：新增 `costs`（折扣 1.0、滑價 0.001）與 `benchmark_net_of_costs: false`。
- `config/thresholds.yml backtest`：新增 `slippage_pct: 0.1`、`limit_down_pct: -9.5`。
- `config/strategies.yml`：註解說明精簡規則；13 套各加 `enabled: false` 與 `disabled_reason`。
- `pipeline/evidence/engine.py`：`cost_rates()` 回傳 (fee, tax, slip) 並讀 evidence.yml；`net_return` 加滑價；新增 `benchmark_net_of_costs()`；`Market` 多 `slip`、`bench_costs`；`_market_mean` 毛報酬；`evaluate` 傳滑價；新增 `first_triggers`；模組 docstring 的成本一行。
- `pipeline/evidence/exits.py`、`quintile.py`：`net_return` 加 `mk.slip`。
- `pipeline/evidence/strategies.py`：`simulate` 加滑價；今日清單與訊號改用 `first_triggers`；讀註冊旗標 `enabled`／`disabled_reason`、輸出 `registered`。
- `pipeline/evidence/data.py`：`EvData.markets`（上市櫃分組）；`revenue_table` 生效日晚於資料的列設為資料之外。
- `pipeline/evidence/run.py`：`_ctx` 多 `catalog`；`run_and_write` 末尾掛入 swing.build 與 selection.annotate（各 4 行）。
- `pipeline/cli.py`：新增 `audit`、`swing` 子命令。
- `pipeline/derive/backtest.py`：`Prices.high`＋`locked()`；`slippage_rate()`；`net_return` 加滑價；出場迴圈順延鎖死、`excluded.locked_exit`；docstring 規則 4a／5。
- `pipeline/derive/extras.py`：`build_prices` 帶 `high`；`bt/prices.json` 多 `high`。
- `pipeline/derive/dataset.py`：tdcc 載入過濾壞日期。
- `tests/pipeline/test_evidence.py`：成本、基準、下市、模擬、營收生效日的預期值更新與新測試。
- `tests/pipeline/test_backtest.py`：滑價、鎖死順延測試。
- `web/src/lib/backtest.ts`：`slippageRate`、`netReturn` 加滑價、`lockedDown`、`Panel.high`、`excluded.locked_exit`。
- `web/src/workers/backtest.worker.ts`：讀 `prices.high`。
- `web/src/components/BacktestReport.tsx`、`pages/Backtest.tsx`、`pages/Tracking.tsx`：成本說明文字與「出場日跌停鎖死順延 N 筆」。
- `web/src/lib/backtest.test.ts`：同上測試。
- `web/src/lib/sorting.ts`：`Sortable.rank`，預設排序同級內先依排名。
- `web/src/lib/strategies.ts`：`rank`、`t_corr`、`per_month`、`selection`、`registered`、`kind`、`swing` 型別。
- `web/src/pages/Strategies.tsx`：列表多一行排名；策略頁掛入 `SwingCard`。
- `docs/DECISIONS.md`：#180–193。

**停用**（註冊旗標，程式未刪）：`config/strategies.yml` 的 13 套（near_high、top_decile、far_above_ma、price_margin_up、revenue_year_high、revenue_yoy_up3、rise_before_revenue、leader_trust、trust_buying、foreign_trust_sync、k_high_5days、three_buyers、whale_weekly_up）。

## 8. 新舊畫面截圖（iPhone 402×874；舊＝main 程式＋同一份資料的 JSON，新＝本分支；檔案在 `docs/audit/signals/shots/`）

| 畫面 | 舊 | 新 |
|---|---|---|
| 策略庫列表（深色） | ![](https://raw.githubusercontent.com/zychang39/twse-money-flow/claude/signal-audit-swing/docs/audit/signals/shots/strategies-before-dark.png) | ![](https://raw.githubusercontent.com/zychang39/twse-money-flow/claude/signal-audit-swing/docs/audit/signals/shots/strategies-after-dark.png) |
| 策略庫列表（淺色） | ![](https://raw.githubusercontent.com/zychang39/twse-money-flow/claude/signal-audit-swing/docs/audit/signals/shots/strategies-before-light.png) | ![](https://raw.githubusercontent.com/zychang39/twse-money-flow/claude/signal-audit-swing/docs/audit/signals/shots/strategies-after-light.png) |
| 指標效度表（深色） | ![](https://raw.githubusercontent.com/zychang39/twse-money-flow/claude/signal-audit-swing/docs/audit/signals/shots/evidence-before-dark.png) | ![](https://raw.githubusercontent.com/zychang39/twse-money-flow/claude/signal-audit-swing/docs/audit/signals/shots/evidence-after-dark.png) |
| 策略頁：營收一年高（舊，上架）→ 停用 | ![](https://raw.githubusercontent.com/zychang39/twse-money-flow/claude/signal-audit-swing/docs/audit/signals/shots/strategy-revenue_year_high-before-dark.png) | ![](https://raw.githubusercontent.com/zychang39/twse-money-flow/claude/signal-audit-swing/docs/audit/signals/shots/strategy-revenue_year_high-after-dark.png) |
| 策略頁：營收高強勢（新，三段績效、門檻、分布卡） | —（新策略） | ![](https://raw.githubusercontent.com/zychang39/twse-money-flow/claude/signal-audit-swing/docs/audit/signals/shots/strategy-rev_strong-after-dark.png) |

版面沿用既有元件（卡片、表格、字級、分段控制、標籤）；新增的只有策略頁的「三段績效／上線門檻／參數 ±20%／分布」卡（`SwingCard`）與列表的一行「有效性排名・校正後 t・每月觸發」。

## 9. 重現所有數字的指令
```bash
python3.12 -m venv .venv && . .venv/bin/activate && pip install -r pipeline/requirements.txt -r pipeline/requirements-dev.txt
git fetch origin data && git worktree add ../twse-data origin/data        # 35fdaa29
# 修正後：總表、strategies.json（含精簡清單、波段策略最終測試）、INDICATOR_EVIDENCE
python -m pipeline evidence --data-dir ../twse-data --out /tmp/after --doc /tmp/after/INDICATOR_EVIDENCE.md
python -m pipeline audit --data-dir ../twse-data --out docs/audit/signals  # 校正後 t、相關矩陣、分組（AUDIT_TABLES.md）
python -m pipeline swing --data-dir ../twse-data --id rev_strong           # 波段策略開發／驗證段（TRIALS.md）
# 修正前：切到 main 用同一份資料
git stash -u; git checkout main && python -m pipeline evidence --data-dir ../twse-data --out /tmp/before; git checkout -
# 成本抵銷的證明：scratchpad/cost_leak.py（monkeypatch engine.cost_rates 為 0，比較 exc_mkt）
# 使用者回測引擎前後：scratchpad/lock_numbers.py；今日清單前後：scratchpad/today_counts.py（兩者都在 PR 文字中列出數字）
cd web && npm ci && npm run lint && npm run typecheck && npm test && npm run build && npx playwright test --project=iphone
BEFORE_DIR=/tmp/before AFTER_DIR=/tmp/after node scripts/audit-shots.mjs  # 新舊截圖
```

## 10. 建議區（判斷問題，未動手）
1. **判定用持有天數 10 日**：成本修正後 10 日的超額全為 ≤ 0，而 40 日多數為正（RS 站上 90 +1.42%、營收創高 +2.03%、漲多投信買 +1.94%）。建議把判定持有天數改為 20 或 40（或改用「每持有日年化超額」的 walk-forward 選 N）。
2. **判定的 t 門檻**：規格 t ≥ 2.5 用日曆時間法 t；建議改用校正後 t（NW／區塊）並依假說數（108 → 3.5）校正，或至少把「校正後 t」納入判定表。
3. **基準**：等權 universe 在小型股行情下很難贏；建議同時顯示「相對 0050」作為可投資基準的判定（現有「未勝過大型股」標示已在）。
4. **universe 流動性門檻 2,000 萬**：成交值 < 5,000 萬的事件沒有灌水的正超額，但實際可成交量有限；建議 universe 最低 5,000 萬或在策略層加 1 億濾網（新策略已用）。
5. **營收創高 vs 年增加速相關 0.97**：兩套幾乎是同一個訊號，建議只留一套。
6. **集保回補程式加壞日期檢查**（`_tdcc_upsert`）：目前只在載入時過濾。
7. **法人、信用 2016-09-01～11-16 回補**（指令見 DATA_AUDIT.md）；**除權息 2016–2020 回補**讓價格類評估可從 2017 起（TWT49U 可查更早年份）。
8. 策略頁「未通過驗證」清單現在有 15 套（13 停用＋2 波段），可考慮收合顯示。
10. **營收高強勢的組合層**：加環境濾網（大盤年線）或停損會是第 6 次以上的嘗試與新參數，沒有做；建議先以訊號追蹤前瞻觀察。
9. `costs.yml` 的券商折扣 0.6 仍用於日誌與部位試算（使用者設定），回測頁的折扣也依使用者設定；若要回測一律用牌告費率，需改 `lib/backtest.ts` 的預設。

## 11. 已知限制、未完成事項、還原方式
- **新策略只有 1 套通過**（營收高強勢）、2 套未通過；現有 13 套全部停用。有效清單 1 套（不足 15 套就維持實際數量，不湊數）。
- **最終測試段算過兩次**：月營收回補前（資料 2023-06 起）三套的測試段已在 `run_and_write` 算過一次（rev_strong +7.9%、t 1.43，未通過）；回補後資料期間與三段切分都變了，重算一次（第 4 節）。兩次之間沒有改任何規則或參數（TRIALS #1 與 #5 參數相同）。營收高強勢的「測試段 > 現有最佳」只贏 0.2 個百分點，是六項門檻中最勉強的一項。
- **營收高強勢的組合層表現差**（5 檔組合年化 +0.7%、最大回撤 −69%）：超額為正（相對同日等權）不代表絕對報酬可接受；沒有加環境濾網與停損（會變成第 6 次以上的嘗試與參數），留給驗收決定。
- **集保全市場回補 20%**：三方同買、大戶週增仍樣本範圍受限；10/7 前後補齊後每日部署自動重算（註冊旗標仍為停用，需人工改回）。
- **法人、信用 2016-09～11 缺 2.5 個月**（待續槽被本次月營收回補取代）；指令在 DATA_AUDIT.md。
- **FinMind 只抓了 276 檔**（免費等級限流），只作交叉比對；沒有寫入任何 FinMind 資料。
- **環境依賴**：評估期間 76% 的交易日在年線上；2025 年的 AI 權值股行情主導多數指標的正超額。
- 還原方式：
  - 成本：`config/evidence.yml costs.commission_discount: 0.6、slippage: 0`；`benchmark_net_of_costs: true`；`thresholds.backtest.slippage_pct: 0`。
  - 鎖死順延：`thresholds.backtest.limit_down_pct` 設 −100（等於不判斷）或移除 `high`。
  - 首次觸發：`strategies.build` 的兩處改回 `keep["mask"] & uni`。
  - 停用：`config/strategies.yml` 各套 `enabled: true`。
  - 新策略：`config/swing.yml` 各套 `enabled: false` 或移除 `run_and_write` 的 8 行掛入。
  - 集保壞日期：移除 `dataset.load` 的過濾 5 行。

- **檢查結果**：ruff、ruff format、mypy、pytest（含新增 5 個 swing 測試）、eslint（1 個既有警告）、tsc、vitest 323 個全過；`npm run build` 通過；Playwright 262 個（iphone）：261 通過、1 個失敗為時間相關（`r1-m1 U-02`：示範資料日 9/24 距今天超過 2 個交易日，「資料可能過期」橫幅正確出現；在 main 上同樣會失敗），與本分支改動無關；策略相關的 spec 在最後一次 build 後再跑一次全過。
- 策略頁「未通過驗證」的 15 套都還能點進去看完整數字（含三段績效），方便驗收後決定要不要改回 `enabled: true`。


🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_014i7C2e6rdivJBPsgzwupU9
