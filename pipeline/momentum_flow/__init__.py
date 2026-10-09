"""探索頁「動能流程」（2026-10-09）：大盤狀態 → 候選池 → 檢查清單 → 組合試算 → 持股條件監看 → 回測與濾網效度。

隔離規則（規格零節）：本套件只唯讀引用既有模組（evidence.data、evidence.indicators、derive.sectors、derive.build 等），
不改既有函式；輸出寫到資料分支的新路徑 momentum_flow/（快照與前端用 JSON），由 `python -m pipeline.momentum_flow` 執行，
不經過既有的 cli／build-web。用語限定：符合、未符合、資料不足、條件觸發、曝險上限、部位試算；依規則產生，非推薦。
"""
