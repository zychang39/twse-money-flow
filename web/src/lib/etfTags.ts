/**
 * 主動式 ETF 的投資策略標籤（2026-10-09；config/active_etf.yml，build 時嵌入）。
 * 標籤依各投信官網、公開說明書或證交所 ETF 資訊站的投資策略文字歸納，只描述選股方式與範圍（依規則整理、非推薦）。
 * 純資料讀取與驗證（etfTags.test.ts 檢查設定檔）。
 */
import activeEtfYml from '../../../config/active_etf.yml';

export interface EtfStrategy {
  /** 1～3 個標籤，第一個為主要特徵；詞彙限 TAG_DEFS */
  tags: string[];
  /** 一句摘要（最多 60 字） */
  strategy: string;
  /** 依據網址 */
  source: string;
  /** 官網｜公開說明書｜證交所｜其他 */
  source_kind: string;
}
export interface ActiveEtfConfig { version: number; tags: Record<string, string>; etfs: Record<string, EtfStrategy> }

export const activeEtfConfig = activeEtfYml as ActiveEtfConfig;
/** 標籤詞彙與一句定義（ⓘ 說明用） */
export const TAG_DEFS: Record<string, string> = activeEtfConfig.tags;
export const SOURCE_KINDS = ['官網', '公開說明書', '證交所', '其他'] as const;

export function etfStrategy(code: string): EtfStrategy | null {
  return activeEtfConfig.etfs[code] ?? null;
}

export function etfTags(code: string): string[] {
  return etfStrategy(code)?.tags ?? [];
}

/** 依據網址的網域（詳細頁「依據：證交所（www.twse.com.tw）」）。 */
export function sourceHost(url: string): string {
  return url.replace(/^https?:\/\//, '').split('/')[0];
}

/** 設定檔檢查：每檔 1～3 個標籤、都在詞彙表內且不重複、摘要 ≤ 60 字、來源為 https 網址與已知種類。回傳錯誤清單。 */
export function validateActiveEtfConfig(c: ActiveEtfConfig = activeEtfConfig): string[] {
  const errors: string[] = [];
  const vocab = new Set(Object.keys(c.tags ?? {}));
  for (const [code, e] of Object.entries(c.etfs ?? {})) {
    if (!/^00\d{3,4}A$/.test(code)) errors.push(`${code}：代號格式`);
    if (!Array.isArray(e.tags) || e.tags.length < 1 || e.tags.length > 3) errors.push(`${code}：標籤要 1～3 個`);
    else {
      for (const t of e.tags) if (!vocab.has(t)) errors.push(`${code}：標籤「${t}」不在詞彙表`);
      if (new Set(e.tags).size !== e.tags.length) errors.push(`${code}：標籤重複`);
    }
    if (typeof e.strategy !== 'string' || !e.strategy.trim()) errors.push(`${code}：缺摘要`);
    else if ([...e.strategy].length > 60) errors.push(`${code}：摘要超過 60 字（${[...e.strategy].length}）`);
    if (typeof e.source !== 'string' || !/^https:\/\//.test(e.source)) errors.push(`${code}：來源要是 https 網址`);
    if (!(SOURCE_KINDS as readonly string[]).includes(e.source_kind)) errors.push(`${code}：來源種類「${e.source_kind}」`);
  }
  for (const [tag, def] of Object.entries(c.tags ?? {})) {
    if ([...tag].length > 4) errors.push(`標籤「${tag}」超過 4 字`);
    if (typeof def !== 'string' || !def.trim()) errors.push(`標籤「${tag}」缺定義`);
  }
  return errors;
}
