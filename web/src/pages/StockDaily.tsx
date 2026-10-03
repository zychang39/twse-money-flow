/** 個股每日明細子頁（SPEC §5【籌碼】）：法人｜信用｜借券當沖，期間切換（ChipDaily）。sticky 表頭在導覽列之下，不遮住資料列。 */
import { TopBar } from '../components/Chrome';
import { ErrorState, Loading } from '../components/DataStatus';
import { EmptyRow, List, PageTitle } from '../components/ui';
import { lazyPick } from '../lazy';
import { useStockData } from '../hooks';
import type { ChipBlock } from '../lib/chips';

const ChipDaily = lazyPick(() => import('../components/Chips'), 'ChipDaily');

export default function StockDaily({ code }: { code: string }) {
  const { data: h, error } = useStockData(code);
  const chip = (h?.chip as ChipBlock | null | undefined) ?? null;
  return (
    <div class="page">
      <TopBar back={`/stock/${code}`} avatar={false} caption={h ? `${h.name} ${code}` : code} />
      <PageTitle title="每日明細" sub={h ? `${h.name}・${code}` : code} />
      {error ? <ErrorState error={error} title="這檔股票的資料暫時無法取得" /> : !h ? <Loading /> : chip ? (
        <ChipDaily block={chip} code={code} name={h.name} market={h.market} />
      ) : <List><EmptyRow>資料累積中：需要至少 2 個交易日的法人與融資融券資料</EmptyRow></List>}
    </div>
  );
}
