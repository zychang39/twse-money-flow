/**
 * 加入自選股 ›「從截圖加入」（2026-11-14；DECISIONS #464）：選券商庫存的截圖（可多張）或貼上文字 → 找出股票 → 勾選確認 → 加進群組。
 * 截圖只在這支裝置上辨識（lib/ocr），不上傳、不儲存；比對邏輯在 lib/watchImport（不靠版面，任何券商都一樣）。
 * 先用英數模型找代號就先列出來，中文名稱核對完再更新標記。只加進自選清單，不讀股數與成本。
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import type { StockRow } from '../data/types';
import { addWatchMany } from '../db/db';
import { extractStocks, importSummary, type ImportCandidate, type ImportSource } from '../lib/watchImport';

const NOTE: Record<string, string> = { code: '名稱沒對到，請確認', name: '只對到名稱', off: '可能是金額，不是代號' };

export function WatchImport({ rows, watched, group, open }: { rows: StockRow[]; watched: Set<string>; group: string; open: boolean }) {
  const [items, setItems] = useState<ImportCandidate[]>([]);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const [raw, setRaw] = useState('');
  const [unknown, setUnknown] = useState<string[]>([]);
  const sources = useRef<ImportSource[]>([]);
  const picked = useRef<Map<string, boolean>>(new Map());
  const fileRef = useRef<HTMLInputElement>(null);

  // 面板關閉：清掉結果並釋放辨識引擎
  useEffect(() => {
    if (open) return;
    sources.current = [];
    picked.current = new Map();
    setItems([]); setBusy(''); setMsg(''); setRaw(''); setUnknown([]);
    void import('../lib/ocr').then((m) => m.disposeOcr()).catch(() => undefined);
  }, [open]);

  /** 重新比對：使用者動過的勾選保留，其餘用預設 */
  const refresh = () => {
    const res = extractStocks(sources.current, rows);
    const found = res.items.map((c) => ({ ...c, checked: picked.current.get(c.code) ?? c.checked }));
    setItems(found);
    setUnknown(res.unknown);
    setRaw(sources.current.map((x) => x.text.trim()).join('\n———\n'));
    return found;
  };

  async function onFiles(e: Event) {
    const input = e.target as HTMLInputElement;
    const files = [...(input.files ?? [])];
    input.value = '';
    if (!files.length) return;
    setMsg('');
    try {
      const { recognizeScreenshot } = await import('../lib/ocr');
      for (let i = 0; i < files.length; i++) {
        const label = files.length > 1 ? `第 ${i + 1}／${files.length} 張` : '';
        setBusy(`${label}辨識中：找代號（第一次使用要下載辨識工具，約 8 MB）`);
        await recognizeScreenshot(files[i], (kind, result) => {
          sources.current.push(result);
          refresh();
          if (kind === 'codes') setBusy(`${label}已找到代號，核對名稱中`);
        });
      }
      const found = refresh();
      setMsg(found.length ? '' : '沒有找到股票代號或名稱。可以改用「貼上文字」：在相簿長按截圖上的文字、全選拷貝，再回來貼上。');
    } catch (err) {
      setMsg(`辨識失敗（${err instanceof Error ? err.message : '未知錯誤'}）。可以改用「貼上文字」。`);
    } finally {
      setBusy('');
    }
  }

  async function onPaste() {
    setMsg('');
    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) { setMsg('剪貼簿裡沒有文字。先在相簿長按截圖上的文字、全選拷貝。'); return; }
      sources.current.push({ text });
      if (!refresh().length) setMsg('貼上的文字裡沒有找到股票代號或名稱。');
    } catch {
      setMsg('讀不到剪貼簿（瀏覽器沒有允許）。請貼到下面的文字框，再按「匯入」。');
    }
  }

  const toggle = (code: string) => {
    setItems((cur) => cur.map((c) => {
      if (c.code !== code) return c;
      picked.current.set(code, !c.checked);
      return { ...c, checked: !c.checked };
    }));
  };

  async function add() {
    const codes = items.filter((c) => c.checked && !watched.has(c.code)).map((c) => c.code);
    const n = await addWatchMany(codes, group);
    sources.current = [];
    picked.current = new Map();
    setItems([]);
    setRaw('');
    setUnknown([]);
    setMsg(`已加入 ${n} 檔到「${group}」`);
  }

  const sum = importSummary(items, watched);
  const count = items.filter((c) => c.checked && !watched.has(c.code)).length;
  return (
    <section class="watch-import" data-testid="watch-import" aria-label="從截圖加入">
      <p class="caption muted">從券商庫存的截圖加入（任何券商都可以；可一次選多張）。截圖只在這支裝置上辨識，不會上傳。</p>
      <div class="row wrap" style={{ gap: 'var(--s-2)' }}>
        <button type="button" class="btn" disabled={!!busy} onClick={() => fileRef.current?.click()} data-testid="import-pick">選截圖</button>
        <button type="button" class="btn" disabled={!!busy} onClick={onPaste} data-testid="import-paste">貼上文字</button>
        <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={onFiles} data-testid="import-file" />
      </div>
      {busy ? <p class="caption muted" role="status" data-testid="import-busy">{busy}</p> : null}
      {msg ? <p class="caption muted" role="status" data-testid="import-msg">{msg}</p> : null}
      {items.length ? (
        <>
          <p class="caption muted" role="status" data-testid="import-summary">
            找到 {sum.found} 檔{sum.found - sum.fresh ? `，其中 ${sum.found - sum.fresh} 檔已在自選` : ''}{sum.review ? `；${sum.review} 檔請再看一眼` : ''}
          </p>
          {unknown.length ? <p class="caption muted" role="status" data-testid="import-unknown">不在上市櫃清單、沒有列入：{unknown.join('、')}（例如興櫃股）</p> : null}
          <div class="list" data-testid="import-list">
            {items.map((c) => {
              const done = watched.has(c.code);
              const note = done ? '已在自選' : c.offColumn && c.match === 'code' ? NOTE.off : c.match === 'both' ? '' : NOTE[c.match];
              return (
                <label key={c.code} class="list-item check-row" data-testid={`import-${c.code}`}>
                  <input type="checkbox" checked={done || c.checked} disabled={done} onChange={() => toggle(c.code)} />
                  <span class="grow"><span class="body">{c.name}</span>
                    <span class="caption muted" style={{ display: 'block' }}><span class="nowrap">{c.code}</span>{note ? `・${note}` : ''}</span>
                  </span>
                </label>
              );
            })}
          </div>
          <button type="button" class="btn primary block" disabled={!count || !!busy} onClick={add} data-testid="import-add">
            {count ? `加入 ${count} 檔到「${group}」` : '勾選要加入的股票'}
          </button>
        </>
      ) : null}
      {raw ? (
        <details class="watch-import-raw" data-testid="import-raw">
          <summary class="caption muted">辨識到的文字（少了哪一檔時可以對照）</summary>
          <pre class="caption muted">{raw}</pre>
        </details>
      ) : null}
    </section>
  );
}
