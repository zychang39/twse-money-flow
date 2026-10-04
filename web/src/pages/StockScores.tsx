/** 個股分數明細（M3）：#/stock/{code}/scores。四個分項分數的因子與子分數；由 ⋯ 選單進入。 */
import { TopBar } from '../components/Chrome';
import { ErrorState, Loading } from '../components/DataStatus';
import { ScoreDetailView } from '../components/ScoreDetail';
import { EmptyRow, List, PageTitle } from '../components/ui';
import { useStockData } from '../hooks';

export default function StockScores({ code }: { code: string }) {
  const { data: h, error } = useStockData(code);
  return (
    <div class="page">
      <TopBar back={`/stock/${code}`} avatar={false} caption={h ? `${h.name} ${code}` : code} />
      <PageTitle title="分數明細" sub={h ? `${h.name}・${code}` : code} />
      {error ? <ErrorState error={error} title="這檔股票的資料暫時無法取得" /> : !h ? <Loading />
        : h.scores ? <ScoreDetailView detail={h.scores} /> : <List><EmptyRow>沒有分數明細</EmptyRow></List>}
    </div>
  );
}
