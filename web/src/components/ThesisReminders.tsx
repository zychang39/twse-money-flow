/**
 * 論點提醒（研究筆記，2026-11）：簡報「我的」分段與筆記清單共用。
 * 只有在有事時才畫出來——研究筆記裡的推翻條件已經成立（風險，琥珀色），或驗證事件在 3 個交易日內（一般文字）。
 * 沒有筆記、或沒有到期的事 → 不佔版面（回傳 null）。判定在 lib/thesis.reminders（純函式）。
 */
import { useMemo } from 'preact/hooks';
import { List, Row, Section, Tag } from './ui';
import { Conclusion } from './kit';
import { useAsync, useDb } from '../hooks';
import { loadMeta } from '../data/api';
import type { StockRow } from '../data/types';
import { listTheses } from '../db/db';
import { makeCalendar, type TradingCalendar } from '../lib/tradingCalendar';
import { todayTpe } from '../lib/dates';
import { REMIND_TRADING_DAYS, normThesis, reminders, type Reminder } from '../lib/thesis';

export function useCalendar(): TradingCalendar {
  const meta = useAsync(loadMeta, []);
  return useMemo(() => makeCalendar(meta.data?.calendar), [meta.data]);
}

/** 一列提醒。showName：清單用（股票名稱＋內容，點了開筆記）；筆記裡只列內容 */
export function ReminderRow({ r, showName }: { r: Reminder; showName: boolean }) {
  const risk = r.kind === 'breaker';
  const when = <span class={risk ? 'risk' : 'ui-muted'}>{r.when}</span>;
  // 筆記裡：內容一行、時間放副資訊（事件名稱不會被右邊的欄位擠成兩行）；推翻條件的現值留在右側
  if (!showName) {
    return <Row label={r.text} sub={risk ? undefined : r.when} value={risk ? when : undefined} tag={risk ? <Tag tone="risk">已觸發</Tag> : null} testid={`th-due-${r.kind}`} />;
  }
  // 清單：內容與時間（或現值）合成一行副資訊；琥珀只留給「已觸發」標籤（2026-11-16 審查：一件事不亮兩個琥珀）
  return (
    <Row label={<>{r.name}<span class="ui-muted"> {r.code}</span></>} sub={risk ? `${r.text}・現在 ${r.when}` : `${r.text}・${r.when}`} subWide tag={risk ? <Tag tone="risk">已觸發</Tag> : null}
      href={`#/discipline/thesis/${r.code}`} testid={`th-due-${r.kind}`} />
  );
}

export function ThesisReminders({ byCode, testid = 'thesis-reminders' }: { byCode: Map<string, StockRow> | undefined; testid?: string }) {
  const theses = useDb(listTheses);
  const cal = useCalendar();
  const today = todayTpe();
  const due = useMemo(() => (theses && byCode ? reminders(theses.map(normThesis), byCode, today, cal) : []), [theses, byCode, today, cal]);
  if (!due.length) return null;
  const broken = due.filter((d) => d.kind === 'breaker').length, soon = due.length - broken;
  return (
    <Section title="論點提醒" testid={testid}
      info={<p>只在有事時出現：研究筆記裡的推翻條件已經成立，或驗證事件在 {REMIND_TRADING_DAYS} 個交易日內。打開筆記按「已回頭看過」之後，同一件事不再提醒。依你自己寫的條件判定，不是系統的判斷。</p>}>
      <Conclusion>{[broken ? `${broken} 件碰到推翻條件` : '', soon ? `${soon} 件驗證事件快到了` : ''].filter(Boolean).join('、')}</Conclusion>
      <List tags chev>{due.map((r) => <ReminderRow key={r.code + r.key} r={r} showName />)}</List>
    </Section>
  );
}
