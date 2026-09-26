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
  projects: [{ name: 'iphone', use: { ...devices['iPhone 13'], browserName: 'chromium', launchOptions: executablePath ? { executablePath } : {} } }],
  webServer: {
    command: 'npm run preview',
    url: 'http://localhost:4173/twse-money-flow/',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
