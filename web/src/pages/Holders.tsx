/**
 * 籌碼結構・15 級完整分布（#/stock/:code/holders）：集保股權分散表。
 * v3：全站統一分級（config/ui.yml holders.tiers：散戶 ≤ 5 張｜中實戶｜大戶 ≥ 400 張｜千張大戶 ≥ 1,000 張），
 * 移除可調門檻（舊版預設與常用組合不一致，圖表曾出現「大戶（超過 100 張）」）。
 * - 一句話結論＋堆疊比例條（每段本週變化）
 * - 走勢：比例｜人數｜人均張數；3 個月｜6 個月｜1 年（資料不足時單點＋說明）
 * - 最新一週的 15 級分布，依四段分組，列出與所選基準週相比的變化。
 * 定義見 METHODOLOGY §4.7.3。
 */
import { useMemo, useState } from 'preact/hooks';
import { Banner } from '../components/DataStatus';
import { HOLDER_PERIODS, HolderTrend, StructureBar } from '../components/Structure';
import { StockToolFrame, useStock } from '../components/StockTool';
import { IconSeed } from '../components/Icons';
import { glueNumbers, numberFormat } from '../lib/format';
import {
  type HolderBlock,
  LEVEL_LABEL,
  LEVEL_SHORT,
  tierName,
  tierOrder,
  metricText,
  structureSentence,
  tierDefinition,
  tierOf,
  tierRange,
  tierWeek,
} from '../lib/holders';
import '../styles/tools.css';

const F2 = numberFormat(2);
const INT = numberFormat(0);

function signedPp(d: number | null) {
  if (d === null) return { text: '—', cls: '' };
  const dir = d > 0.005 ? 'up' : d < -0.005 ? 'down' : '';
  return { text: `${dir === 'up' ? '▲' : dir === 'down' ? '▼' : ''}${F2.format(Math.abs(d))}`, cls: dir };
}

export default function Holders({ code }: { code: string }) {
  const s = useStock(code);
  const h = s.data;
  const block = (h?.holders as HolderBlock | null | undefined) ?? null;
  const [base, setBase] = useState<number>(13);
  const n = block?.d.length ?? 0;
  const latest = n - 1;
  const first = Math.max(0, n - Math.min(base, n));
  const now = useMemo(() => (block && n ? tierWeek(block, latest) : null), [block, latest]);
  const then = useMemo(() => (block && n ? tierWeek(block, first) : null), [block, first]);
  const title = !block || !n ? '集保資料累積中' : structureSentence(block);

  return (
    <StockToolFrame code={code} h={h} loading={s.loading} error={s.error} tool="籌碼結構" title={title}>
      {!block || !n ? (
        <Banner icon={<IconSeed />} title="集保股權分散表資料累積中">
          集保開放資料每週只提供最新一週，本 App 每週六起逐週累積；過去一年的資料由「集保個股歷史」回補（關注清單內的股票）。
        </Banner>
      ) : (
        <>
          <p class="caption muted" data-testid="hd-definition">分級：{tierDefinition()}。回測與選股固定使用 1,000 張。</p>
          <StructureBar block={block} />
          <HolderTrend block={block} d={h!.d} c={h!.c as (number | null)[]} name={h?.name ?? code} />

          {/* 15 級分布（最新一週），依四段分組 */}
          <div class="ir-table-head">
            <h2 class="section ir-h2">15 級分布</h2>
            <span class="caption muted">{block.d[latest]}</span>
          </div>
          <div class="segmented ir-months" role="group" aria-label="比較基準">
            {HOLDER_PERIODS.map((p) => <button key={p.weeks} aria-pressed={p.weeks === base} onClick={() => setBase(p.weeks)}>{p.label}前</button>)}
          </div>
          <p class="caption muted" data-testid="hd-basis">{glueNumbers(n < 2 ? '目前只有 1 週資料，無法比較變化' : `變化：與 ${latest - first} 週前（${block.d[first].slice(5).replace('-', '/')}）相比，單位為百分點`)}</p>
          <div class="cd-wrap ir-wrap">
            <table class="cd-table hd-table" style={{ ['--dt' as string]: 1 }}>
              <colgroup><col class="hd-col-level" /><col /><col /><col /></colgroup>
              <thead>
                <tr><th scope="col" class="cd-dh">持股分級（張）</th><th scope="col"><span class="cd-h">人數</span></th><th scope="col"><span class="cd-h">比例</span></th><th scope="col"><span class="cd-h">變化</span></th></tr>
              </thead>
              {tierOrder().map((t) => {
                const levels = Array.from({ length: 15 }, (_, i) => i + 1).filter((lv) => tierOf(lv) === t);
                const a = now![t];
                const b = then![t];
                const sd = signedPp(n >= 2 && a.pct !== null && b.pct !== null ? a.pct - b.pct : null);
                return (
                  <tbody key={t} class={`hd-sec ${t}`}>
                    <tr class="total">
                      <th scope="rowgroup"><span class="cd-date">{tierName(t)}</span><span class="cd-sub">{tierRange(t)}</span></th>
                      <td class="cd-v">{metricText(a.holders, 'holders').replace(' 人', '')}</td>
                      <td class="cd-v">{a.pct === null ? '—' : `${F2.format(a.pct)}%`}</td>
                      <td class={`cd-v ${sd.cls}`}>{sd.text}</td>
                    </tr>
                    {levels.map((lv) => {
                      const p = block.p[lv - 1][latest];
                      const p0 = block.p[lv - 1][first];
                      const dd = signedPp(n >= 2 && p !== null && p0 !== null ? p - p0 : null);
                      const holders = block.n[lv - 1][latest];
                      return (
                        <tr key={lv} class="hd-level">
                          <th scope="row"><span class="hd-level-label" aria-hidden="true">{LEVEL_SHORT[lv - 1]}</span><span class="sr-only">{LEVEL_LABEL[lv - 1]}</span></th>
                          <td class="cd-v">{holders === null ? '—' : INT.format(holders)}</td>
                          <td class="cd-v">{p === null ? '—' : `${F2.format(p)}%`}</td>
                          <td class={`cd-v ${dd.cls}`}>{dd.text}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                );
              })}
            </table>
          </div>

          <details class="tech cd-notes">
            <summary>計算方式與資料來源</summary>
            <p class="caption muted">
              集保股權分散表依「每週最後一個營業日」各集保戶的持股歸戶後分 15 級。四段（全站統一）：散戶＝分級 1–2（≤ 5 張，含零股）、中實戶＝分級 3–11、大戶＝分級 12–15（集保邊界為 400,001 股起，含千張大戶）、千張大戶＝分級 15（1,000,001 股起）；比例條上的「大戶」段不含千張大戶，四段加總為 100%。
              比例＝占集保庫存數的比例（%）；人均張數＝該段持股股數 ÷ 人數 ÷ 1,000。同一人以同一身分證歸戶，但法人、信託、外資託管帳戶各自計算，千張大戶不等於單一主力。
            </p>
            <p class="caption muted">資料來源：臺灣集中保管結算所「集保戶股權分散表」（開放資料每週最新一週；過去一年為個股歷史查詢），依政府資料開放授權條款使用。</p>
          </details>
        </>
      )}
    </StockToolFrame>
  );
}
