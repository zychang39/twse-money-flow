# CLAUDE.md — twse-money-flow 開發指南

## 規格摘要
台股投資**決策輔助**網頁 App（個人工具），部署於 GitHub Pages：
<https://zychang39.github.io/twse-money-flow/>

- 定位：以「分數 + 因子明細 + 依據」呈現，**不使用「買進／賣出」字眼**；頁尾註明「僅供研究參考，非投資建議」。
- 資料：證交所、櫃買中心、集保、期交所、公開資訊觀測站、美國財政部等**公開免費**資料；遵守政府資料開放授權並標示來源；不繞過驗證碼。
- 資料流程：GitHub Actions 依排程執行 `python -m pipeline`，正規化後寫入孤兒分支 `data`；部署時再由 pipeline 產生前端用 JSON（衍生資料不 commit）。
- 前端：Vite + TypeScript + Preact，hash 路由，PWA，手機優先；設計方向 B「環境光」（tokens 集中在 `web/src/styles/tokens.css`，5 級字級、原創線條圖示、深淺色）。紅漲綠跌並以 ▲▼ 表示；琥珀只代表風險；電光藍只給可互動元素。資訊架構與設計文件見 `docs/design/`。
- 使用者資料（自選、日誌、持倉、設定）只存在瀏覽器 IndexedDB，可單檔 JSON 匯出／匯入。
- 詳細規格：`docs/METHODOLOGY.md`（計算定義）、`docs/DATA_SOURCES.md`（資料源）、`docs/DECISIONS.md`（決策紀錄）。

## 架構
```
[排程 data.yml] → python -m pipeline daily|periodic|backfill|alerts
      │   抓取（禮貌爬取：3–5 秒間隔 + 抖動、指數退避、斷路器）
      │   正規化（民國→西元、千分位、「--」→ 空值、統一欄位）
      │   驗證（日期一致、筆數合理、無重複、關鍵欄位可解析；失敗不覆蓋）
      ▼
[data 分支] raw/{來源}/{YYYY}/{YYYYMMDD}.csv.gz + manifest.json
      │
[deploy.yml] python -m pipeline build-web → web/public/data/*.json（衍生：還原價、指標、分數、回測）
      ▼
[GitHub Pages] web/dist（Vite build，base=/twse-money-flow/）
```

## 目錄
| 路徑 | 說明 |
|---|---|
| `pipeline/` | Python 3.12 套件，`python -m pipeline <command>` |
| `pipeline/core/` | HTTP 客戶端（禮貌爬取）、交易日曆、正規化工具、儲存、驗證、manifest |
| `pipeline/sources/` | 每個資料源一個模組：`fetch()` 取回原始回應、`parse()` 轉成標準欄位 DataFrame |
| `pipeline/derive/` | 衍生計算：還原價、指標、分數、選股、回測、前端 JSON 匯出 |
| `pipeline/notify/` | Telegram 推播、GitHub Issue（data-failure） |
| `web/` | 前端（Vite + Preact + TS）；`web/src/lib` 為純函式（可測）、`web/src/pages` 為頁面 |
| `config/` | **單一事實來源**：權重、門檻、交易成本、資料源、產業代碼、提醒、介面行為參數（`ui.yml`）；pipeline 與 web 共用 |
| `docs/` | 文件 |
| `tests/` | pytest；`tests/fixtures/raw` 為 Actions 抓的真實樣本（勿手改），`tests/fixtures/local` 為本機抓取並裁切的樣本 |
| `.github/workflows/` | `data.yml`、`deploy.yml`、`ci.yml`；`smoke-test.yml`、`capture-fixtures.yml` 為使用者建立，**不要修改**（例外：2026-09-27 使用者要求在 `smoke-test.yml` 新增 `fields` job，原 `probe` job 未動） |

## 開發指令
```bash
# Python（需 3.12）
python3.12 -m venv .venv && . .venv/bin/activate
pip install -r pipeline/requirements.txt -r pipeline/requirements-dev.txt
ruff check pipeline tests && ruff format --check pipeline tests
mypy pipeline
pytest -q

# pipeline CLI（--data-dir 指向 data 分支的工作目錄）
python -m pipeline daily --data-dir data            # 每日任務
python -m pipeline periodic --data-dir data         # 週／月／季任務（依日期判斷）
python -m pipeline backfill --data-dir data --source twse_quotes --start 2023-10-01 --end 2026-09-24
python -m pipeline build-web --data-dir data --out web/public/data
python -m pipeline demo-data --out web/public/data   # 用 fixtures 產生示範資料（本機開發）
python -m pipeline smoke --date 2026-09-24           # 資料源冒煙測試：每個來源的必要欄位（格式變動提早發現）

# 前端
cd web && npm ci
npm run lint && npm run typecheck && npm test && npm run build
npm run e2e          # Playwright 冒煙測試（需先 build）
```

## 開發守則
- 里程碑順序即優先順序；每個里程碑 lint、型別檢查、測試、build 全過才 commit + push。
- 解析器一律用 `frame_from_fields` 的「別名＋必要／選用欄位」：必要欄位缺少才失敗，其他欄位缺少時補空值並記錄格式變動警告（manifest → 資料健康頁「相容模式」）。
- 新資料源：先抓真實樣本（本機可連就 curl；連不到就改 `tests/fixtures/capture-list.txt` 並 push，Actions 會抓回），依真實格式寫 parser 與測試，並更新 `docs/DATA_SOURCES.md`。
- 實測失敗的資料源：在文件與 UI 標示「資料源待處理」，不要卡住。
- 不放任何密鑰；依賴版本鎖定（`requirements*.txt` 用 `==`，npm 用 lockfile + 精確版本）。
- 不確定時自行做合理決定並寫入 `docs/DECISIONS.md`。
- 回測與指標一律使用還原價；嚴禁前視偏差（T 日收盤後訊號，T+1 開盤進場）。
