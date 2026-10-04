# PROGRESS — 2026-10 恢復環境光改版（M0–M7）

> 中斷後新對話：先讀這份，再接著做；不要重新探索 repo。
> 分支：`claude/restore-ambient-revamp`（自 main cbb43e5）。一個里程碑一個 commit，最後開單一 PR。

## 環境（本機工作目錄，不 commit）
- `.venv`（python3.12）已裝 pipeline 依賴；`web/node_modules` 已 `npm ci`。
- data 分支 worktree：`/home/user/data`；真實資料 build：`python -m pipeline build-web --data-dir /home/user/data --out /home/user/webdata`
- 改版前（d6a9362，PR #28 merge）worktree：`/home/user/old`；`/home/user/old/web/dist` 以 `npx vite preview --port 4174` 服務。
- 截圖：`PW_CHROMIUM_PATH=/opt/pw-browsers/chromium CJK_FONT_DIR=/tmp/cjk/node_modules/@fontsource/noto-sans-tc`（`npm i --prefix /tmp/cjk @fontsource/noto-sans-tc@5.3.0`）
- 網路：twse.com.tw 被擋（000）、Yahoo 429；ic.tpex.org.tw、mops、github.io 可連。分鐘資料只能在 Actions 抓。

## 改版前基準
- 改版前最後 commit：`d6a9362`（Merge PR #28）；改版＝PR #29（6081e85…a290662，「文案與版面重排」）。
- 基準截圖：`docs/screens/restore-2026-10/baseline/{brief,stock}.png`（402×874 @3x 首屏）與 `-full.jpg`（示範資料）。
- 舊環境光：`old/web/src/components/Chrome.tsx:281 Ambient`、`old/web/src/styles/global.css:362`（radial-gradient 由頂端 50% 0%，34rem 高；tokens `--glow-up/down/risk/neutral`）。

## 里程碑
### M0 取回舊樣式與共用元件
- [x] 基準截圖
- [x] 盤點寫入本檔（下節）
- [x] 取回：環境光（修正 Chromium 無效的 gradient）、滿版、發光平滑折線＋面積漸層、線尾光點＋外暈、起始價虛線＋標籤、主數字 56、進場描繪/補間、區間膠囊（舊 brand-fill）、資料落後提示（StaleNote）；四環＝kit Ring；成交金額讀值＝既有 NetBars/StackedChart（M2 套用）
- [x] tokens（只做深色）＋共用元件
- [x] 元件展示頁 `#/dev`（pages/Gallery.tsx，無入口）
- [x] 對齊稽核腳本更新（gallery、單位拆行改判斷、.term 例外）＋進 CI；contrast.py 改單一深色區塊
- [x] 驗收：e2e 293 全過（更新 6 支舊規則測試）、vitest、lint、typecheck、contrast、audit 0；比對圖 docs/screens/restore-2026-10/m0/compare-baseline-vs-m0.jpg
- [x] commit

### M1 資料與計算
- [x] 1.1 分鐘資料：原因＝PR #29 合併後尚未有交易日執行 kbar／指數盤中（data 分支沒有 raw）＋前端以 intraday/index.json 涵蓋才顯示 1D/1W。
      已在 main 觸發 Actions：kbar（run 158）、twse_intraday_index 回補 9/24–10/2（run 159 成功）。kbar_files 改為每檔都輸出（no_trade／missing）。前端 1D/1W 永遠顯示 → M3。
