import { expect, test } from '@playwright/test'
import {
  installAppShellApiMocks,
  installDashboardApiMocks,
  isDesktopViewport,
} from './support/appShellMocks'

test('renders the React frontend shell', async ({ page }) => {
  await installAppShellApiMocks(page)
  await installDashboardApiMocks(page)

  await page.goto('/')

  await expect(
    page.getByTestId('title-bar').getByRole('heading', { name: /^EPGStation/ }),
  ).toBeVisible()
  await expect(page.getByTestId('dashboard-page')).toBeVisible()
  await expect(page.getByTestId('dashboard-section-recording')).toContainText('録画中 1/1')
  await expect(page.getByTestId('dashboard-section-reserves')).toContainText('予約 1/1')
  await expect(page.getByTestId('app-shell')).toHaveAttribute('data-theme-mode', 'light')
  await expect(page.getByTestId('shell-drawer')).toHaveAttribute(
    'data-drawer-variant',
    isDesktopViewport(page) ? 'permanent' : 'temporary',
  )
  await expect(page.getByTestId('shell-main')).toHaveAttribute(
    'data-main-offset',
    isDesktopViewport(page) ? '256' : '0',
  )
})
