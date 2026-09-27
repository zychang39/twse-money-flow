# twse-money-flow

台股投資**決策輔助**網頁 App（PWA，部署在 GitHub Pages）：
<https://zychang39.github.io/twse-money-flow/>

每天收盤後自動抓取證交所、櫃買中心、集保、期交所、公開資訊觀測站等官方開放資料，計算籌碼、動能、基本面、評價四類分數，並附上每個分數的因子明細與依據。

> 僅供研究參考，非投資建議。本 App 不使用「買進／賣出」字眼，一律以分數加上依據呈現。

## 功能

| 分頁 | 內容 |
|---|---|
| 今日 | 盤後日報：大盤、三大法人金額、資金燈號、自選股與持股的法人／信用／分數變化、新出現的風險旗標（有設定時另顯示「AI 生成」摘要） |
| 自選 | 自選股清單、分數與旗標、匯入代號 |
| 個股 | K 線（還原權息）、法人／融資券／借券、分數明細、合理價區間、法人成本線、月營收、季財報、健檢摘要、事件 |
| 選股 | 條件篩選（預設策略＋自訂）、儲存條件 |
| 市場 | 產業資金輪動熱力圖、資金燈號與市場溫度、主動式 ETF 清單 |
| 日誌 | 交易日誌、進場前檢查清單、部位大小與風險、投資組合分析 |
| 更多 | 回測（Web Worker）、週報、行事曆、處置風險預警、資料健康、方法說明、設定、備份 |

- 資料存在手機本機（IndexedDB），可匯出／匯入單一 JSON 備份，並會定期提醒備份。
- 離線可開啟（service worker），每頁顯示資料日期，資料過舊會警示。
- 紅漲綠跌，並以 ▲▼ 符號標示，支援 VoiceOver 與深色模式。

## 第一次使用：手動步驟（依序）

1. **Workflow 位置**：不需要搬移。開發時已實測可直接推送 `.github/workflows/`，所有 workflow 已在正確位置。
2. **開啟 GitHub Pages**：repo → Settings → Pages → Build and deployment → Source 選「**GitHub Actions**」。
3. **合併 PR**：把 `claude/tender-rubin-io02kz` 的 PR 合併到 `main`。合併後 `Deploy` workflow 會自動執行一次。
4. **執行回補**：repo → Actions → **Data** → Run workflow → task 選 `backfill`，其他欄位留白（預設回補近 3 年），按 Run。
   - 留白＝完整回補：除權息／減資／分割／注意／處置、櫃買指數、月營收、期交所與匯率、美債、季財報、央行 M1B／M2，以及每日行情／法人／融資融券／本益比（3 年）與借券／外資持股／當沖（近一年）。
   - 一次最多約 5 小時；沒補完會自動觸發下一輪（已存在的日期、已完成的月份會略過，可隨時重跑）。
   - 開發期間已用 Actions 預先回補了大部分資料到 `data` 分支，因此這一步通常較快完成。
   - 只想補特定來源時，在 source 填來源 id（逗號分隔，見 `config/sources.yml`），例如 `taifex,financials`。
5. **設定 Telegram 推播（選配）**：
   1. 在 Telegram 搜尋 **@BotFather** → 傳送 `/newbot` → 依指示取名 → 取得 **bot token**。
   2. 對新建立的 bot 傳任意一則訊息。
   3. 用瀏覽器開啟 `https://api.telegram.org/bot<你的token>/getUpdates`，找到 `"chat":{"id":…}` 的數字，就是 **chat id**。
   4. repo → Settings → Secrets and variables → Actions → New repository secret，新增 `TELEGRAM_BOT_TOKEN` 與 `TELEGRAM_CHAT_ID`。
   5. 在 App「更多 → 設定 → 盤中到價提醒」設定價格，按「匯出提醒設定（複製）」，到 GitHub 網頁版編輯 `config/alerts.yml`，整份貼上後 Commit。這份設定同時決定盤後日報要列出哪些自選股與持股。
6. **AI 摘要（選配）**：新增 secret `ANTHROPIC_API_KEY` 後，每次部署會產生當日盤後條列摘要（標示「AI 生成」）。預設使用最新可用模型；要指定模型可新增 Actions variable `ANTHROPIC_MODEL`。沒有設定則完全不呼叫。
7. **確認部署**：Actions → **Deploy** 顯示綠色勾勾後，開啟 <https://zychang39.github.io/twse-money-flow/>。iPhone 可用 Safari「分享 → 加入主畫面」安裝成 App。
   - 首頁與「更多 → 資料健康」會顯示每個資料來源的最後成功日期；資料源失敗時會自動開一個標籤為 `data-failure` 的 Issue，恢復後自動關閉。

