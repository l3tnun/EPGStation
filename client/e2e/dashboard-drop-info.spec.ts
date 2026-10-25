import { expect, test, type Page } from '@playwright/test'
import { installAppShellApiMocks } from './support/appShellMocks'
import { installDashboardWorkflowApiMocks } from './support/dashboardMocks'

test.beforeEach(async ({ page }) => {
  await installAppShellApiMocks(page)
  await installDashboardWorkflowApiMocks(page)
  await page.addInitScript(() => {
    window.localStorage.setItem(
      'settings',
      JSON.stringify({ isShowDropInfoInsteadOfDescription: true }),
    )
  })
})

// First recorded item of dashboardFixtures: drop 2, error 1, scrambling 0, one 20202-byte video file.
const DROP_INFO_TEXT = '2/1/0 19.7KB'

async function readDropInfo(page: Page, itemTestId: string) {
  const dropInfo = page.getByTestId(itemTestId).first().getByText(DROP_INFO_TEXT, { exact: true })
  await expect(dropInfo).toBeVisible()
  return dropInfo.evaluate((element) => {
    const style = getComputedStyle(element)
    return { color: style.color, fontWeight: style.fontWeight }
  })
}

test('shows the same drop information on the Dashboard and the Recorded list', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })

  await page.goto('/')
  await expect(page.getByTestId('dashboard-page')).toBeVisible()
  const dashboard = await readDropInfo(page, 'dashboard-recorded-summary-item')
  await expect(page.getByTestId('dashboard-page')).not.toContainText(/\d+ bytes/)

  await page.goto('/#/recorded?timestamp=drop-info')
  await expect(page.getByTestId('recorded-page')).toHaveAttribute(
    'data-recorded-layout',
    'small-card',
  )
  const recorded = await readDropInfo(page, 'recorded-list-item')

  expect(recorded).toEqual({ color: 'rgb(255, 0, 0)', fontWeight: '700' })
  expect(dashboard).toEqual(recorded)
})
