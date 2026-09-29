# 動能策略實驗室 v2：驗收截圖與量測

截圖一律 iPhone 18 Pro Safari 直向 viewport 402×874（3 倍密度），淺色與深色各一張；以 `web/scripts/shots.mjs` 產生。
指標效度、策略庫、槓桿計算使用真實資料的評估結果（資料至 2026-09-24）；個股頁的價格與籌碼為示範資料（`demo-data`），有效訊號面板的狀態為真實評估結果。

| 畫面 | 淺色 | 深色 |
|---|---|---|
| 指標效度表（INDICATOR_EVIDENCE 總表） | evidence-light.png | evidence-dark.png |
| 策略庫 | strategies-light.png | strategies-dark.png |
| 有效訊號面板（個股頁） | signal-panel-light.png | signal-panel-dark.png |
| 每日籌碼（個股頁） | daily-chips-light.png | daily-chips-dark.png |
| 槓桿計算：輸入 | leverage-light.png | leverage-dark.png |
| 槓桿計算：預設 20% 回撤的結果與斷路器 | leverage-result-light.png | leverage-result-dark.png |
| 槓桿計算：可承受回撤 60% 時的融資、維持率與跌停鎖死情境 | leverage-margin-light.png | leverage-margin-dark.png |

## 量測（2026-09-29，`vite preview`，Lighthouse 行動版預設）
| 頁面 | 效能 | 無障礙 | 最佳做法 | SEO |
|---|---|---|---|---|
| 今晚 | 98 | 100 | 100 | 100 |
| 指標效度表 | 99 | 100 | 96 | 100 |
| 策略庫 | 99 | 100 | 96 | 100 |
| 個股頁 | 90 | 100 | 96 | 100 |
| 槓桿計算 | 90 | 100 | 96 | 100 |

最佳做法 96 的扣分只來自量測時網址把 `#` 編碼成 `%23`，使 manifest 相對路徑解析錯誤（量測方式造成，正式網址不受影響）。

首次載入（index.html 直接引用的 JS＋CSS）gzip 合計約 68 KB（目標 < 250 KB）。
