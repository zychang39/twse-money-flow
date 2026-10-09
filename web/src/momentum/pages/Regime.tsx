/**
 * 大盤分頁 › 動能環境（2026-10-09）：F1–F3 合計分數（順風／中性／逆風）與 F4–F6 參考條件。
 * 只供參考，不改變規格狀態機的曝險上限；歷史統計在「紀錄 › 環境」。
 */
import { List, Row, Section } from '../../components/ui';
import { Conclusion, Interp } from '../../components/kit';
import { fmtNum, md } from '../../lib/format';
import { TriText } from '../components';
import type { Latest, RegimeFlag } from '../data';
import { rPct } from '../fmt';
import { HELP } from '../help';

/** 每個條件的數值說明（F2、F6 是對數報酬相減，近似百分比） */
function flagValue(f: RegimeFlag): string {
  const v = f.value;
  if (v === null) return '資料不足';
  switch (f.k) {
    case 'F1': return `目前狀態 ${Math.round(v)}`;
    case 'F2': return `近 6 個月超額 ${rPct(v)}`;
    case 'F3': return `60 日年化波動 ${fmtNum(v * 100, 1)}%・門檻 ${f.thr === null ? '—' : `${fmtNum(f.thr * 100, 1)}%`}`;
    case 'F4': return `近 12 個月 ${rPct(v)}`;
    case 'F5': return `${fmtNum(v * 100, 0)}% 的股票在 60 日線上`;
    case 'F6': return `0050 − 等權近 3 個月 ${rPct(v)}`;
    default: return String(v);
  }
}

export function RegimeSection({ latest }: { latest: Latest }) {
  const g = latest.regime;
  if (!g) {
    return (
      <Section title="動能環境" testid="mf-regime" info={<><p>{HELP.regime.what}</p><p>{HELP.regime.why}</p></>} infoTitle="動能環境">
        <Interp testid="mf-regime-empty">動能環境資料累積中（下一次每日更新後出現）</Interp>
      </Section>
    );
  }
  const primary = g.flags.filter((f) => f.primary);
  const diag = g.flags.filter((f) => !f.primary);
  const state = latest.market.exposure;
  const both = g.cap === null || state === null ? null : Math.min(g.cap, state);
  return (
    <Section title="動能環境" aside={g.since ? `自 ${md(g.since)}` : undefined} testid="mf-regime"
      info={<><p>{HELP.regime.what}</p><p>{HELP.regime.why}</p></>} infoTitle="動能環境">
      <Conclusion testid="mf-regime-concl">{g.label === null ? '動能環境資料不足' : `${g.label}（${g.score}／3）`}</Conclusion>
      <Interp>{both === null
        ? '只供參考，不改變上方狀態機的曝險上限；歷史統計見「紀錄 › 環境」。'
        : `只供參考，不改變上方的曝險上限；若兩者取低，曝險上限是 ${Math.round(both * 100)}%。歷史統計見「紀錄 › 環境」。`}</Interp>
      <List label="主要條件" testid="mf-regime-primary">
        {primary.map((f) => (
          <Row key={f.k} label={<span class="mf-k-head">{f.k} {f.label}</span>} sub={flagValue(f)} value={<TriText v={f.res} />} testid={`mf-regime-${f.k}`} />
        ))}
      </List>
      <p class="ui-foot ui-muted mf-note">參考（不計分）</p>
      <List label="參考條件" testid="mf-regime-diag">
        {diag.map((f) => (
          <Row key={f.k} label={<span class="mf-k-head">{f.k} {f.label}</span>} sub={flagValue(f)} value={<TriText v={f.res} />} testid={`mf-regime-${f.k}`} />
        ))}
      </List>
      <Interp testid="mf-regime-year">{`近一年：順風 ${g.year.tailwind} 日・中性 ${g.year.neutral} 日・逆風 ${g.year.headwind} 日`}</Interp>
    </Section>
  );
}
