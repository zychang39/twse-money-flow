/** 個股籌碼詳情頁（M3）：#/stock/{code}/c/{qfii|etf}。由籌碼分段的摘要卡推入。 */
import { TopBar } from '../components/Chrome';
import { ErrorState, Loading } from '../components/DataStatus';
import { CHIP_TITLE, ChipDetail, type ChipCard } from '../components/stock/Chips';
import { PageTitle } from '../components/ui';
import { useStockData } from '../hooks';

export default function StockChipDetail({ code, card }: { code: string; card: string }) {
  const { data: h, error } = useStockData(code);
  const c: ChipCard = card === 'etf' ? 'etf' : 'qfii';
  return (
    <div class="page">
      <TopBar back={`/stock/${code}?seg=c`} avatar={false} caption={h ? `${h.name} ${code}` : code} />
      <PageTitle title={CHIP_TITLE[c]} sub={h ? `${h.name}・${code}` : code} />
      {error ? <ErrorState error={error} title="這檔股票的資料暫時無法取得" /> : !h ? <Loading /> : <ChipDetail h={h} card={c} />}
    </div>
  );
}
