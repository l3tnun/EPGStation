import { defineConfig, devices } from '@playwright/test'

// client を本物の v3 server（compile した server、sqlite、手作りの tuner server）に繋いで流す e2e。
// 通常の e2e（`playwright.config.ts`、`page.route` の偽 API）とは別に、`npx playwright test -c
// e2e/real-server/playwright.config.ts` で流す。先に `npm run bundle` で `client/dist` を作る。
// browser の実行 file を指定するときは PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH に置く。
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH

export default defineConfig({
  testDir: '.',
  testMatch: ['**/*.real.ts'],
  globalSetup: './support/globalSetup.ts',
  workers: 1,
  timeout: 60_000,
  use: {
    timezoneId: 'Asia/Tokyo',
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    ...(executablePath === undefined || executablePath === ''
      ? {}
      : { launchOptions: { executablePath } }),
  },
  projects: [{ name: 'Desktop Chromium', use: { ...devices['Desktop Chrome'] } }],
})
