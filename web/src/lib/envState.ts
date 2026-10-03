/** 資金環境燈號：把市場頁的 5 項資金指標彙總成「積極／中性／保守」。只有「保守」使用琥珀色。 */
import { uiConfig } from './config';

export type LightState = 'green' | 'yellow' | 'red' | 'gray';
export interface Light { id: string; label: string; state: LightState; value: string; basis: string }
export type EnvState = 'aggressive' | 'neutral' | 'conservative' | 'unknown';

export const ENV_LABEL: Record<EnvState, string> = { aggressive: '積極', neutral: '中性', conservative: '保守', unknown: '資料不足' };
export const LIGHT_LABEL: Record<LightState, string> = { green: '有利', yellow: '中性', red: '風險', gray: '資料累積中' };

export interface EnvInfo {
  state: EnvState;
  label: string;
  red: Light[];
  green: Light[];
  yellow: Light[];
  gray: Light[];
  /** 燈號一句話：「1 項風險・3 項中性」 */
  counts: string;
}

export function envInfo(lights: Light[] | undefined | null, cfg = uiConfig.env_state): EnvInfo {
  const by = (s: LightState) => (lights ?? []).filter((l) => l.state === s);
  const red = by('red'), green = by('green'), yellow = by('yellow'), gray = by('gray');
  const known = red.length + green.length + yellow.length;
  let state: EnvState;
  if (!known) state = 'unknown';
  else if (red.length >= cfg.conservative_min_red) state = 'conservative';
  else if (green.length >= cfg.aggressive_min_green) state = 'aggressive';
  else state = 'neutral';
  const parts = [
    red.length ? `${red.length} 項風險` : '',
    green.length ? `${green.length} 項有利` : '',
    yellow.length ? `${yellow.length} 項中性` : '',
    gray.length ? `${gray.length} 項累積中` : '',
  ].filter(Boolean);
  return { state, label: ENV_LABEL[state], red, green, yellow, gray, counts: parts.join('・') };
}

/**
 * 判定是怎麼來的（2026-10-02 健檢 M1-7）：「3 項風險 → 保守（任一項風險即保守）」。
 * 指數創高、法人買超時仍可能是「保守」，所以要把規則寫在旁邊，不只給結論。
 */
export function envVerdict(env: Pick<EnvInfo, 'state' | 'label' | 'red' | 'green' | 'yellow'>, cfg = uiConfig.env_state): string {
  const red = env.red.length, green = env.green.length;
  switch (env.state) {
    case 'conservative':
      return `${red} 項風險 → ${env.label}（${cfg.conservative_min_red <= 1 ? '任一項風險即保守' : `風險 ≥ ${cfg.conservative_min_red} 項即保守`}）`;
    case 'aggressive':
      return `沒有風險、${green} 項有利 → ${env.label}（沒有風險且有利 ≥ ${cfg.aggressive_min_green} 項）`;
    case 'neutral':
      return `沒有風險、${green} 項有利 → ${env.label}（有利不足 ${cfg.aggressive_min_green} 項）`;
    default:
      return `${env.label}（指標都還沒有資料）`;
  }
}

/** 今晚頁的環境光：只代表資金環境燈號。有風險＝琥珀；其餘＝中性灰藍。 */
export function tonightMood(state: EnvState): 'risk' | 'neutral' {
  return state === 'conservative' ? 'risk' : 'neutral';
}
