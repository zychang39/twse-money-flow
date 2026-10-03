/**
 * 個股工具頁（法人買賣超報表、大戶／散戶持股、多空對照）共用的外框：返回個股頁、代號與名稱、載入與錯誤狀態。
 */
import type { ComponentChildren } from 'preact';
import { Ambient, TopBar } from './Chrome';
import { ErrorState, Loading } from './DataStatus';
import { PageTitle } from './ui';
import '../styles/stock.css';
import { useAsync } from '../hooks';
import { loadStock } from '../data/api';
import type { StockHistory } from '../data/types';

export function useStock(code: string) {
  return useAsync(() => loadStock(code), [code]);
}

export function StockToolFrame({ code, h, loading, error, tool, title, actions, children }: {
  code: string;
  h: StockHistory | null | undefined;
  loading: boolean;
  error: Error | null | undefined;
  /** 工具名稱（頁面標題，名詞） */
  tool: string;
  /** 數字結論（標題下一行 Footnote） */
  title: ComponentChildren;
  actions?: ComponentChildren;
  children?: ComponentChildren;
}) {
  return (
    <div class="page tool-page">
      <Ambient mood="neutral" />
      <TopBar back={`/stock/${code}`} avatar={false} caption={h ? `${h.name} ${code}` : code} actions={actions} />
      {/* 2026-10 改版：標題用名詞（工具名稱，LargeTitle）；股票名稱與代號為副資訊；數字結論一行 Footnote */}
      <PageTitle title={tool} sub={h ? `${h.name}・${code}` : code} />
      {h && title ? <p class="ui-foot tool-summary" data-testid="tool-summary">{title}</p> : null}
      {error ? <ErrorState error={error} title="找不到這檔股票的資料" /> : null}
      {loading && !h ? <Loading hero /> : null}
      {h ? children : null}
    </div>
  );
}
