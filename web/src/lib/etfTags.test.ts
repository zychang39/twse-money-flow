import { describe, expect, it } from 'vitest';
import { activeEtfConfig, etfStrategy, etfTags, sourceHost, TAG_DEFS, validateActiveEtfConfig } from './etfTags';

describe('主動式 ETF 策略標籤（config/active_etf.yml）', () => {
  it('設定檔通過檢查：1～3 個標籤、都在詞彙表、摘要 ≤ 60 字、https 來源', () => {
    expect(validateActiveEtfConfig()).toEqual([]);
    expect(Object.keys(activeEtfConfig.etfs).length).toBeGreaterThanOrEqual(32);
  });

  it('每個詞彙至少被一檔使用（沒有多餘的詞）', () => {
    const used = new Set(Object.values(activeEtfConfig.etfs).flatMap((e) => e.tags));
    for (const t of Object.keys(TAG_DEFS)) expect(used.has(t), `「${t}」沒有 ETF 使用`).toBe(true);
  });

  it('標籤與摘要不用買賣字眼', () => {
    for (const [code, e] of Object.entries(activeEtfConfig.etfs)) {
      expect(`${e.tags.join('')}${e.strategy}`, code).not.toMatch(/買進|賣出/);
    }
  });

  it('查詢：00981A 為大型股、成長；沒有設定的代號回空', () => {
    expect(etfTags('00981A')[0]).toBe('大型股');
    expect(etfStrategy('00981A')?.source_kind).toBe('證交所');
    expect(etfTags('00000A')).toEqual([]);
    expect(etfStrategy('00000A')).toBeNull();
    expect(sourceHost('https://www.twse.com.tw/zh/ETFortune/etfInfo/00981A')).toBe('www.twse.com.tw');
  });

  it('驗證會指出錯誤', () => {
    const errors = validateActiveEtfConfig({
      version: 1,
      tags: { 動能: '依動能' },
      etfs: {
        '00001A': { tags: [], strategy: 'x', source: 'https://a', source_kind: '官網' },
        '00002A': { tags: ['動能', '不存在'], strategy: 'x'.repeat(61), source: 'http://a', source_kind: '部落格' },
      },
    });
    expect(errors).toEqual([
      '00001A：標籤要 1～3 個',
      '00002A：標籤「不存在」不在詞彙表',
      '00002A：摘要超過 60 字（61）',
      '00002A：來源要是 https 網址',
      '00002A：來源種類「部落格」',
    ]);
  });
});
