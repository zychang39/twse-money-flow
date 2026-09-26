import { describe, expect, it } from 'vitest';
import { toAlertsYaml } from '../components/AlertExport';

describe('alerts.yml 匯出', () => {
  it('只輸出有價格的規則', () => {
    const y = toAlertsYaml([{ code: '2330', above: 2600, below: 2300, note: '前高' }, { code: '2317' }]);
    expect(y).toContain('- { code: "2330", above: 2600, below: 2300, note: "前高" }');
    expect(y).not.toContain('2317');
  });
  it('沒有規則時輸出空陣列', () => {
    expect(toAlertsYaml([])).toContain('alerts: []');
  });
  it('日報代號去重', () => {
    expect(toAlertsYaml([], ['2330', '0050', '2330'])).toContain('digest: ["2330", "0050"]');
  });
});
