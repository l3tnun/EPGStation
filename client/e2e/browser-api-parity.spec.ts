import { expect, test, type Page } from '@playwright/test'
import { installAppShellApiMocks } from './support/appShellMocks'
import { installBroadcastWorkflowMocks } from './support/broadcastWorkflow'
import { guideStartAt } from './support/guideOnAirFixtures'
import { expectAnnounced } from './support/notificationObservation'

/*
 * unit test は jsdom の上で、localStorage を自前の Map、timer を fake timers に置き換えている。同じ振る舞いを本物の
 * browser の部品（本物の localStorage の容量の上限と access の拒否、保存済みの古い設定の読み込み、browser の timer と
 * Date による更新）で確かめる。
 */

const savedSettings = (page: Page) =>
  page.evaluate(
    () =>
      JSON.parse(window.localStorage.getItem('settings') ?? 'null') as Record<
        string,
        unknown
      > | null,
  )

test('announces a save failure when the real localStorage quota is exhausted', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await installAppShellApiMocks(page, { enableBroadcastWaveNavigation: false })
  await page.goto('/#/settings')
  await expect(page.getByTestId('navigation-item-guide')).toBeVisible()

  // 本物の容量の上限まで埋める（偽物の test は setItem を書き換えて投げさせる）。
  const filled = await page.evaluate(() => {
    const draft = JSON.parse(window.localStorage.getItem('settings') ?? 'null') as Record<
      string,
      unknown
    >
    draft.isEnableDisplayForEachBroadcastWave = true
    // 既存値の縮小置換は容量上限でも成功し得るため、新規保存の容量拒否を作る。
    window.localStorage.removeItem('settings')
    let total = 0
    for (let size = 1024 * 1024; size >= 1; size = Math.floor(size / 2)) {
      for (;;) {
        try {
          window.localStorage.setItem(`synthetic-filler-${total}`, 'x'.repeat(size))
          total += size
        } catch (error) {
          if ((error as DOMException).name !== 'QuotaExceededError') throw error
          break
        }
      }
    }
    let settingsWriteError: string | null = null
    try {
      window.localStorage.setItem('settings', JSON.stringify(draft))
    } catch (error) {
      settingsWriteError = (error as DOMException).name
    }
    return { total, settingsWriteError, persisted: window.localStorage.getItem('settings') }
  })
  expect(filled.total).toBeGreaterThan(1024 * 1024)
  expect(filled.settingsWriteError).toBe('QuotaExceededError')
  expect(filled.persisted).toBeNull()

  await page.getByRole('switch', { name: '番組表 放送波種別表示' }).check()
  await page.getByRole('button', { name: '保存' }).click()

  await expectAnnounced(page, '設定の保存に失敗しました')
  await expect(page.getByTestId('navigation-item-guide-GR')).toHaveCount(0)
  expect(await savedSettings(page)).toBeNull()
})

test('starts with defaults and announces a save failure when the browser refuses localStorage access', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  // 初期設定を書かず、複数 init script の評価順に依存せず storage の拒否を再現する。
  await installAppShellApiMocks(page, { seedSettings: false })
  // cookie と site data を拒否した browser は、localStorage の参照そのものを SecurityError で拒む。
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('The operation is insecure.', 'SecurityError')
      },
    })
  })
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))

  await page.goto('/#/settings')
  await expect(page.getByTestId('app-shell')).toBeVisible()
  await expect(page.getByRole('switch', { name: '全般 PWA' })).toBeChecked()

  await page.getByRole('switch', { name: '番組表 放送波種別表示' }).check()
  await page.getByRole('button', { name: '保存' }).click()
  await expectAnnounced(page, '設定の保存に失敗しました')
  await expect(page.getByTestId('navigation-item-guide')).toBeVisible()
  await expect(page.getByTestId('navigation-item-guide-GR')).toHaveCount(0)
  expect(pageErrors).toEqual([])
})

test('repairs settings saved by an older client and keeps the valid values', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.addInitScript(() => {
    if (window.sessionStorage.getItem('synthetic-seeded') === null) {
      window.sessionStorage.setItem('synthetic-seeded', '1')
      window.localStorage.setItem(
        'settings',
        JSON.stringify({
          shouldUseOSColorTheme: false,
          isForceDarkTheme: true,
          isEnablePWA: 'synthetic-not-a-boolean',
          syntheticRemovedKey: true,
        }),
      )
    }
  })
  await installAppShellApiMocks(page, { forceDarkTheme: true })

  await page.goto('/#/settings')
  await expect(page.getByTestId('app-shell')).toHaveAttribute('data-theme-mode', 'dark')
  // 型の違う値は既定値（PWA は有効）に戻る。
  await expect(page.getByRole('switch', { name: '全般 PWA' })).toBeChecked()

  await page.getByRole('button', { name: '保存' }).click()
  await expectAnnounced(page, '保存されました')
  // 保存は、型の違う保存済みの値（画面では既定値として扱う）と、今の client が知らない key をそのまま残す。
  const saved = await savedSettings(page)
  expect(saved).toMatchObject({
    shouldUseOSColorTheme: false,
    isForceDarkTheme: true,
    isEnablePWA: 'synthetic-not-a-boolean',
    syntheticRemovedKey: true,
  })
})

test('refreshes the on-air list when the real browser timer reaches the end of the current program', async ({
  page,
}) => {
  const broadcastingRequests: number[] = []
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.endsWith('/api/schedules/broadcasting')) {
      broadcastingRequests.push(Date.now())
    }
  })
  // 番組 5101 は 07:00〜08:00。終わる 2 分前の時刻で browser の時計を始める。
  await page.clock.install({ time: guideStartAt + 58 * 60 * 1000 })
  await installBroadcastWorkflowMocks(page)
  // 偽 API の init script は Date.now を固定の時刻にする。browser の時計（page.clock）で進むように戻す。
  await page.addInitScript(() => {
    Date.now = () => new Date().getTime()
  })

  await page.goto('/#/onair')
  await expect(page.getByTestId('onair-card-5101')).toBeVisible()
  await expect.poll(() => broadcastingRequests.length).toBeGreaterThan(0)
  const initialRequests = broadcastingRequests.length

  await page.clock.runFor('01:00')
  expect(broadcastingRequests.length).toBe(initialRequests)

  await page.clock.runFor('01:30')
  await expect.poll(() => broadcastingRequests.length).toBeGreaterThan(initialRequests)
})
