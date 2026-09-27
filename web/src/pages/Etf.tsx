/** 主動式 ETF：清單（依 20 日均成交值）與跨檔加碼／減碼排行（持股為部分涵蓋，如實標示來源與範圍）。 */
import { PageHead, TopBar } from '../components/Chrome';
import { Banner, DataStatus, ErrorState, Loading } from '../components/DataStatus';
import { Signed } from '../components/Change';
import { IconInfo } from '../components/Icons';
import { useAsync } from '../hooks';
import { loadMarket } from '../data/api';
import { setListContext } from '../lib/listContext';
import { fmtLots, fmtNum } from '../lib/format';
import { PAGE_SOURCES } from '../lib/health';

export default function Etf() {
  const market = useAsync(loadMarket, []);
  const m = market.data;
  const list = m?.active_etfs ?? [];
  return (
    <div class="page">
      <TopBar back="/explore" />
      <PageHead eyebrow="主動式 ETF" title={m ? `${list.length} 檔主動式 ETF` : '主動式 ETF'} />
      <DataStatus date={m?.date} uses={PAGE_SOURCES.etf} />
      {market.error ? <ErrorState error={market.error} /> : null}
      {market.loading ? <Loading /> : null}
      {m ? (
        <>
          {m.etf_ranking && m.etf_ranking.add.length ? (
            <div class="grid two" style={{ marginTop: 'var(--s-4)' }}>
              {(['add', 'reduce'] as const).map((k) => (
                <div class="card" key={k}>
                  <div class="body w6">{k === 'add' ? '跨檔加碼' : '跨檔減碼'}</div>
                  {m.etf_ranking![k].slice(0, 10).map((e) => (
                    <a key={e.code} class="row between caption" href={`#/stock/${e.code}`} style={{ minHeight: 'var(--tap)', color: 'inherit' }}>
                      <span>{e.name} <span class="muted">{e.code}</span></span>
                      <span>{e.etfs} 檔・<Signed value={e.net_shares / 1000} format={fmtLots} /> 張</span>
                    </a>
                  ))}
                </div>
              ))}
            </div>
          ) : (
            <Banner icon={<IconInfo />} title="持股變化：部分涵蓋">
              {m.etf_ranking?.status ?? '主動式 ETF 的每日持股只公布在各投信官網，尚未取得集中且可自動化的來源。清單與成交資訊照常顯示。'}
            </Banner>
          )}
          {m.etf_ranking?.coverage ? <p class="caption muted" style={{ marginTop: 'var(--s-2)' }}>{m.etf_ranking.coverage}{m.etf_ranking.date ? `（${m.etf_ranking.date}）` : ''}</p> : null}
          <div class="list" style={{ marginTop: 'var(--s-4)' }}>
            {list.map((e) => (
              <a key={e.code} class="list-item" href={`#/stock/${e.code}`} onClick={() => setListContext({ name: '主動式 ETF', codes: list.map((x) => x.code) })}>
                <span class="grow"><span class="body">{e.name}</span><span class="caption muted" style={{ display: 'block' }}>{e.code}</span></span>
                <span class="right"><span class="body" style={{ display: 'block' }}>{fmtNum(e.close, 2)}</span><span class="caption muted">20 日均 {e.value_million_20d === null ? '—' : `${fmtNum(e.value_million_20d, 0)} 百萬`}</span></span>
              </a>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
