/**
 * 資料健康的白話說明：一般使用者看到「發生什麼事、影不影響今天的畫面」，技術細節收在「詳細資訊」。
 * 頁首「N 個資料源異常」只在該頁實際用到的來源、而且影響最新資料時才顯示（見 PAGE_SOURCES）。
 */
import type { HealthSource } from '../data/types';
import { ASOF_LABEL, type Asof, type AsofKey } from './asof';
import { md, missing } from './format';

export type HealthTone = 'ok' | 'compat' | 'wait' | 'risk';

const SITE: Record<string, string> = {
  twse: '證交所',
  tpex: '櫃買中心',
  tdcc: '集保',
  taifex: '期交所',
  mops: '公開資訊觀測站',
  cbc: '中央銀行',
  us: '美國財政部',
  etf: '投信官網',
};

export function siteName(s: Pick<HealthSource, 'id' | 'market'>): string {
  const prefix = s.id.split('_')[0];
  return SITE[prefix] ?? SITE[s.market] ?? '資料來源';
}

const FORMAT_RE = /欄位|格式|不是 JSON|找不到/;
const NETWORK_RE = /阻擋|逾時|timeout|連線|HTTP|斷路|Circuit|SSL|reset/i;
/** E-09：被網站安全機制（WAF）阻擋不是格式變動；先於 FORMAT_RE 判斷 */
const BLOCK_RE = /阻擋|FOR SECURITY|WAF/i;

/** 一句白話＋狀態色調。只有「影響最新資料」的失敗與落後才用琥珀（risk）。 */
export function describeSource(s: HealthSource): { tone: HealthTone; text: string } {
  const site = siteName(s);
  const warnings = s.format_warnings ?? [];
  if (s.verified === 'pending') return { tone: 'wait', text: '資料源待處理，目前沒有可用的公開端點' };
  if (s.last_status === 'failed') {
    const msg = s.last_message ?? '';
    if (!s.affects_latest) {
      return { tone: 'compat', text: `回補較早的歷史資料時失敗，最新資料不受影響${FORMAT_RE.test(msg) ? `（${site}的舊資料格式不同）` : ''}` };
    }
    if (BLOCK_RE.test(msg)) return { tone: 'risk', text: `${site}暫時阻擋自動抓取，已放慢速度，下次排程會自動重試` };
    if (FORMAT_RE.test(msg)) return { tone: 'risk', text: `${site}調整了資料格式，暫時無法讀取，已通知修正` };
    if (NETWORK_RE.test(msg)) return { tone: 'risk', text: `${site}網站暫時連不上，下次排程會自動重試` };
    return { tone: 'risk', text: '最近一次更新失敗，下次排程會自動重試' };
  }
  if (warnings.length) return { tone: 'compat', text: `${site}調整了資料格式，已改用相容模式` };
  if (s.last_status === 'pending') return { tone: 'wait', text: `等待${site}公布今天的資料` };
  if (!s.last_success) return { tone: 'wait', text: '尚未抓取' };
  if (s.lag_days !== null && s.lag_days > 2) return { tone: 'risk', text: `資料落後 ${s.lag_days} 個交易日` };
  return { tone: 'ok', text: '正常' };
}

/** 資料健康頁頁首的一句話。 */
export function healthConclusion(sources: HealthSource[]): string {
  const risk = sources.filter((s) => describeSource(s).tone === 'risk').length;
  const compat = sources.filter((s) => describeSource(s).tone === 'compat').length;
  if (risk) return `${risk}\u00a0個資料源需要注意，其餘正常`;
  if (compat) return `資料都能正常更新，${compat}\u00a0個來源使用相容模式`;
  return '所有資料源都正常更新';
}

const QUOTES = ['twse_quotes', 'tpex_quotes'];
const CHIPS = ['twse_insti', 'tpex_insti', 'twse_margin', 'tpex_margin'];
const VALUATION = ['twse_valuation', 'tpex_valuation'];
// Q-08：融資餘額總計（twse_margin_total）是 twse_margin 的附帶輸出，健康頁以 twse_margin 呈現
const MONEY = ['taifex_insti', 'taifex_oi', 'fx_usdtwd', 'ust_10y', 'twse_margin'];
const FUNDAMENTAL = ['twse_revenue', 'tpex_revenue', 'mops_revenue', 'financials'];

/** 每個頁面實際用到的資料來源（頁首的異常提示只看這些）。 */
export const PAGE_SOURCES: Record<string, string[]> = {
  tonight: [...QUOTES, ...CHIPS, ...MONEY, 'tpex_index'],
  mine: [...QUOTES, ...CHIPS, ...VALUATION, ...FUNDAMENTAL],
  stock: [...QUOTES, ...CHIPS, ...VALUATION, ...FUNDAMENTAL, 'twse_sbl', 'tpex_sbl', 'twse_qfii', 'tpex_qfii', 'tdcc_holders'],
  explore: [...QUOTES, ...CHIPS, ...MONEY],
  screener: [...QUOTES, ...CHIPS, ...VALUATION, ...FUNDAMENTAL, 'tdcc_holders'],
  market: [...QUOTES, ...CHIPS, ...MONEY],
  calendar: ['twse_exright_notice', 'tpex_exright_notice', 'investor_conference'],
  disposition: ['twse_attention', 'tpex_attention', 'twse_disposition', 'tpex_disposition'],
  etf: ['active_etf'],
  journal: QUOTES,
  weekly: [...QUOTES, ...CHIPS],
};

/**
 * 各資料集的資料日一行（2026-10-02 健檢 M1-4）：「法人 10/2・融資融券 10/1・集保股權分散 9/24」。
 * meta.asof 整個不存在（舊版 meta.json）→ null（不顯示這一行）；有 asof 但某個鍵沒有日期 → 「—（尚未取得）」。
 */
export function asofSummary(asof: Asof | null | undefined, keys: AsofKey[]): string | null {
  if (!asof || !keys.length) return null;
  return keys.map((k) => `${ASOF_LABEL[k]} ${asof[k] ? md(asof[k]) : missing('尚未取得')}`).join('・');
}

/** 該頁用到、而且影響最新資料的異常來源。 */
export function affectedFor(uses: string[] | undefined, affected: string[] | undefined): string[] {
  if (!uses?.length || !affected?.length) return [];
  const set = new Set(uses);
  return affected.filter((id) => set.has(id));
}