- [x] 1.2 sectors.py（三層、名次＋併入上層、等權指數、名次/寬度歷史、走勢相近）；config/sectors/{tpex_chain.csv,fine.yml,themes.yml}；涵蓋 2367/2367
- [x] 1.3 trend.py（均線斜率/前值、間距、排列天數、ATR14/ATR%/百分位、乖離ATR倍數、52 週、60 日新高次數、對 0050/細產業）
- [x] 1.4 法人「估」原因＝twse/tpex_insti_amount 從未抓取；已觸發回補 6/1–10/2（run 160）。成交金額 total/twse/tpex 已有。
- [x] 1.5 evidence/periods.py → strategy/{id}.json（期間 all/from/last/year、四基準判定、多期間表、組合重模擬、隨機帶、曲線、逐筆、月度、滾動 3 年、出場逐筆、篩出/新觸發）；漲停：engine 已排除（limit_up_pct 9.5），流動性：universe 20 日均值 ≥ 5,000 萬 → 不需重算（寫入文件）
- [x] 驗證腳本 `python -m pipeline validate-web`；分檔 write_json_split＋前端 lib/parts.ts（screen_days、bt/*）
- [x] 驗收（docs/screens/restore-2026-10/m1/data-check.md：validate-web 0 錯誤、10/10 OHLC 一致、期間檢視＝判定卡）＋commit

### M2 簡報頁與我的股票
- [x] 簡報頁：IndexHero（無卡片、環境光）、分段 總覽/市場/資金/我的（useSegParam）、LevelAxis、BarSeries（法人 20 日、成交金額堆疊＋20 日線、20/60）、breadth_hist
- [x] 我的股票：一行狀態、Seg 計數、RS 小進度條、無截斷、分頁器清單＝顯示順序（含無資料股票）
- [x] 截圖並排＋稽核＋commit（#335–338；docs/screens/restore-2026-10/m2；稽核 16 頁 0 違反；e2e 全過）
### M3 個股頁
- [x] 頁首路徑（族群可點）、收盤價（還原）、主角 56、折線預設／K 線選項（日／週／月 K，記住）、1D～ALL 一律顯示（無分 K 說明原因＋日資料 fallback）、狀態標籤、黏性分段 ?seg=
- [x] 總覽：四環（跳分段）＋綜合分、六指標＋解讀行／橘點、策略訊號（components/stock/Overview.tsx、lib/stockInterp.ts）
- [x] 動能：五張摘要卡 → #/stock/{code}/m/{card}（components/stock/Momentum.tsx、pages/StockMomentum.tsx）；分數明細 #/stock/{code}/scores
- [x] 籌碼（components/stock/Chips.tsx）、基本面、事件：結論行＋圖在上表格在下
- [x] pipeline ATR14 改 Wilder（trend.wilder）；webdata3 重建、validate-web 0 錯誤
- [x] 依規格原文補齊（總覽六格含千張大戶、族群卡＋走勢相近、籌碼圖上表下、內容區滑動換股；#343–346、#350）
- [x] 截圖並排＋稽核＋e2e＋commit（docs/screens/restore-2026-10/m3；#339–350）
- 規格原文：docs/design/RESTORE_SPEC_2026-10.md（M4–M7 細節以此為準）
### M4 探索、選股、族群、其他市場頁
- [x] 探索格（pages/Explore.tsx、styles/explore.css）
- [x] 選股（screen.json；pages/Screener.tsx；自訂條件 pages/ScreenerCustom.tsx）
- [x] 族群輪動（pages/Sectors.tsx、components/VirtualList.tsx）、族群頁與編輯（pages/SectorGroup.tsx）、lib/groups.ts、DB v6 groups
- [x] 主動式 ETF、市場溫度、指標效度、回測、行事曆、處置：長度規則與清單在第一個螢幕
- [x] 截圖＋稽核＋e2e（e2e/m4-explore.spec.ts）＋commit（#351–358；docs/screens/restore-2026-10/m4）
### M5 策略庫與策略詳情 — [ ]
### M6 流程、遊戲化、名詞內容、設定 — [ ]
### M7 整合審查＋PR — [ ]

## 設計決定（docs/DECISIONS.md #304 起）
- #304 只做深色；#305 基準 d6a9362、舊環境光在 Chromium 本來就不顯示（gradient 寫法無效）→ 修正；#306 環境光全站一層 useAmbient；
  #307 導覽列透明→玻璃、大標題收合；#308 齒輪取代頭像；#309 分頁列只有圖示、離底 8px；#310 字級；#311 卡片、brand-fill #0066d6；
  #312 單調三次平滑；#313 起始價虛線標籤；#314 名詞資料檔 config/glossary.yml＋alerts；#315 aria-label 朗讀；#316 骨架微光例外；#317 通用圖表軸；#318 稽核進 CI

## 共用元件與資料檔
- `components/Chrome.tsx`：TopBar（透明→玻璃、收合標題、齒輪；center 參數放分頁器）、GearButton、Dock、AmbientLayer、Ambient（相容：等同 useAmbient）
- `lib/ambient.ts`：useAmbient(mood)、moodOf(change)
- `components/kit.tsx`：Term、openHelp、HelpHost、onTermRead、Conclusion、Interp、RiskDot、Metric（.metrics 2 欄）、SummaryCard、ProgressBar、RangeBar、DivergingBar、MiniLine、Ring（.rings 4 欄）、Skeleton、DataState（loading/empty/stale/error/ok）、StaleNote、RollNum、reduceMotion
- `components/ui.tsx`：PageTitle、Section、Card、List/Row、Signed（aria-label）、Tag、Info、Seg（滑動選中塊）、Table、StatGrid、Button
- `components/SeriesChart.tsx`：SeriesChart（固定軸、圖例膠囊、線尾標籤、讀值面板、帶狀、年份條）、BarChart（可點單根）
- `components/HeroChart.tsx`：主走勢圖（平滑、兩層柔光、面積、光點外暈、起始價標籤、補間）；PeriodSelector
- `lib/axis.ts`（linearAxis/logAxis/lerpAxis/spreadLabels）、`lib/chartMath.ts smoothD`、`lib/glossary.ts`、`lib/appearance.ts`（data-help／data-tablabels）
- 樣式：`styles/kit.css`（新元件＋動畫）；tokens `styles/tokens.css`
- 名詞：`config/glossary.yml`（83 個名詞、7 個提醒門檻）；頁面 `#/me/glossary`
- 細產業（M1 進行中）：`config/sectors/tpex_chain.csv`（櫃買產業價值鏈快照 7463 筆／2432 檔）、`config/sectors/fine.yml`（IC 載板、未涵蓋股票對照、ETF 規則）、`config/sectors/themes.yml`（17 題材）、`pipeline/sources/tpex_chain.py`、CLI `sectors-refresh`
- 頁面快取 `/home/user/iccache`（47 個產業鏈頁）

## 盤點（M0，2026-10-03；HEAD cbb43e5）
**路由**（`web/src/router.ts` hash；`app.tsx Page` :46；lazy 於 `lazy.tsx`）
`#/` Tonight（簡報）｜`#/mine` Mine｜`#/search` Search｜`#/stock/:code` Stock（`/institutional` `/holders` `/bullbear` `/daily`）｜
`#/explore` Explore（`/screener` `/backtest` `/sectors/:ind?` `/etf` `/market` `/calendar` `/disposition` `/evidence` `/strategies/:id?` `/leverage`）｜
`#/discipline` Discipline（`/journal` `/checklist` `/stats` `/badges` `/weekly` `/tracking`）｜`#/me` Me（`/health` `/data` `/methodology` `/settings` `/backup`）。
分頁列 `lib/tabs.ts TAB_DEFS`：簡報 / 我的股票 / 探索 / 搜尋 / 流程；圖示 `Chrome.tsx:12`。
**外框** `components/Chrome.tsx`：`Dock`（玻璃膠囊、滑動選取、拖曳切換、捲動縮小）、`TopBar`（sticky 玻璃—要改透明）、`AvatarButton`→Sheet（沒有齒輪）、`Ambient`（:288，已 display:none）。
**共用元件** `components/ui.tsx`（PageTitle、Section+Info ⓘ、Card、List/Row、Signed（用 sr-only，要改 aria-label）、Tag、Seg、Table、StatGrid、Button）；樣式 `styles/ui.css`；`components/Sheet.tsx`（掛 body，半高/全高）。
**樣式** `styles/tokens.css`（唯一 tokens；淺色在 :root，深色重複兩份）、`global.css`（外框、圖表線、環境光）、`stock.css` `tools.css` `evidence.css` `strategy.css` `flow.css`。主題 `lib/theme.ts`（localStorage `tmf-theme`，index.html:14 先套用）。
被改平處：`--glow-*` alpha 0、`--line-glow-opacity: 0`（深色也沒覆寫）、`.ambient{display:none}`、`--fs-hero`=22px、topbar 不透明玻璃帶。
**圖表**：`HeroChart.tsx`（SVG；直線 `chartMath.pathD`；glow path＋feGaussianBlur；`.chart-base` 虛線＝`win.base ?? values[0]`＝區間起始價/前收；最高最低標籤；兩指區間；`PeriodSelector` 膠囊；`usePeriod` 記 localStorage）。
`StockChart.tsx`（K/折線、MA20/60、量、十字線；期間用 Seg；1D/1W 需 `intraday/index.json` 涵蓋才顯示）。`KChart.tsx` 未使用。`LineChart` `StackedChart` `EquityChart` `AlphaCurve` `Viz.tsx`（Sparkline、ScoreRing、Rings3、NetBars 可點讀值）。
**頁面資料**：Tonight← meta,index,intraday,market,strategies；Stock← stocks/{code}.json(+.hist.json)、intraday/{code}.json；Screener← evidence*.json, screen_days；Strategies← strategies.json, evidence/{id}.json；Sectors/Etf/MarketTemp← market.json；Explore← evidence,strategies,disposition,market,index。
**build-web** `pipeline/derive/export.py build_web`(:233) → build.py（stocks/*, summary, inactive, lists, disposition）、history.py（.hist）、extras.py（index, intraday*, market, calendar, backtests, bt/*）、signals.py、evidence/run.py（evidence*, strategies.json）、guard.py。
**分鐘資料**：指數 `twse_intraday_index`（MI_5MINS_INDEX, sources/advanced.py:232）stage:close；備援 yahoo_twii。個股 `yahoo_kbar`（sources/yahoo.py, tasks_kbar.py run_kbar）cron 45 6 UTC、自我串接；raw/yahoo_kbar 保留 10 日；→ `intraday/{code}.json`＋`intraday/index.json`。**data 分支目前完全沒有這兩種 raw（PR #29 10/4 01:48 才合併，尚無交易日）**；示範資料也沒有。
**產業**：只有官方 `config/industries.yml`；沒有細產業/題材。
**法人金額**：extras.market_flows(:639) 官方金額，缺一市場時估算 est。成交金額 turnover_series(:534) total/twse/tpex + ma20_ratio。
**CLI** `pipeline/cli.py`；workflows：data.yml（stage:close 06:15 UTC、insti 07:30、credit 13:30、kbar 06:45…）、deploy.yml、ci.yml（python: ruff/mypy/pytest；web: demo-data, check-json, lint, typecheck, contrast.py, vitest, build, playwright）。
**本機資料** `web/src/db/db.ts` DB_VERSION 5、MIGRATIONS；`db/backup.ts` exportAll/import/migrateBackup。
**測試**：vitest（vite.config.ts）、Playwright（iPhone 13、preview 4173、demo-data）、`scripts/align-audit.mjs`（402×874，未進 CI）。
**名詞**：沒有名詞資料檔或說明面板（只有各區塊 ⓘ Info）。
**遊戲化**：`config/ui.yml gamification`；`lib/ritual.ts`（levelThreshold=base×(2^(n−1)−1) :471、flowStreak、xpLedger）；`lib/achievements.ts`；`data/useFlow.ts`。
