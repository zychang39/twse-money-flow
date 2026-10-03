/**
 * 個股頁「策略訊號」（2026-10-03 改版）。
 *
 * 用法（個股頁只要放一行，區塊標題與 ⓘ 由這個元件自己畫）：
 *   <SignalPanel code={code} />
 * 會輸出 `<Section title="策略訊號" info={…}>` ＋ 一張 List；每個上架策略（分級不是無效）一列：
 *   名稱＋單一分級標籤｜副資訊「0050 +1.24%（t 1.30）｜等權 +1.68%（t 3.43）」（40 日扣成本超額與校正後 t）｜
 *   右側「觸發 9/10」（近 40 個交易日內最近一次觸發）或「未觸發」。
 * 說明（兩個基準、t 的定義、分級、觸發視窗）都在 ⓘ；不使用買賣字眼，狀態只描述條件是否成立。
 */
import { EmptyRow, List, Row, Section } from './ui';
import { GradeTag, JudgeInfo } from './StrategyBits';
import { useAsync } from '../hooks';
import { loadJson } from '../data/api';
import { type SignalItem, useSignalPanel } from '../lib/signalSummary';
import type { StrategiesFile } from '../lib/strategies';
import { md, pctSigned, tText } from '../lib/format';

/** 「0050 +1.24%(t 1.30)｜等權 +1.68%(t 3.43)」：與數字相鄰的括號用半形，整句一行。 */
export function signalSub(it: Pick<SignalItem, 'opp' | 'ew'>): string {
  return `0050 ${pctSigned(it.opp.excess)}(t ${tText(it.opp.t)})｜等權 ${pctSigned(it.ew.excess)}(t ${tText(it.ew.t)})`;
}

export function SignalPanel({ code }: { code: string }) {
  const d = useSignalPanel(code);
  const meta = useAsync(() => loadJson<StrategiesFile>('strategies.json').catch(() => null), []);
  const file = meta.data ?? undefined;
  const win = d.data?.window ?? 40;
  const horizon = d.data?.horizon ?? 40;
  const info = (
    <>
      <p>每個上架策略（分級不是無效）一列。右側為這一檔近 {win} 個交易日內最近一次符合條件的日期；沒有則為「未觸發」。</p>
      <p>副資訊為策略的歷史 {horizon} 日扣成本超額（相對 0050 含息、相對同日等權）與校正後 t，不是這一檔的預估。</p>
      <JudgeInfo meta={file?.judge_meta} multi={file?.multi_test} />
    </>
  );
  return (
    <Section title="策略訊號" info={info} testid="signal-panel" aside={d.data ? d.data.summary : undefined}>
      {d.loading ? <List><EmptyRow>載入中</EmptyRow></List> : null}
      {!d.loading && (d.error || !d.data) ? <List><EmptyRow>策略資料暫時無法取得</EmptyRow></List> : null}
      {d.data ? (
        <List>
          {d.data.items.length ? d.data.items.map((it) => (
            <Row
              key={it.id}
              testid={`signal-${it.id}`}
              label={<>{it.label}<GradeTag grade={it.grade} /></>}
              sub={signalSub(it)}
              value={it.date ? `觸發 ${md(it.date)}` : '未觸發'}
            />
          )) : <EmptyRow>無上架策略</EmptyRow>}
        </List>
      ) : null}
    </Section>
  );
}