## 自動排程（`.github/workflows/data.yml`，台北時間）

| 時間 | 任務 |
|---|---|
| 交易日 17:30、21:30 | 每日任務：行情、法人、融資融券、本益比、借券、外資持股、當沖、注意／處置、除權息、期交所、匯率、美債；21:30 那次完成後推播 Telegram 日報 |
| 交易日 09:00–13:45 每 15 分鐘 | 盤中到價提醒（只讀即時報價、不寫資料） |
| 每週六 10:00 | 集保股權分散表、央行 M1B／M2、法說會 |
| 每月 11 日 | 月營收彙總 |
| 5/16、8/15、11/15、4/1 | 季報／年報 |

每次執行都會呼叫 GitHub API 保持排程啟用，避免 60 天無活動被停用。資料寫入孤兒分支 `data`（每月 squash 一次）；衍生資料在部署時產生、不進版控。

## 資料來源與授權

資料來自臺灣證券交易所、證券櫃檯買賣中心、臺灣集中保管結算所、臺灣期貨交易所、公開資訊觀測站、中央銀行、美國財政部等官方公開資訊（主動式 ETF 持股取自各發行投信官網的公開揭露），依「政府資料開放授權條款－第 1 版」及各網站使用規範使用，並於 App 頁尾標示來源。抓取時每次請求間隔 3–5 秒並加上隨機延遲，失敗會退避重試、連續失敗會暫停該網站；不繞過任何驗證碼或防護機制。詳見 [docs/DATA_SOURCES.md](docs/DATA_SOURCES.md)。

## 已知限制

- **主動式 ETF 每日持股（部分涵蓋）**：只在各投信官網個別揭露，沒有集中來源。目前實作野村、群益、元大、富邦 4 家投信（8／32 檔）；國泰、統一、兆豐、安聯因反爬、導向循環或驗證機制跳過，其餘待處理（各家狀態見 [docs/DATA_SOURCES.md](docs/DATA_SOURCES.md)）。
- **分點券商進出**：官方查詢系統需驗證碼，依規則不實作。
- **FRED 美元指數**：Actions 連線失敗，不納入。
- **櫃買面額變更**：找不到官方端點，以價格跳空推估（±35%），推估事件列在「資料健康」頁供檢查。
- **月營收公布日**：回補的歷史資料取不到實際公布日，保守假設次月 10 日收盤後生效；之後每日抓取會記錄實際首次出現日期。
- **現金股利**：證交所除權息結果只有權值＋息值合計，「權息」事件在無預告資料時以合計近似（UI 標示）。
- **法人成本線**、**合理價**皆為估算值；分數參數為事前設定的透明規則，不做資料最佳化。
- 盤中提醒每 15 分鐘檢查一次，GitHub 排程可能延遲數分鐘；以當日最高／最低判斷是否曾經到價。
- 證交所網站會封鎖部分雲端 IP；若 Actions 也被擋，對應來源會標示失敗並開 Issue，其他來源不受影響。

## 文件

- [CLAUDE.md](CLAUDE.md)：架構與開發規則
- [docs/METHODOLOGY.md](docs/METHODOLOGY.md)：所有指標、分數、回測、推播的計算定義
- [docs/DATA_SOURCES.md](docs/DATA_SOURCES.md)：資料來源、端點、實測結果
- [docs/DECISIONS.md](docs/DECISIONS.md)：開發過程中的決策紀錄

## 開發

```bash
# Python 3.12
python -m venv .venv && . .venv/bin/activate
pip install -r pipeline/requirements.txt -r pipeline/requirements-dev.txt
ruff check pipeline tests && ruff format --check pipeline tests && mypy && pytest

# 產生示範資料並啟動前端
python -m pipeline demo-data --out web/public/data
cd web && npm ci && npm run dev
npm run lint && npm run typecheck && npm test && npm run build && npm run e2e
```

常用 pipeline 指令：`python -m pipeline daily`、`python -m pipeline backfill --start 2023-09-01`、`python -m pipeline build-web --data-dir data`、`python -m pipeline alerts`。
