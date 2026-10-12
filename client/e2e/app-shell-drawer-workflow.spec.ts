import { expect, test } from '@playwright/test'
import { installAppShellApiMocks, installDashboardApiMocks } from './support/appShellMocks'

test('[AC 5.4] auto-opens the permanent drawer when resizing from mobile overlay width to desktop width', async ({
  page,
}) => {
  await installAppShellApiMocks(page)
  await installDashboardApiMocks(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')

  await page.getByRole('button', { name: 'ナビゲーションを開閉' }).click()
  await expect(page.getByTestId('shell-drawer')).toHaveAttribute('data-drawer-open', 'true')
  const viewport = page.viewportSize()
  await page.mouse.click((viewport?.width ?? 390) - 8, (viewport?.height ?? 844) - 8)
  await expect(page.getByTestId('shell-drawer')).toHaveAttribute('data-drawer-open', 'false')

  await page.setViewportSize({ width: 1264, height: 844 })
  await expect(page.getByTestId('shell-drawer')).toHaveAttribute('data-drawer-variant', 'permanent')
  await expect(page.getByTestId('shell-drawer')).toHaveAttribute('data-drawer-open', 'true')
  await expect(page.getByTestId('shell-main')).toHaveAttribute('data-main-offset', '256')

  await page.getByRole('button', { name: 'ナビゲーションを開閉' }).click()
  await expect(page.getByTestId('shell-drawer')).toHaveAttribute('data-drawer-open', 'false')
  await expect(page.getByTestId('shell-main')).toHaveAttribute('data-main-offset', '0')
})

test('[AC 5.5] keeps the permanent navigation drawer vertically scrollable without horizontal overflow', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1264, height: 360 })
  await installAppShellApiMocks(page, { enableBroadcastWaveNavigation: true })
  await installDashboardApiMocks(page)
  await page.goto('/')

  await expect(page.getByTestId('shell-drawer')).toHaveAttribute('data-drawer-variant', 'permanent')
  await expect(page.getByTestId('shell-drawer')).toHaveAttribute('data-drawer-open', 'true')

  const drawerPaper = page.getByTestId('shell-drawer').locator('[role="presentation"]').first()
  const drawerContent = page.getByTestId('shell-drawer-content')
  const drawerGeometry = await drawerPaper.evaluate((drawer) => {
    const element = drawer as HTMLElement
    const style = getComputedStyle(element)
    element.scrollLeft = 160
    const forcedScrollLeft = element.scrollLeft

    return {
      clientHeight: element.clientHeight,
      clientWidth: element.clientWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      forcedScrollLeft,
      overflowX: style.overflowX,
      overflowY: style.overflowY,
      scrollHeight: element.scrollHeight,
      scrollLeft: element.scrollLeft,
      scrollTop: element.scrollTop,
      scrollWidth: element.scrollWidth,
      viewportWidth: window.innerWidth,
    }
  })
  const drawerContentGeometry = await drawerContent.evaluate((contentElement) => {
    const content = contentElement as HTMLElement
    const contentStyle = getComputedStyle(content)
    content.scrollTop = 0
    const initialScrollTop = content.scrollTop
    content.scrollTop = 160
    content.dispatchEvent(new Event('scroll', { bubbles: true }))

    return {
      clientHeight: content.clientHeight,
      clientWidth: content.clientWidth,
      initialScrollTop,
      overflowX: contentStyle.overflowX,
      overflowY: contentStyle.overflowY,
      scrollHeight: content.scrollHeight,
      scrollTop: content.scrollTop,
      scrollWidth: content.scrollWidth,
    }
  })

  expect(drawerGeometry.overflowX).toBe('hidden')
  expect(drawerGeometry.overflowY).toBe('hidden')
  expect(drawerContentGeometry.overflowX).toBe('hidden')
  expect(drawerContentGeometry.overflowY).toBe('auto')
  expect(drawerContentGeometry.scrollWidth).toBeLessThanOrEqual(drawerContentGeometry.clientWidth)
  expect(drawerContentGeometry.scrollHeight).toBeGreaterThan(drawerContentGeometry.clientHeight)
  expect(drawerContentGeometry.scrollTop).toBeGreaterThan(drawerContentGeometry.initialScrollTop)
  expect(drawerGeometry.forcedScrollLeft).toBe(0)
  expect(drawerGeometry.scrollLeft).toBe(0)
  expect(drawerGeometry.documentScrollWidth).toBeLessThanOrEqual(drawerGeometry.viewportWidth)
})
