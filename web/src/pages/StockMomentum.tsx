/**
 * 個股動能詳情頁（M3）：#/stock/{code}/m/{returns|sector|trend|position|risk}。
 * 由動能分段的摘要卡推入（共用元素過渡：標題與數值）；返回回到動能分段的同一位置。
 */
import { TopBar } from '../components/Chrome';
import { ErrorState, Loading } from '../components/DataStatus';
import { MOM_TITLE, MomentumDetail, type MomCard } from '../components/stock/Momentum';
import { PageTitle } from '../components/ui';
import { useDb, useStockData } from '../hooks';
import { getSetting } from '../db/db';
import { DEFAULT_PORTFOLIO, type PortfolioSettings } from '../lib/settings';
import '../styles/stock.css';

const CARDS = Object.keys(MOM_TITLE) as MomCard[];

export default function StockMomentum({ code, card }: { code: string; card: string }) {
  const { data: h, error } = useStockData(code);
  const prefs = useDb(() => getSetting<PortfolioSettings>('portfolio', DEFAULT_PORTFOLIO)) ?? DEFAULT_PORTFOLIO;
  const c: MomCard = CARDS.includes(card as MomCard) ? (card as MomCard) : 'returns';
  return (
    <div class="page">
      <TopBar back={`/stock/${code}?seg=m`} avatar={false} caption={h ? `${h.name} ${code}` : code} />
      <PageTitle title={MOM_TITLE[c]} sub={h ? `${h.name}・${code}` : code} />
      {error ? <ErrorState error={error} title="這檔股票的資料暫時無法取得" /> : !h ? <Loading /> : <MomentumDetail h={h} card={c} prefs={prefs} />}
    </div>
  );
}
