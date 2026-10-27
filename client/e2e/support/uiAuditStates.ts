import { expect, type Page } from '@playwright/test'
import {
  installAppShellApiMocks,
  installDashboardApiMocks,
  isDesktopViewport,
} from './appShellMocks'
import { installReservesApiMocks, manualProgramDetail } from './reservesMocks'

export async function openDarkNavigationDrawer(page: Page): Promise<void> {
  await installAppShellApiMocks(page, { forceDarkTheme: true })
  await installDashboardApiMocks(page)
  await page.goto('/')

  if (!isDesktopViewport(page)) {
    await page.getByRole('button', { name: 'ナビゲーションを開閉' }).click()
  }
}

export async function openDarkManualReserveTimeSpecifiedForm(page: Page): Promise<void> {
  await installAppShellApiMocks(page, { forceDarkTheme: true })
  await installReservesApiMocks(page)
  await page.goto(`/#/reserves/manual?programId=${manualProgramDetail.id}`)
  // 番組情報を受け取るとフォームを番組の内容で置き換えるので、その後に switch を押す
  await expect(page.getByRole('heading', { name: manualProgramDetail.name })).toBeVisible()
  await page.getByRole('switch', { name: '時刻指定' }).click()
}
