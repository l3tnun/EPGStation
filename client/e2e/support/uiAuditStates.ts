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
  // 番組情報を受け取ると時刻指定の欄を番組の値で上書きするので、受け取ってから時刻指定の欄を操作する
  await expect(page.getByRole('heading', { name: manualProgramDetail.name })).toBeVisible()
  await page.getByRole('switch', { name: '時刻指定' }).click()
}
