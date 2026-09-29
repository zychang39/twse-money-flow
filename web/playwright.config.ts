import { defineConfig, devices } from '@playwright/test';

// 本機可用環境變數 PW_CHROMIUM_PATH 指定既有的 Chromium；CI 使用 `npx playwright install chromium`。
const executablePath = process.env.PW_CHROMIUM_PATH || undefined;

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:4173/twse-money-flow/',
    trace: 'retain-on-failure',
    launchOptions: executablePath ? { executablePath } : {},
  },
  projects: [
    { name: 'iphone', testIgnore: /sw-update\.spec\.ts/, use: { ...devices['iPhone 13'], browserName: 'chromium', launchOptions: executablePath ? { executablePath } : {} } },
    // 真實 service worker 更新流程：在其他測試結束後單獨執行。高負載下（上百個平行測試），Chromium 會延後新版接手
    // （等舊版手上的請求結束），「再次開啟即自動更新」的時序無法穩定驗證；邏輯另有單元測試（lib/swUpdate.test.ts）。
    { name: 'sw-update', testMatch: /sw-update\.spec\.ts/, dependencies: ['iphone'], use: { ...devices['iPhone 13'], browserName: 'chromium', launchOptions: executablePath ? { executablePath } : {} } },
  ],
  webServer: {
    command: 'npm run preview',
    url: 'http://localhost:4173/twse-money-flow/',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
