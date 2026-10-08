import { getActiveRouteScrollY, scrollActiveRouteTo } from './support/routeScroll'
import { expect, test } from '@playwright/test'
import {
  SYNTHETIC_APP_VERSION,
  SYNTHETIC_NAVIGATION_TIMESTAMP,
  installAppShellApiMocks,
  installDashboardApiMocks,
  isDesktopViewport,
} from './support/appShellMocks'
import { installGuideOnAirApiMocks } from './support/guideOnAirMocks'
import { expectAnnounced } from './support/notificationObservation'

test('loads mocked config and version, then keeps selected route with refresh query', async ({
  page,
}) => {
  await installAppShellApiMocks(page)

  await page.goto(`/#/reserves?type=conflict&timestamp=${SYNTHETIC_NAVIGATION_TIMESTAMP}`)

  if (!isDesktopViewport(page)) {
    await page.getByRole('button', { name: 'ナビゲーションを開閉' }).click()
  }

  await expect(page.getByText(`EPGStation v${SYNTHETIC_APP_VERSION}`)).toBeVisible()
  await expect(page.getByTestId('navigation-item-onair')).toBeVisible()
  await expect(page.getByTestId('navigation-item-guide')).toBeVisible()
  await expect(page.getByTestId('navigation-item-reserves-conflict')).toHaveAttribute(
    'data-selected',
    'true',
  )
})

test('navigates from the drawer and closes temporary drawer on mobile', async ({ page }) => {
  await installAppShellApiMocks(page)
  await installDashboardApiMocks(page)
  await page.route('**/api/channels', async (route) => {
    await route.fulfill({ json: [] })
  })
  await page.goto('/')

  await expect(
    page.getByRole('heading', { name: `EPGStation v${SYNTHETIC_APP_VERSION}` }),
  ).toBeVisible()

  await page.evaluate(() => {
    const style = document.createElement('style')
    style.dataset.testid = 'dashboard-scroll-spacer-style'
    style.textContent =
      '[data-testid="shell-main"]::after { content: ""; display: block; height: 2000px; }'
    document.head.appendChild(style)
  })
  await scrollActiveRouteTo(page, 640)
  await expect.poll(() => getActiveRouteScrollY(page)).toBeGreaterThan(0)

  if (!isDesktopViewport(page)) {
    await page.getByRole('button', { name: 'ナビゲーションを開閉' }).click()
    await expect(page.getByTestId('shell-drawer')).toHaveAttribute('data-drawer-open', 'true')
    const viewport = page.viewportSize()
    await page.mouse.click((viewport?.width ?? 390) - 8, (viewport?.height ?? 760) - 8)
    await expect(page.getByTestId('shell-drawer')).toHaveAttribute('data-drawer-open', 'false')
    await page.getByRole('button', { name: 'ナビゲーションを開閉' }).click()
    await expect(page.getByTestId('shell-drawer')).toHaveAttribute('data-drawer-open', 'true')
  }
  await scrollActiveRouteTo(page, 640)
  await expect.poll(() => getActiveRouteScrollY(page)).toBeGreaterThan(0)

  await page.getByTestId('navigation-item-settings').click()

  await expect(page).toHaveURL(
    new RegExp(`/#/settings\\?timestamp=${SYNTHETIC_NAVIGATION_TIMESTAMP}$`),
  )
  await expect.poll(() => getActiveRouteScrollY(page)).toBe(0)
  await expect(page.getByTestId('title-bar').getByRole('heading', { name: '設定' })).toBeVisible()
  await expect(page.getByTestId('settings-card')).toBeVisible()

  await page.goBack()

  await expect(
    page.getByRole('heading', { name: `EPGStation v${SYNTHETIC_APP_VERSION}` }),
  ).toBeVisible()
  await expect
    .poll(() => getActiveRouteScrollY(page), {
      message: 'browser back restores the previous route scroll position',
    })
    .toBe(640)
  if (isDesktopViewport(page)) {
    await expect(page.getByTestId('navigation-item-settings')).toHaveAttribute(
      'data-selected',
      'false',
    )
  } else {
    await expect(page.getByTestId('navigation-item-settings')).toBeHidden()
  }
  await expect(page.getByTestId('shell-drawer')).toHaveAttribute(
    'data-drawer-open',
    isDesktopViewport(page) ? 'true' : 'false',
  )
})

test('shows a snackbar when the startup config request fails', async ({ page }) => {
  await installAppShellApiMocks(page, { mode: 'config-failure' })
  await installDashboardApiMocks(page)

  await page.goto('/')

  await expectAnnounced(page, '設定ダウンロードに失敗しました')
})

test('keeps dark snackbar message and action text white', async ({ page }) => {
  await installAppShellApiMocks(page, { mode: 'config-failure', forceDarkTheme: true })
  await installDashboardApiMocks(page)

  await page.goto('/')

  // The announcement is read from the record that outlives the snackbar; the colour has to be read
  // from the snackbar itself, which is only on screen while it is open. Reading the text first is
  // what establishes that the notification happened at all, so a colour check that finds nothing is
  // reported as the snackbar having closed rather than as a wrong colour.
  await expectAnnounced(page, '設定ダウンロードに失敗しました')
  const snackbar = page.getByRole('alert')
  await expect(snackbar).toHaveCSS('color', 'rgb(255, 255, 255)')
  await expect(snackbar.getByRole('button', { name: '閉じる' })).toHaveCSS(
    'color',
    'rgb(255, 255, 255)',
  )
})

test('selects broadcast-wave guide routes with unrelated query parameters', async ({ page }) => {
  await installAppShellApiMocks(page, { enableBroadcastWaveNavigation: true })

  await page.goto(
    `/#/guide?type=GR&time=synthetic-time&channelId=synthetic-channel&timestamp=${SYNTHETIC_NAVIGATION_TIMESTAMP}`,
  )

  if (!isDesktopViewport(page)) {
    await page.getByRole('button', { name: 'ナビゲーションを開閉' }).click()
  }

  await expect(page.getByTestId('navigation-item-guide-GR')).toBeVisible()
  await expect(page.getByTestId('navigation-item-guide-GR')).toHaveAttribute(
    'data-selected',
    'true',
  )
  await expect(page.getByTestId('navigation-item-guide-BS')).toHaveAttribute(
    'data-selected',
    'false',
  )
})

test('shows the minimal drawer items in order and selects the On Air item on /onair', async ({
  page,
}) => {
  await installAppShellApiMocks(page)
  await installGuideOnAirApiMocks(page)

  await page.goto('/#/onair')

  if (!isDesktopViewport(page)) {
    await page.getByRole('button', { name: 'ナビゲーションを開閉' }).click()
  }

  // A minimal server config (no broadcast wave navigation) shows a single 番組表 item and no
  // per-wave 番組表GR / 番組表BS items.
  const items = page.locator('[data-testid^="navigation-item-"] [class*="navigationLabel"]')
  await expect(items).toHaveText([
    'ダッシュボード',
    '放映中',
    '番組表',
    '録画中',
    '録画済み',
    'エンコード',
    '予約',
    '競合',
    '重複',
    '検索',
    'ルール',
    'ストレージ',
    '設定',
  ])
  await expect(page.getByTestId('navigation-item-onair')).toHaveAttribute('data-selected', 'true')
  await expect(page.getByTestId('navigation-item-dashboard')).toHaveAttribute(
    'data-selected',
    'false',
  )
  await expect(page.getByRole('button', { name: '番組表GR' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '番組表BS' })).toHaveCount(0)
})
