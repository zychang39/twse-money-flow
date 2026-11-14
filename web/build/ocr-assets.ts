/**
 * Vite 外掛：把截圖辨識（tesseract.js）需要的檔案從 node_modules 複製到 public/ocr（不 commit）。
 * - 自託管：辨識在使用者的裝置上執行，不向第三方 CDN 取檔（截圖有帳號與姓名，連檔案來源都不對外）。
 * - 放在 public 而不是打包：約 8 MB，只有用到「從截圖加入」時才下載；不進 service worker 的外殼清單。
 * 檔案：worker、核心（WASM；SIMD 與非 SIMD 各一份，由 tesseract.js 依瀏覽器挑）、英數與繁中的辨識模型。
 */
import type { Plugin } from 'vite';
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const OCR_FILES: [from: string, to: string][] = [
  ['node_modules/tesseract.js/dist/worker.min.js', 'worker.min.js'],
  ['node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js'],
  ['node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js', 'tesseract-core-lstm.wasm.js'],
  ['node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz', 'eng.traineddata.gz'],
  ['node_modules/@tesseract.js-data/chi_tra/4.0.0_best_int/chi_tra.traineddata.gz', 'chi_tra.traineddata.gz'],
];

export function ocrAssets(): Plugin {
  return {
    name: 'ocr-assets',
    buildStart() {
      for (const [from, to] of OCR_FILES) {
        const src = join(ROOT, from);
        const dst = join(ROOT, 'public/ocr', to);
        if (!existsSync(src)) this.error(`截圖辨識的檔案不存在：${from}（先執行 npm ci）`);
        if (existsSync(dst) && statSync(dst).size === statSync(src).size) continue;
        mkdirSync(dirname(dst), { recursive: true });
        copyFileSync(src, dst);
      }
    },
  };
}
