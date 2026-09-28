// E-01：以瀏覽器同一套 JSON.parse 嚴格解析衍生資料（web/public/data 或 dist/data）底下的所有 .json。
// 任何一個檔案含 NaN／Infinity 或其他非法內容就以非零結束（CI 與部署前把關）。
// 用法：node scripts/check-json.mjs [目錄=public/data]
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = process.argv[2] ?? 'public/data';
const bad = [];
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
const stocks = bad.filter((b) => b.includes('/stocks/')).length;
process.stdout.write(`已檢查 ${count} 個 JSON 檔；無法解析 ${bad.length} 個（個股檔 ${stocks} 個）\n`);
if (bad.length) {
  for (const b of bad.slice(0, 50)) console.error(`  ${b}`);
  process.exit(1);
}
