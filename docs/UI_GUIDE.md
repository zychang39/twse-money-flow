# 版面規範（UI_GUIDE）

> 依 Apple Human Interface Guidelines 與 iOS 27 Liquid Glass 設計；全站適用，每日籌碼與區間統計為首要驗收對象。
> 設計 tokens 在 `web/src/styles/tokens.css`；自動驗收在 `web/e2e/layout.spec.ts`（任一項不符即失敗）。

## 1. 目標裝置與寬度
- 主要：iPhone 18 Pro，Safari 直向 CSS viewport **402 × 874 px**（3 倍密度）。以 402px 為主要設計寬度。
- 另需在 **375 × 667**、**440 × 956** 不破版（Playwright 三種 viewport 都驗收）。
- viewport meta：`width=device-width, initial-scale=1, viewport-fit=cover`；不禁止使用者手勢縮放（不設 `user-scalable=no`、`maximum-scale`）。

## 2. 不可左右滑移
- 每個頁面 `document.documentElement.scrollWidth ≤ clientWidth`。
- 表格不得使用 `overflow-x` 捲動、不得設定超過容器的最小寬度、不得用 `zoom`／`transform: scale` 整頁縮小。
- 只有「圖表的水平手勢」與「橫向排列的卡片列（index cards）」可以在元件內部水平捲動（不是表格、不影響頁面寬度）。

## 3. 邊界與安全區
- 左右內距 `16px + env(safe-area-inset-left／right)`（`--gutter: 1rem`）；402px 寬時內容可用寬度 370px。
- 頂部、底部固定元素加 `env(safe-area-inset-top／bottom)`，不被動態島或 Home 指示條遮住。
- 間距一律用 4 的倍數：4／8／12／16／24px（`--s-1`…`--s-6`）。

## 4. 字體與字級
- `font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang TC", sans-serif`。
- 字級用 rem，跟隨系統文字大小；對應 iOS 文字樣式：

| 用途 | 字級 | tokens |
|---|---|---|
| 頁面標題（Title 1） | 28px | `--fs-title` |
| 區塊標題（Headline，半粗體） | 17px | `--fs-section`（`.section`） |
| 內文（Body） | 17px | `--fs-body` |
| 表格數字（Subheadline） | 15px（放不下依序 14、13px，最低 13px） | `--fs-sub`、每日籌碼 `--cd-fs` |
| 表頭與註解（Footnote） | 13px | `--fs-caption` |
| 全站最小（Caption 2） | 11px | `--fs-micro` |

- 任何文字（含 SVG 圖表文字）不得小於 11px。例外：主角數字 52px（一個畫面只有一個）。

## 5. 數字格式
- 所有數字 `font-variant-numeric: tabular-nums`，上下列的個位、十位、千分位逗號垂直對齊。
- 負號全站統一 U+2212「−」（`format.MINUS`）；正號「+」。
- 漲跌同時用顏色與符號（▲／▼ 或 +／−），不只靠顏色；台股紅漲綠跌。紅、綠、文字對背景對比 ≥ 4.5:1（WCAG AA，CI 以 `scripts/contrast.py` 檢查）。
- 0 顯示「0」且不帶箭頭或正負號（不會出現 ▲0）。
- **籌碼數量一律以「張」**：完整千分位整數（12,345 張、1,234,567 張），不縮寫成萬、千、K、M，不保留小數；單位只在表格右上角出現一次，欄內數字不帶單位（METHODOLOGY §12）。

## 6. 對齊
- 數字欄一律靠右，表頭與該欄同側；文字欄（日期、名稱）靠左。
- 同一張表每欄寬度固定（`table-layout: fixed`），逐列對齊，不因數字長短跳動。

## 7. 塞進 402px 的方法（依序採用，不得以左右滑動取代）
1. 每張表最多 5 欄（日期＋4 個數字欄）；日期顯示 MM/DD，不顯示年份與星期。
2. 欄寬依實際資料計算：最長數字的字元數（含逗號與正負號）× 等寬數字寬度 ＋ 8px；15px 放不下逐級降到 14、13px（同一張表同一字級，最低 13px）。實作：`Chips.tsx useChipLayout`（以 canvas 量測，`FONT_STEPS = [15, 14, 13]`）。
3. 仍放不下：欄位分組，用分段控制切換（例：法人｜信用｜借券當沖），每組最多 5 欄，日期欄固定在最左；切換時不改變捲動位置。
4. 欄名用完整但精簡的中文（外資、投信、自營、合計、融資、融券），不用英文縮寫；過長時換成兩行，不加寬欄位。
5. 使用者放大系統文字而放不下：改為卡片直排（每個交易日一張卡，左側標籤、右側數字靠右），仍然不左右滑動。

## 8. 觸控
- 可點擊的列、按鈕、分段控制、展開箭頭：觸控區至少 **44 × 44px**；相鄰可點元素間距至少 8px。
- 視覺上較小的控制（小按鈕、膠囊）以絕對定位的 `::before` 把點擊範圍擴大到 44px（DECISIONS #125），驗收時計入。
- 可點擊的表格列高至少 44px，純顯示的列高至少 36px。
- 例外：段落文字中的行內連結（`p a`、`li a`，有底線）依 HIG 以文字大小為準，不另加高度；驗收時排除「位於文字段落中的行內連結」。

## 9. 可讀性
- 列與列之間用斑馬紋或 1px 分隔線（`--line`，深色模式也看得見）。
- 表頭在捲動時固定在區塊頂端（`position: sticky`）。
- 合計等重點數字用半粗體。
- 強調色只用紅（漲）、綠（跌）、系統藍（可互動）。琥珀是**風險狀態色**（產品原則：琥珀只代表風險），不是強調色，只用於風險、逾時、樣本範圍受限等狀態。

## 10. Liquid Glass
- 半透明玻璃只用在浮動的控制層：底部導覽（分頁列）、頂部導覽、更新提示、分段控制。
- 表格、數字與內容區一律實心背景（`.card`、`.list`、提示框 `.sc-tip` 都是實色）。
- `prefers-reduced-transparency: reduce` 或 `prefers-contrast: more` 時，玻璃改為不透明實色；提高對比時分隔線與次要文字加深。
- 支援深色模式；產品預設深色、不跟隨系統（可切換）。

## 11. 動態效果
- 切換與展開動畫 ≤ 250ms（`--dur-base` 240ms、`--dur-slow` 250ms）。
- `prefers-reduced-motion: reduce` 時取消所有動畫與轉場。

## 12. 自動驗收（`web/e2e/layout.spec.ts`）
Playwright 在 402×874、375×667、440×956 三種 viewport，對每個頁面（今晚、我的股票、探索、選股、回測、產業、主動式 ETF、市場溫度、行事曆、處置、指標效度表、策略庫、策略頁、槓桿計算、個股頁含每日籌碼與區間統計、法人報表、籌碼結構、多空對照、紀律、訊號追蹤、設定、資料健康、方法說明…）檢查：
1. `scrollWidth ≤ clientWidth`；且沒有任何表格放在會水平捲動的容器裡。
2. 所有可見文字字級 ≥ 11px。
3. 表格數字（含數字的 `td`）字級 ≥ 13px。
4. 數字欄（全部儲存格都是數字的欄）`text-align` 為 right。
5. 可點擊元素（按鈕、連結、分段控制、`summary`、`select`）觸控區 ≥ 44 × 44px（計入 `::before` 擴大範圍；行內文字連結除外）。
