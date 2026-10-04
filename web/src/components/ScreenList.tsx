/**
 * 篩出清單（M4 選股頁、M5 策略頁「標的」共用）：每列＝名稱與代號｜細產業｜觸發的策略與分級標籤｜
 * 觸發日與「第 k 日」（篩出才有）｜價格與漲跌｜觸發以來報酬。可依細產業分組；點列進個股頁（左右滑動換股的清單＝這份清單）。
 */
import { useMemo } from 'preact/hooks';
import { GradeTag } from './StrategyBits';
import { Signed } from './ui';
import { ChangePill } from './Change';
import { useAsync } from '../hooks';
import { useScoredSummary } from '../data/useSummary';
import { loadSectors } from '../data/api';
import type { ScreenItem } from '../lib/screen';
import { setListContext } from '../lib/listContext';
import { fmtPrice } from '../lib/format';
import { tradeStatusLabel } from '../lib/tradeStatus';
import '../styles/screener.css';

const md = (iso: string) => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`;

export function ScreenList({ items, view, group = false, context, showTags = true }: {
  items: ScreenItem[];
  view: 'new' | 'all';
  group?: boolean;
  /** 個股頁左右換股的清單名稱 */
  context: string;
  /** 策略頁只有一個策略：不重複列策略標籤 */
  showTags?: boolean;
}) {
  const summary = useScoredSummary();
  const sectors = useAsync(() => loadSectors().catch(() => null), []);
  const byCode = summary.data?.byCode;
  const groupName = (code: string): { id: string; name: string } | null => {
    const fid = sectors.data?.stocks[code]?.[0]?.[0];
    const g = fid ? sectors.data?.groups.find((x) => x.id === fid) : null;
    return g ? { id: g.id, name: g.name } : null;
  };
  const codes = items.map((i) => i.code);
  const sections = useMemo(() => {
    if (!group) return [{ key: 'all', name: '', items }];
    const m = new Map<string, { key: string; name: string; items: ScreenItem[] }>();
    for (const it of items) {
      const g = groupName(it.code);
      const k = g?.id ?? 'x';
      if (!m.has(k)) m.set(k, { key: k, name: g?.name ?? '未分類', items: [] });
      m.get(k)!.items.push(it);
    }
    return [...m.values()].sort((a, b) => b.items.length - a.items.length || a.name.localeCompare(b.name, 'zh-Hant'));
  }, [items, group, sectors.data]);
  return (
    <>
      {sections.map((sec) => (
        <div key={sec.key} class="scr-sec" data-testid={group ? `scr-group-${sec.key}` : undefined}>
          {sec.name ? <p class="scr-group-h"><a href={`#/explore/sectors/${encodeURIComponent(sec.key)}`}>{sec.name}</a><span class="ui-muted">・{sec.items.length} 檔</span></p> : null}
          <div class="ui-list" data-testid="screen-rows">
            {sec.items.map((it) => {
              const r = byCode?.get(it.code);
              const g = groupName(it.code);
              const first = it.hits[0];
              return (
                <a key={it.code} class="scr-row" href={`#/stock/${it.code}`} onClick={() => setListContext({ name: context, codes })} data-testid={`scr-${it.code}`}>
                  <span class="scr-l">
                    <span class="scr-name">{(r?.name as string) ?? it.code} <span class="ui-muted ui-foot">{it.code}</span></span>
                    <span class="scr-sub">{g?.name ?? '—'}</span>
                    {showTags ? <span class="scr-tags">{it.hits.map((h) => <span key={h.id} class="scr-tag"><span class="scr-tag-n">{h.label}</span><GradeTag grade={h.grade} /></span>)}</span> : null}
                    {view === 'all' ? <span class="scr-sub">{md(first.trigger)} 觸發・第 {first.day} 日</span> : null}
                  </span>
                  <span class="scr-r">
                    <span class="scr-price">{r ? fmtPrice(r.close) : '—'}</span>
                    {r ? <ChangePill change={r.change} pct={r.change_pct} status={tradeStatusLabel(r)} /> : null}
                    {view === 'all' ? <span class="scr-ret"><span class="ui-muted">觸發以來</span> <Signed v={first.ret} digits={1} unit="%" /></span> : null}
                  </span>
                </a>
              );
            })}
          </div>
        </div>
      ))}
    </>
  );
}
