import { expect, test } from '@playwright/test'
import { installAppShellApiMocks } from './support/appShellMocks'
import { installGuideOnAirApiMocks } from './support/guideOnAirMocks'

test.beforeEach(async ({ page }) => {
  await installAppShellApiMocks(page, { enableBroadcastWaveNavigation: true })
  await installGuideOnAirApiMocks(page)
})

test('keeps On Air content below the broadcast-wave tabs in the iOS fixed shell', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1366, height: 1024 })

  await page.goto('/#/onair')
  await expect(page.getByTestId('onair-page')).toBeVisible()

  type FixedShellMetrics = {
    htmlClassName: string
    titleBarBottom: number
    titleBarHeight: number
    onAirListTop: number
    shellMainPaddingTop: string
    titleBarHeightVariable: string
  }

  const readMetrics = () =>
    page.evaluate(() => {
      const titleBar = document.querySelector<HTMLElement>('[data-testid="title-bar"]')
      const onAirList = document.querySelector<HTMLElement>('[data-testid="onair-list"]')
      const shellMain = document.querySelector<HTMLElement>('[data-testid="shell-main"]')

      if (titleBar === null || onAirList === null || shellMain === null) {
        throw new Error('On Air fixed shell elements are missing')
      }

      return {
        htmlClassName: document.documentElement.className,
        titleBarBottom: titleBar.getBoundingClientRect().bottom,
        titleBarHeight: titleBar.getBoundingClientRect().height,
        onAirListTop: onAirList.getBoundingClientRect().top,
        shellMainPaddingTop: window.getComputedStyle(shellMain).paddingTop,
        titleBarHeightVariable:
          document.documentElement.style.getPropertyValue('--app-title-bar-height'),
      }
    })

  await expect
    .poll(async () => {
      const metrics = await readMetrics()
      const paddingTop = Math.round(parseFloat(metrics.shellMainPaddingTop))
      const titleBarHeight = Math.round(metrics.titleBarHeight)
      const titleBarHeightVariable = Math.round(parseFloat(metrics.titleBarHeightVariable))
      return (
        titleBarHeight > 64 &&
        paddingTop === titleBarHeight &&
        titleBarHeightVariable === titleBarHeight
      )
    })
    .toBe(true)

  const metrics: FixedShellMetrics = await readMetrics()

  expect(metrics.htmlClassName).toContain('fix-address-bar2')
  expect(metrics.titleBarHeight).toBeGreaterThan(64)
  expect(parseFloat(metrics.shellMainPaddingTop)).toBeCloseTo(metrics.titleBarHeight, 0)
  expect(parseFloat(metrics.titleBarHeightVariable)).toBeCloseTo(metrics.titleBarHeight, 0)
  // v3 contract: shell-main's padding-top is driven by the measured --app-title-bar-height variable
  // (src/index.css, set from useFixedTitleBarHeightVariable in src/app/hooks/useFixedShellViewport.ts),
  // so on-air content must start at or below the fixed title bar's bottom edge, never underneath it.
  expect(metrics.onAirListTop).toBeGreaterThanOrEqual(metrics.titleBarBottom)
})
