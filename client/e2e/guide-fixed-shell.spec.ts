import { expect, test } from '@playwright/test'
import { installAppShellApiMocks } from './support/appShellMocks'
import { installGuideOnAirApiMocks } from './support/guideOnAirMocks'

test.skip(
  ({ browserName }) => browserName !== 'chromium',
  'Chromium iPhone emulation covers pre-device metrics',
)

test.use({
  hasTouch: true,
  isMobile: true,
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  viewport: { width: 390, height: 844 },
})

test('keeps Guide inside the fixed iOS-like shell viewport without page-level overflow', async ({
  page,
}) => {
  await installAppShellApiMocks(page)
  await installGuideOnAirApiMocks(page)

  await page.goto('/#/guide?type=GR&time=23111507')
  await expect(page.getByTestId('guide-page')).toHaveAttribute('data-guide-visible', 'true')
  // The shell publishes the measured title bar height as a CSS variable; the geometry below is
  // only meaningful once that variable exists, so wait for it instead of racing the layout pass.
  await expect
    .poll(() =>
      page.evaluate(() =>
        document.documentElement.style.getPropertyValue('--app-title-bar-height'),
      ),
    )
    .toMatch(/^\d+(\.\d+)?px$/)
  // `data-guide-visible` also reads "true" while the schedule data has not resolved yet
  // (GuideGridHost renders `visible || !hasGrid`, and GuidePage treats "no data yet" as
  // trivially ready), so the program grid can still be absent from the DOM at this point.
  // Wait for it to actually attach -- via Playwright's own retrying locator assertion, not a
  // single page.evaluate() call -- before any metrics read assumes it exists.
  await expect(page.getByTestId('guide-program-grid')).toBeAttached()

  const readMetrics = () =>
    page.evaluate(() => {
      const shellMain = document.querySelector<HTMLElement>('[data-testid="shell-main"]')
      const guidePage = document.querySelector<HTMLElement>('[data-testid="guide-page"]')
      const programGrid = document.querySelector<HTMLElement>('[data-testid="guide-program-grid"]')

      if (shellMain === null || guidePage === null || programGrid === null) {
        throw new Error('Guide shell metrics target is missing')
      }

      programGrid.scrollTop = programGrid.scrollHeight - programGrid.clientHeight
      programGrid.dispatchEvent(new Event('scroll', { bubbles: true }))

      const shellMainRect = shellMain.getBoundingClientRect()
      const guideRect = guidePage.getBoundingClientRect()

      return {
        documentClasses: Array.from(document.documentElement.classList),
        guideBottom: guideRect.bottom,
        guideHeight: guideRect.height,
        programGridClientHeight: programGrid.clientHeight,
        programGridScrollHeight: programGrid.scrollHeight,
        shellMainBottom: shellMainRect.bottom,
        shellMainClientHeight: shellMain.clientHeight,
        shellMainScrollHeight: shellMain.scrollHeight,
        shellMainScrollTop: shellMain.scrollTop,
        titleBarHeight: document.documentElement.style.getPropertyValue('--app-title-bar-height'),
      }
    })

  // Layout settles asynchronously (viewport height and title bar height are published from an
  // animation frame / ResizeObserver), so poll the containment invariants instead of sampling once.
  // v3 contract: guide-page must fit inside shell-main (--app-viewport-height / --app-title-bar-height
  // in src/index.css and src/app/hooks/useFixedShellViewport.ts are fractional, measured values), so
  // the +1 only tolerates subpixel rounding between two independent getBoundingClientRect() reads.
  await expect
    .poll(async () => {
      const m = await readMetrics()
      return m.guideBottom - m.shellMainBottom
    })
    .toBeLessThanOrEqual(1)
  const metrics = await readMetrics()

  expect(metrics.titleBarHeight).toMatch(/px$/)
  expect(metrics.documentClasses).toContain('fix-address-bar2')
  expect(metrics.documentClasses).not.toContain('fix-address-bar')
  expect(metrics.guideHeight).toBeGreaterThan(0)
  expect(metrics.programGridScrollHeight).toBeGreaterThan(metrics.programGridClientHeight)
  // Same v3 containment contract as the poll above; restated on the settled metrics snapshot.
  expect(metrics.guideBottom).toBeLessThanOrEqual(metrics.shellMainBottom + 1)
  expect(metrics.shellMainScrollHeight).toBeLessThanOrEqual(metrics.shellMainClientHeight + 1)
  expect(metrics.shellMainScrollTop).toBe(0)
})
