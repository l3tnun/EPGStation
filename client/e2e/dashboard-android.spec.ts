import { expect, test } from '@playwright/test'
import { installAppShellApiMocks } from './support/appShellMocks'
import { installDashboardWorkflowApiMocks } from './support/dashboardMocks'

test.beforeEach(async ({ page }) => {
  await installAppShellApiMocks(page, { enableBroadcastWaveNavigation: true })
})

test('keeps Android Dashboard main content scrollable from summary list drags', async ({
  page,
}) => {
  await installDashboardWorkflowApiMocks(page, { mode: 'overflow' })
  await page.addInitScript(() => {
    const originalPreventDefault = Event.prototype.preventDefault
    Event.prototype.preventDefault = function preventDefaultProbe(this: Event) {
      if (this.type === 'touchmove') {
        const current = Number(window.sessionStorage.getItem('dashboardTouchPrevented') ?? '0')
        window.sessionStorage.setItem('dashboardTouchPrevented', String(current + 1))
      }
      return originalPreventDefault.call(this)
    }
  })
  await page.goto('/')
  await expect(page.getByTestId('dashboard-page')).toBeVisible()
  await expect(page.getByText('Synthetic Dashboard Reserve Alpha 1')).toBeVisible()

  const before = await page
    .getByTestId('shell-main')
    .evaluate((node) =>
      Math.max(
        window.scrollY,
        document.documentElement.scrollTop,
        document.body.scrollTop,
        (node as HTMLElement).scrollTop,
      ),
    )
  const dragStart = await page.getByTestId('dashboard-section-recorded-list').boundingBox()

  if (dragStart === null) {
    throw new Error('Dashboard recorded list did not produce a bounding box')
  }

  const client = await page.context().newCDPSession(page)
  const x = Math.round(dragStart.x + dragStart.width / 2)
  const y = Math.round(dragStart.y + Math.min(160, dragStart.height - 20))
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x, y }],
  })
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ x, y: y - 360 }],
  })
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [],
  })

  await expect
    .poll(() =>
      page
        .getByTestId('shell-main')
        .evaluate((node) =>
          Math.max(
            window.scrollY,
            document.documentElement.scrollTop,
            document.body.scrollTop,
            (node as HTMLElement).scrollTop,
          ),
        ),
    )
    // Provenance (D): confirms the touch drag actually scrolled shell-main; no fixed target
    // distance to cite, only that the scroll position advanced from its pre-drag value.
    .toBeGreaterThan(before)
  await expect
    .poll(() => page.evaluate(() => window.sessionStorage.getItem('dashboardTouchPrevented')))
    .toBeNull()
})
