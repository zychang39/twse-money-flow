// E-01：以瀏覽器同一套 JSON.parse 嚴格解析衍生資料（web/public/data 或 dist/data）底下的所有 .json。
// 任何一個檔案含 NaN／Infinity 或其他非法內容就以非零結束（CI 與部署前把關）。
// 2026-10-02 健檢 M1-8：另外檢查跨頁共用的資料不變量（失敗不部署）：
//  - strategies.json：每套策略有 id／label／grade／subtitle；有權益曲線的策略，每條有值的基準線在起訖日都有值；
//    上架（有效／觀察中）策略的 h 含判定持有天數；grade 只能是 有效／觀察中／停用。
//  - evidence.json：每列有 id／label／verdict／kind；meta.config.primary_horizon 存在；沒有 meta.error。
//  - meta.json：market_date、calendar.closed、asof 存在。
//  - 策略的 test 若在 evidence rows 中，兩邊的訊號期間起點一致（同一數字只有一個來源）。
// 用法：node scripts/check-json.mjs [目錄=public/data]
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = process.argv[2] ?? 'public/data';
const bad = [];
const invariant = [];
let count = 0;

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (name.endsWith('.json')) {
      count += 1;
      try {
        JSON.parse(readFileSync(p, 'utf8'));
      } catch (e) {
        bad.push(`${p}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }
}

function load(name) {
  const p = join(root, name);
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
}

function checkInvariants() {
  const meta = load('meta.json');
  const strategies = load('strategies.json');
  const evidence = load('evidence.json');
  if (!meta) invariant.push('meta.json 不存在或無法解析');
  else {
    if (!meta.market_date) invariant.push('meta.json 沒有 market_date');
    if (!meta.calendar || !Array.isArray(meta.calendar.closed)) invariant.push('meta.json 沒有交易日曆 calendar.closed');
    if (!meta.asof || typeof meta.asof !== 'object') invariant.push('meta.json 沒有各資料集資料日 asof');
  }
  if (!evidence) invariant.push('evidence.json 不存在或無法解析');
  else {
    if (evidence.meta?.error) invariant.push(`evidence.json 評估失敗：${evidence.meta.error}`);
    if (!evidence.meta?.config?.primary_horizon) invariant.push('evidence.json meta.config.primary_horizon 缺少');
    for (const r of evidence.rows ?? []) {
      for (const k of ['id', 'label', 'verdict', 'kind']) if (!r[k]) invariant.push(`evidence.json 指標 ${r.id ?? '?'} 缺少 ${k}`);
    }
  }
  if (!strategies) invariant.push('strategies.json 不存在或無法解析（指標效度評估失敗時不會寫出）');
  else {
    const H = String(strategies.horizon ?? 40);
    const byTest = new Map((evidence?.rows ?? []).map((r) => [r.id, r]));
    for (const s of strategies.strategies ?? []) {
      for (const k of ['id', 'label', 'subtitle', 'grade']) if (!s[k]) invariant.push(`strategies.json ${s.id ?? '?'} 缺少 ${k}`);
      if (s.grade && !['有效', '觀察中', '停用'].includes(s.grade)) invariant.push(`strategies.json ${s.id} 的 grade「${s.grade}」不在 有效／觀察中／停用`);
      const listed = s.grade === '有效' || s.grade === '觀察中';
      const hold = s.swing?.hold ? String(s.swing.hold) : H;
      if (listed && !(s.h && s.h[hold])) invariant.push(`strategies.json ${s.id} 上架但沒有 ${hold} 日的統計（h）`);
      const cv = s.curve;
      if (cv && Array.isArray(cv.dates) && cv.dates.length) {
        if (!Array.isArray(cv.equity) || cv.equity.length !== cv.dates.length) invariant.push(`strategies.json ${s.id} 權益曲線 equity 與 dates 長度不同`);
        const lines = { tr: cv.bench ?? [], ...(cv.etf ?? {}) };
        for (const [key, vals] of Object.entries(lines)) {
          if (!Array.isArray(vals) || !vals.length) {
            if (!(cv.missing && cv.missing[key])) invariant.push(`strategies.json ${s.id} 權益曲線沒有 ${key} 基準線也沒有寫原因（curve.missing）`);
            continue;
          }
          if (vals.length !== cv.dates.length) invariant.push(`strategies.json ${s.id} 權益曲線 ${key} 長度與 dates 不同`);
          const nonNull = vals.filter((v) => v !== null);
          if (nonNull.length && (vals[0] === null || vals[vals.length - 1] === null)) invariant.push(`strategies.json ${s.id} 權益曲線 ${key} 在起訖日沒有值`);
        }
      }
      const row = s.test ? byTest.get(s.test) : null;
      if (row && s.kind !== 'swing' && row.signal_start && s.signal_start && row.signal_start !== s.signal_start) {
        invariant.push(`${s.id} 的訊號期間起點 ${s.signal_start} 與指標效度表 ${row.signal_start} 不同`);
      }
    }
  }
}

try {
  walk(root);
} catch (e) {
  console.error(`找不到資料目錄 ${root}：${e instanceof Error ? e.message : String(e)}`);
  process.exit(2);
}
if (count === 0) {
  console.error(`${root} 底下沒有任何 JSON 檔`);
  process.exit(2);
}
checkInvariants();
const stocks = bad.filter((b) => b.includes('/stocks/')).length;
process.stdout.write(`已檢查 ${count} 個 JSON 檔；無法解析 ${bad.length} 個（個股檔 ${stocks} 個）；不變量違反 ${invariant.length} 項\n`);
if (bad.length) {
  for (const b of bad.slice(0, 50)) console.error(`  ${b}`);
}
if (invariant.length) {
  for (const b of invariant.slice(0, 50)) console.error(`  不變量：${b}`);
}
if (bad.length || invariant.length) process.exit(1);
