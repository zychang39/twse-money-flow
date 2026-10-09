/** 主動式 ETF 的策略標籤（config/active_etf.yml）：小膠囊；詞彙定義給 ⓘ 用。 */
import { etfTags, TAG_DEFS } from '../lib/etfTags';

export function EtfTagPills({ code, testid }: { code: string; testid?: string }) {
  const tags = etfTags(code);
  if (!tags.length) return null;
  return (
    <span class="etf-tags" data-testid={testid}>
      {tags.map((t) => <span key={t} class="etf-tag">{t}</span>)}
    </span>
  );
}

/** ⓘ 內的詞彙定義：「大型股＝…；動能＝…」 */
export function TagDefs() {
  return <p>標籤：{Object.entries(TAG_DEFS).map(([k, v]) => `${k}＝${v}`).join('；')}。</p>;
}
