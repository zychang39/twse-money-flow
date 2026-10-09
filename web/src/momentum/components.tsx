/** 動能流程頁面共用的小元件：說明 ⓘ、三態文字。 */
import { Info } from '../components/ui';
import type { Tri } from './data';
import { HELP } from './help';

const TRI_TEXT: Record<Tri, string> = { 1: '符合', 0: '未符合', '-1': '資料不足' };
const TRI_CLASS: Record<Tri, string> = { 1: 'pass', 0: 'fail', '-1': 'na' };

export function Help({ id }: { id: string }) {
  const h = HELP[id];
  if (!h) return null;
  return <Info title={h.title}><p><strong>定義</strong>：{h.what}</p><p><strong>為什麼檢查</strong>：{h.why}</p></Info>;
}

export function TriText({ v }: { v: Tri }) {
  return <span class={`mf-tri ${TRI_CLASS[v]}`}>{TRI_TEXT[v]}</span>;
}
