import { defineConfig, devices } from '@playwright/test'
import { availableParallelism } from 'node:os'

// CI (the ci-rehearsal container, where process.env.CI is always '1') does not force workers to 1:
// a fixed 1 would keep the rehearsal container to a single core for e2e/visual regardless of how
// many CPUs release-preflight.sh gives it. The
// container gets 8 dedicated CPUs (release-preflight.sh's container B); e2e's mocks are
// page.route-scoped per browser context and the one real listener (realtimeHarness.ts) binds with
// listen(0) for an OS-assigned port, so nothing here collides across concurrently running workers.
// PLAYWRIGHT_WORKERS overrides the CPU-derived count for manual tuning (e.g. isolating a flaky
// file at 1 without touching this file); otherwise CI clamps to 4-6 workers based on CPU count,
// matching what repeated e2e/visual runs were measured clean at on the 8-CPU container.
const resolveWorkers = (): number | undefined => {
  if (process.env.CI === undefined || process.env.CI === '') return undefined
  const configured = process.env.PLAYWRIGHT_WORKERS
  if (configured !== undefined && configured !== '') {
    const parsed = Number(configured)
    if (Number.isInteger(parsed) && parsed > 0) return parsed
  }
  const cpus = availableParallelism()
  return Math.min(6, Math.max(4, cpus - 2))
}

const resolvePreviewPort = (): number => {
  const configured = process.env.PLAYWRIGHT_PREVIEW_PORT
  if (configured === undefined || configured === '') return 4173
  if (!/^[1-9][0-9]*$/.test(configured)) {
    throw new Error(`PLAYWRIGHT_PREVIEW_PORT must be a positive integer: ${configured}`)
  }
  const port = Number(configured)
  if (port > 65535) {
    throw new Error(`PLAYWRIGHT_PREVIEW_PORT must be 65535 or less: ${configured}`)
  }
  return port
}

// A file named `*-ios.spec.ts` runs on iOS Safari only. A plain `**/*-ios.spec.ts` glob also
// matches `*-non-ios.spec.ts` (its name ends in `-ios.spec.ts`), which silently excluded the
// non-iOS specs from every project. The lookbehind keeps `-non-ios` out of the iOS-only set.
const iosOnlySpec = /(?<!non)-ios\.spec\.ts$/

const previewPort = resolvePreviewPort()
const previewOrigin = `http://127.0.0.1:${previewPort}`

export default defineConfig({
  testDir: '.',
  testMatch: ['e2e/**/*.spec.ts', 'visual/**/*.spec.ts'],
  workers: resolveWorkers(),
  expect: {
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.06,
    },
  },
  use: {
    baseURL: previewOrigin,
    serviceWorkers: 'block',
    timezoneId: 'Asia/Tokyo',
    trace: 'on-first-retry',
  },
  webServer:
    process.env.PLAYWRIGHT_NO_WEBSERVER === '1'
      ? undefined
      : {
          command: `EPGSTATION_SUPPRESS_PROXY_ERRORS=1 npm run preview -- --host 127.0.0.1 --port ${previewPort} --strictPort`,
          url: previewOrigin,
          reuseExistingServer: false,
          timeout: 120_000,
        },
  projects: [
    {
      name: 'Desktop Chromium',
      testIgnore: ['**/*-android.spec.ts', iosOnlySpec],
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'Desktop Firefox',
      testIgnore: ['**/*-android.spec.ts', iosOnlySpec],
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'Android Chrome',
      testIgnore: [iosOnlySpec],
      use: { ...devices['Pixel 5'] },
    },
    {
      name: 'iOS Safari',
      testIgnore: ['**/*-android.spec.ts', '**/*-non-ios.spec.ts'],
      use: { ...devices['iPhone 13'] },
    },
  ],
})
