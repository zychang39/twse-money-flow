/**
 * 個股生意體質詳情頁（2026-11）：#/stock/{code}/q（?at=earn｜last｜pay 捲到對應區塊）。
 * 由基本面分段的「生意體質」三列推入；返回回到基本面分段。
 */
import { useEffect } from 'preact/hooks';
import { TopBar } from '../components/Chrome';
import { ErrorState, Loading } from '../components/DataStatus';
import { QualityDetail } from '../components/stock/Quality';
import { PageTitle } from '../components/ui';
import { useStockData } from '../hooks';
import '../styles/stock.css';

const AT = ['earn', 'last', 'pay'];

export default function StockQuality({ code }: { code: string }) {
  const { data: h, error } = useStockData(code);
  const at = typeof location !== 'undefined' ? /[?&]at=([a-z]+)/.exec(location.hash)?.[1] : undefined;
  useEffect(() => {
    if (!h || !at || !AT.includes(at)) return;
    document.getElementById(`q-${at}`)?.scrollIntoView({ block: 'start' });
  }, [h, at]);
  return (
    <div class="page">
      <TopBar back={`/stock/${code}?seg=f`} avatar={false} caption={h ? `${h.name} ${code}` : code} />
      <PageTitle title="生意體質" sub={h ? `${h.name}・${code}` : code} />
      {error ? <ErrorState error={error} title="這檔股票的資料暫時無法取得" /> : !h ? <Loading /> : <QualityDetail h={h} />}
    </div>
  );
}
