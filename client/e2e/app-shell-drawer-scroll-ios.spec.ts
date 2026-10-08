import { expect, test } from '@playwright/test'
import { installAppShellApiMocks, installDashboardApiMocks } from './support/appShellMocks'

// iPhone SE (3rd generation) is 375x667; Safari's toolbars leave a visible height well under that.
const SHORT_SAFARI_VIEWPORTS = [
  { width: 375, height: 548 },
  { width: 375, height: 500 },
]

for (const viewport of SHORT_SAFARI_VIEWPORTS) {
  test.describe(`${viewport.width}x${viewport.height} iOS fixed shell`, () => {
    test.beforeEach(async ({ page }) => {
      await installAppShellApiMocks(page, { enableBroadcastWaveNavigation: true })
      await installDashboardApiMocks(page)
      await page.setViewportSize(viewport)
      await page.goto('/')
      await expect(page.locator('html')).toHaveClass(/fix-address-bar2/)
      await page.getByRole('button', { name: 'ナビゲーションを開閉' }).click()
      await expect(page.getByTestId('shell-drawer')).toHaveAttribute('data-drawer-open', 'true')
    })

    test('keeps the whole navigation reachable by scrolling inside the drawer', async ({
      page,
    }) => {
      const result = await page.getByTestId('shell-drawer-content').evaluate((content) => {
        if (!(content instanceof HTMLElement)) {
          throw new Error('drawer content is missing')
        }

        const items = content.querySelectorAll<HTMLElement>('[data-testid^="navigation-item-"]')
        const last = items[items.length - 1]
        const viewportHeight = window.innerHeight

        content.scrollTop = content.scrollHeight
        const lastBottom = last?.getBoundingClientRect().bottom ?? Number.POSITIVE_INFINITY

        return {
          clientHeight: content.clientHeight,
          scrollHeight: content.scrollHeight,
          viewportHeight,
          lastBottom,
        }
      })

      expect(result.scrollHeight).toBeGreaterThan(result.viewportHeight)
      expect(result.clientHeight).toBeLessThanOrEqual(result.viewportHeight)
      expect(result.lastBottom).toBeLessThanOrEqual(result.viewportHeight)
    })

    test('does not cancel touch drags that start on a navigation item', async ({ page }) => {
      const result = await page.getByTestId('shell-drawer-content').evaluate((content) => {
        const target = content.querySelector<HTMLElement>('[data-testid^="navigation-item-"]')
        if (target === null) {
          throw new Error('navigation item is missing')
        }

        const dispatchSyntheticTouch = (type: string, clientY: number) => {
          const event = new Event(type, { bubbles: true, cancelable: true })
          const touches = type === 'touchend' ? [] : [{ clientY }]
          Object.defineProperty(event, 'touches', { value: touches })
          Object.defineProperty(event, 'changedTouches', { value: [{ clientY }] })
          return target.dispatchEvent(event)
        }

        dispatchSyntheticTouch('touchstart', 300)
        const moveDispatchResult = dispatchSyntheticTouch('touchmove', 200)
        dispatchSyntheticTouch('touchend', 200)

        return { moveDefaultPrevented: !moveDispatchResult }
      })

      expect(result.moveDefaultPrevented).toBe(false)
    })
  })
}
