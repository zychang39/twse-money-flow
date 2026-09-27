/**
 * 多空對照（#/stock/:code/bullbear）：基本面、籌碼面、量價面、技術面的規則式條件，多方與空方並排比較。
 * - 上方：多方／中性／空方的項數比例條＋結論句（只做條件統計）。
 * - 每個面向一張卡：左欄多方、右欄空方；沒有觸發的條件收在「中性與資料不足」。
 * 定義與門檻見 METHODOLOGY §4.9、config/ui.yml bull_bear；設計紀錄見 docs/design/ROUND3.md。
 */
import { useMemo, useState } from 'preact/hooks';
import { StockToolFrame, useStock } from '../components/StockTool';
import { BullBearBar } from '../components/BullBearBar';
import { CATS, CAT_NAME, type Cat, type Check, evaluate, summary, tally, title } from '../lib/bullbear';
import { glueNumbers } from '../lib/format';
import '../styles/tools.css';

function Item({ c }: { c: Check }) {
  return (
    <li class="bb-item">
      <span class="caption muted bb-name">{c.name}</span>
      <span class="bb-text">{glueNumbers(c.text)}</span>
    </li>
  );
}

export default function BullBear({ code }: { code: string }) {
  const s = useStock(code);
  const h = s.data;
  const checks = useMemo(() => (h ? evaluate(h) : []), [h]);
  const t = tally(checks);
  const [only, setOnly] = useState<Cat | 'all'>('all');
  const cats = only === 'all' ? CATS : [only];

  return (
    <StockToolFrame code={code} h={h} loading={s.loading} error={s.error} tool="多空對照" title={title(t)}>
      <p class="body ir-sentence" data-testid="bb-sentence">{glueNumbers(summary(checks))}。</p>
      <BullBearBar t={t} />
      <div class="segmented ir-tabs" role="group" aria-label="面向">
        <button aria-pressed={only === 'all'} onClick={() => setOnly('all')}>全部</button>
        {CATS.map((c) => <button key={c} aria-pressed={only === c} onClick={() => setOnly(c)}>{CAT_NAME[c]}</button>)}
      </div>

      {cats.map((cat) => {
        const list = checks.filter((c) => c.cat === cat);
        const bull = list.filter((c) => c.side === 'bull');
        const bear = list.filter((c) => c.side === 'bear');
        const rest = list.filter((c) => c.side === 'neutral' || c.side === 'na');
        return (
          <section key={cat} class="ir-card bb-card" aria-labelledby={`bb-${cat}`}>
            <div class="ir-card-head">
              <h2 class="body w6" id={`bb-${cat}`}>{CAT_NAME[cat]}</h2>
              <span class="caption"><span class="up">▲{bull.length}</span>{' '}<span class="down">▼{bear.length}</span><span class="sr-only">：多方 {bull.length} 項、空方 {bear.length} 項</span></span>
            </div>
            <div class="bb-cols">
              <div class="bb-col" aria-label={`${CAT_NAME[cat]}多方`} role="group">
                <h3 class="caption w6 up bb-col-head">▲ 多方</h3>
                {bull.length ? <ul class="bb-list">{bull.map((c) => <Item key={c.id} c={c} />)}</ul> : <p class="caption muted">沒有</p>}
              </div>
              <div class="bb-col" aria-label={`${CAT_NAME[cat]}空方`} role="group">
                <h3 class="caption w6 down bb-col-head">▼ 空方</h3>
                {bear.length ? <ul class="bb-list">{bear.map((c) => <Item key={c.id} c={c} />)}</ul> : <p class="caption muted">沒有</p>}
              </div>
            </div>
            {rest.length ? (
              <details class="tech bb-rest">
                <summary>中性與資料不足（{rest.length} 項）</summary>
                <ul class="bb-list">
                  {rest.map((c) => (
                    <li key={c.id} class="bb-item">
                      <span class="caption muted bb-name">{c.name}{c.side === 'na' ? '・資料不足' : ''}</span>
                      <span class="bb-text">{glueNumbers(c.text)}</span>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </section>
        );
      })}

      <details class="tech cd-notes">
        <summary>規則與限制</summary>
        <p class="caption muted">
          每一項條件的門檻固定（見方法論與 config/ui.yml），權重相同；多方＝偏多的依據，空方＝需要留意的依據。
          項數多寡只是條件統計，不代表上漲或下跌的機率，同一件事也可能同時出現在兩邊（例：營收成長但本益比偏高）。
          技術面使用還原收盤價；籌碼與基本面使用最新一個交易日（或最新一期）的資料。
        </p>
        <p class="caption"><a href="#/me/methodology">查看方法論</a></p>
      </details>
    </StockToolFrame>
  );
}
