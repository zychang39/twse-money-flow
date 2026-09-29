import { defineConfig } from 'vitest/config';
import preact from '@preact/preset-vite';
import { configYaml } from './build/config-yaml.ts';
import { serviceWorker } from './build/service-worker.ts';
import { fontPreload } from './build/font-preload.ts';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

/** 版本字串（設定頁、資料健康頁顯示）：commit 短碼＋建置日期（台北時間）。 */
function commitShort(): string {
  // 以實際 checkout 的提交為準（deploy.yml 的 workflow_run 會 checkout CI 測過的 head_sha，不一定等於 GITHUB_SHA）
  try { return execSync('git rev-parse --short=7 HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { /* 沒有 git */ }
  return process.env.GITHUB_SHA?.slice(0, 7) || 'dev';
}
const APP_COMMIT = commitShort();
const APP_BUILD_DATE = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Taipei' }).format(new Date());

export default defineConfig({
  base: '/twse-money-flow/',
  plugins: [configYaml(), preact(), serviceWorker(`${APP_COMMIT}・${APP_BUILD_DATE}`), fontPreload()],
  define: { __APP_COMMIT__: JSON.stringify(APP_COMMIT), __APP_BUILD_DATE__: JSON.stringify(APP_BUILD_DATE) },
  resolve: {
    // 自託管 Inter（數字與英文）；只打包 CSS 實際引用的拉丁子集
    alias: { '@inter': fileURLToPath(new URL('./node_modules/@fontsource-variable/inter/files', import.meta.url)) },
  },
  server: { fs: { allow: ['..'] } },
  build: {
    target: 'es2022',
    sourcemap: false,
    // e2e 用來確認每個頁面分塊自己帶到需要的 CSS（#4：個股頁用了只在工具頁載入的樣式）
    manifest: true,
    chunkSizeWarningLimit: 400,
  },
  worker: { format: 'es', plugins: () => [configYaml()] },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
