import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: '*.spec.ts',
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: 'http://localhost:5199',
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 820 } },
      testIgnore: 'mobile.spec.ts',
    },
    { name: 'phone', use: { ...devices['iPhone 15'], browserName: 'chromium' }, testMatch: 'mobile.spec.ts' },
  ],
  webServer: { command: 'pnpm dev', url: 'http://localhost:5199', reuseExistingServer: true },
});
