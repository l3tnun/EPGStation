import { expect, test } from '@playwright/test'
import { installAppShellApiMocks } from './support/appShellMocks'
import { installRecordedApiMocks } from './support/recordedMocks'
import { installStoragesUploadApiMocks } from './support/storagesUploadMocks'

test.beforeEach(async ({ page }) => {
  await installAppShellApiMocks(page)
  await installStoragesUploadApiMocks(page)
})

test('keeps the Recorded page scrollable inside the iOS address-bar fixed shell', async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      'settings',
      JSON.stringify({
        recordedLength: 24,
        isShowTableMode: false,
        isPreferredPlayingOnWeb: true,
      }),
    )
  })
  await installRecordedApiMocks(page, 'success')

  await page.goto('/#/recorded?timestamp=ios-scroll-regression')
  await expect(page.getByTestId('recorded-list-item')).toHaveCount(6)
  await expect(page.getByTestId('recorded-page')).toBeVisible()

  const shellMetrics = await page.getByTestId('shell-main').evaluate((node) => {
    if (!(node instanceof HTMLElement)) {
      throw new Error('shell-main is not an HTMLElement')
    }

    return {
      htmlClassName: document.documentElement.className,
      appShellHeight: document.querySelector('[data-testid="app-shell"]')?.getBoundingClientRect()
        .height,
      clientHeight: node.clientHeight,
      scrollHeight: node.scrollHeight,
      boundingHeight: node.getBoundingClientRect().height,
      overflowY: window.getComputedStyle(node).overflowY,
    }
  })

  expect(shellMetrics.htmlClassName).toContain('fix-address-bar2')
  expect(shellMetrics.overflowY).toBe('auto')
  expect(shellMetrics.appShellHeight).toBe(shellMetrics.clientHeight)
  expect(shellMetrics.scrollHeight).toBeGreaterThan(shellMetrics.clientHeight)
  expect(shellMetrics.boundingHeight).toBe(shellMetrics.clientHeight)

  await page.getByTestId('shell-main').evaluate((node) => {
    const shellMain = node as HTMLElement
    shellMain.scrollTo(0, 500)
  })
  // v3 contract: confirms shell-main (not the page/body) is the element that actually scrolls
  // under the iOS fixed-address-bar shell, mirroring the scrollTo(0, 500) call above; not tied to
  // a v2 source, and left as a non-zero check (rather than an exact 500) because the scrollable
  // range is only bounded below by the earlier scrollHeight > clientHeight assertion.
  await expect
    .poll(() => page.getByTestId('shell-main').evaluate((node) => (node as HTMLElement).scrollTop))
    .toBeGreaterThan(0)
})

test('routes title-bar touch drags to the Recorded scroll container in the iOS fixed shell', async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      'settings',
      JSON.stringify({
        recordedLength: 24,
        isShowTableMode: false,
        isPreferredPlayingOnWeb: true,
      }),
    )
  })
  await installRecordedApiMocks(page, 'success')

  await page.goto('/#/recorded?timestamp=ios-titlebar-scroll-regression')
  await expect(page.getByTestId('recorded-list-item')).toHaveCount(6)

  const result = await page.getByTestId('title-bar').evaluate((titleBar) => {
    const shellMain = document.querySelector<HTMLElement>('[data-testid="shell-main"]')
    if (!(titleBar instanceof HTMLElement) || shellMain === null) {
      throw new Error('title-bar or shell-main is missing')
    }

    shellMain.scrollTop = 0

    const dispatchSyntheticTouch = (type: string, clientY: number) => {
      const event = new Event(type, { bubbles: true, cancelable: true })
      const touches = type === 'touchend' ? [] : [{ clientY }]
      Object.defineProperty(event, 'touches', { value: touches })
      Object.defineProperty(event, 'changedTouches', { value: [{ clientY }] })
      return titleBar.dispatchEvent(event)
    }

    dispatchSyntheticTouch('touchstart', 56)
    const moveDispatchResult = dispatchSyntheticTouch('touchmove', 16)
    dispatchSyntheticTouch('touchend', 16)

    return {
      htmlClassName: document.documentElement.className,
      moveDefaultPrevented: !moveDispatchResult,
      scrollTop: shellMain.scrollTop,
      titleTouchAction: window.getComputedStyle(titleBar).touchAction,
    }
  })

  expect(result.htmlClassName).toContain('fix-address-bar2')
  expect(result.moveDefaultPrevented).toBe(true)
  expect(result.scrollTop).toBeGreaterThan(0)
  expect(result.titleTouchAction).toBe('none')
})
