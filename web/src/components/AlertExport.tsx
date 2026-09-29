import { useState } from 'preact/hooks';
import { useDb } from '../hooks';
import { getSetting, listStrategies, listTrades, listWatch, setSetting } from '../db/db';

export interface AlertRule { code: string; above?: number | null; below?: number | null; note?: string }

/**
 * 產生 config/alerts.yml 內容（複製後貼到 repo，由 Actions 盤中檢查並推播 Telegram）。
 * digest：盤後日報要列出的代號（自選股＋持股）。
 */
export interface TrackingRule { preset: string; horizon: number; since: string }

/**
 * tracking（S4）：追蹤中的內建策略（紀律 → 訊號追蹤）；盤後日報列出這些策略的今日新觸發與「明天開盤出場」的部位。
 * 自訂條件的追蹤只在 App 內計算，不列入。
 */
export function toAlertsYaml(rules: AlertRule[], digest: string[] = [], tracking: TrackingRule[] = []): string {
  const codes = [...new Set(digest.filter(Boolean))];
  const lines = [
    '# 由 App「匯出提醒設定」產生',
    'version: 1',
    `digest: [${codes.map((c) => `"${c}"`).join(', ')}]`,
    tracking.length ? 'tracking:' : 'tracking: []',
    ...tracking.map((t) => `  - { preset: ${t.preset}, horizon: ${t.horizon}, since: "${t.since}" }`),
    'alerts:',
  ];
  const valid = rules.filter((r) => r.code && ((r.above ?? 0) > 0 || (r.below ?? 0) > 0));
  if (!valid.length) return lines.join('\n').replace(/alerts:$/, 'alerts: []');
  for (const r of valid) {
    const parts = [`code: "${r.code}"`];
    if (r.above) parts.push(`above: ${r.above}`);
    if (r.below) parts.push(`below: ${r.below}`);
    if (r.note) parts.push(`note: "${r.note.replace(/"/g, "'")}"`);
    lines.push(`  - { ${parts.join(', ')} }`);
  }
  return lines.join('\n');
}

export function AlertExport() {
  const state = useDb(async () => ({
    rules: await getSetting<AlertRule[]>('alerts', []),
    watch: await listWatch(),
    held: (await listTrades()).filter((t) => t.status === 'open').map((t) => t.code),
    tracking: (await listStrategies()).filter((s) => s.active && s.presetId).map((s) => ({ preset: s.presetId!, horizon: s.horizon, since: s.startAfter })),
  }));
  const [copied, setCopied] = useState(false);
  if (!state) return null;
  const rules = state.rules;
  const codes = state.watch.map((w) => w.code);
  const update = (i: number, patch: Partial<AlertRule>) => setSetting('alerts', rules.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const yaml = toAlertsYaml(rules, [...codes, ...state.held], state.tracking);
  return (
    <div class="card">
      {rules.map((r, i) => (
        <div key={i} class="row wrap" style={{ marginBottom: '0.5rem' }}>
          <input class="input" style={{ width: '6rem' }} aria-label="代號" value={r.code} list="alert-codes" onChange={(e) => update(i, { code: (e.target as HTMLInputElement).value.trim() })} />
          <input class="input" style={{ width: '6.5rem' }} type="number" inputMode="decimal" placeholder="≥ 價格" aria-label="向上到價" value={r.above ?? ''} onChange={(e) => update(i, { above: Number((e.target as HTMLInputElement).value) || null })} />
          <input class="input" style={{ width: '6.5rem' }} type="number" inputMode="decimal" placeholder="≤ 價格" aria-label="向下到價" value={r.below ?? ''} onChange={(e) => update(i, { below: Number((e.target as HTMLInputElement).value) || null })} />
          <input class="input" style={{ flex: '1 1 6rem' }} placeholder="備註" aria-label="備註" value={r.note ?? ''} onChange={(e) => update(i, { note: (e.target as HTMLInputElement).value })} />
          <button class="btn small danger" onClick={() => setSetting('alerts', rules.filter((_, j) => j !== i))}>刪除</button>
        </div>
      ))}
      <datalist id="alert-codes">{codes.map((c) => <option key={c} value={c} />)}</datalist>
      <button class="btn small" onClick={() => setSetting('alerts', [...rules, { code: codes[0] ?? '', above: null, below: null }])}>新增提醒</button>
      <label class="field">
        <span>匯出的 config/alerts.yml（含盤後日報要列出的自選股與持股；複製後在 GitHub 網頁版貼上並 Commit）</span>
        <textarea class="input" rows={6} readOnly value={yaml} style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.8125rem' }} />
      </label>
      <button class="btn primary" onClick={() => navigator.clipboard?.writeText(yaml).then(() => setCopied(true))}>{copied ? '已複製' : '匯出提醒設定（複製）'}</button>
    </div>
  );
}
