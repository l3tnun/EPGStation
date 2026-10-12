import { expect, test } from '@playwright/test'
import { installAppShellApiMocks } from './support/appShellMocks'
import { muiSelectInput, selectMuiOption } from './support/muiSelect'
import { createRecordedRequestLog, installRecordedApiMocks } from './support/recordedMocks'
import { installStoragesUploadApiMocks } from './support/storagesUploadMocks'
import { setRecordedBrowserSettings } from './support/recordedWorkflow'
import { getActiveRouteScrollY, scrollActiveRouteTo } from './support/routeScroll'
import { expectAnnounced } from './support/notificationObservation'

test.beforeEach(async ({ page }) => {
  await installAppShellApiMocks(page)
  await installStoragesUploadApiMocks(page)
})

test('restores the Recorded list scroll position after returning from detail', async ({ page }) => {
  await setRecordedBrowserSettings(page)
  await installRecordedApiMocks(page, 'long-list')

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/#/recorded?timestamp=recorded-scroll-restore')
  await expect(page.getByText('Synthetic Long Recorded 01')).toBeVisible()
  await scrollActiveRouteTo(page, 640)
  await expect.poll(() => getActiveRouteScrollY(page)).toBe(640)
  await expect
    .poll(() =>
      page.evaluate(
        () => window.sessionStorage.getItem('historyInfo')?.includes('"y":640') ?? false,
      ),
    )
    .toBe(true)

  await expect(
    page.getByRole('cell', { name: 'Synthetic Long Recorded 16', exact: true }),
  ).toBeVisible()
  await page.getByRole('cell', { name: 'Synthetic Long Recorded 16', exact: true }).click()
  await expect(page).toHaveURL(/#\/recorded\/detail\/9016(?:\?timestamp=\d+)?$/)
  await expect(page.getByTestId('recorded-detail-page')).toBeVisible()

  await page.goBack()

  await expect(page.getByTestId('recorded-page')).toBeVisible()
  await expect
    .poll(() => getActiveRouteScrollY(page), {
      message: 'Recorded list browser-back restores the exact previous scroll position',
    })
    .toBe(640)
})

test('restores each Recorded list page scroll position across multiple browser-back steps', async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      'settings',
      JSON.stringify({
        recordedLength: 10,
        isShowTableMode: true,
        isPreferredPlayingOnWeb: true,
        deleteRecordedDefaultValue: true,
      }),
    )
  })
  await installRecordedApiMocks(page, 'long-list')

  const pageScrolls = [
    { page: 1, scrollY: 160 },
    { page: 2, scrollY: 320 },
    { page: 3, scrollY: 480 },
    { page: 4, scrollY: 640 },
  ]

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/#/recorded')
  await expect(page.getByTestId('recorded-page')).toBeVisible()
  await page.evaluate(() => {
    const style = document.createElement('style')
    style.dataset.testid = 'recorded-multi-page-scroll-restore-style'
    style.textContent =
      '[data-testid="shell-main"]::after { content: ""; display: block; height: 2400px; } nav[aria-label="ページ"] { position: fixed; right: 16px; bottom: 16px; z-index: 10000; background: white; }'
    document.head.appendChild(style)
  })

  for (const { page: pageNumber, scrollY } of pageScrolls) {
    await expect(
      page.getByRole('button', { name: `${pageNumber} ページ`, exact: true }),
    ).toHaveAttribute('aria-current', 'page')
    await scrollActiveRouteTo(page, scrollY)
    await expect.poll(() => getActiveRouteScrollY(page)).toBe(scrollY)

    if (pageNumber < 4) {
      await page.getByRole('button', { name: `${pageNumber + 1} ページ`, exact: true }).click()
      await expect(page).toHaveURL(new RegExp(`/#/recorded\\?.*page=${pageNumber + 1}`))
      await expect(page.getByTestId('recorded-page')).toBeVisible()
    }
  }

  for (const { page: pageNumber, scrollY } of [...pageScrolls].reverse().slice(1)) {
    await page.goBack()
    await expect(
      page.getByRole('button', { name: `${pageNumber} ページ`, exact: true }),
    ).toHaveAttribute('aria-current', 'page')
    await expect
      .poll(() => getActiveRouteScrollY(page), {
        message: `Recorded page ${pageNumber} browser-back restores its own scroll position`,
      })
      .toBe(scrollY)
  }
})

test('continues restoring the Recorded list scroll position while the list layout settles', async ({
  page,
}) => {
  await setRecordedBrowserSettings(page)
  await installRecordedApiMocks(page, 'long-list')

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/#/recorded?timestamp=recorded-late-layout-scroll-restore')
  await expect(page.getByText('Synthetic Long Recorded 01')).toBeVisible()
  await page.evaluate(() => {
    const style = document.createElement('style')
    style.dataset.testid = 'recorded-late-layout-scroll-restore-style'
    style.textContent =
      '[data-testid="shell-main"]::after { content: ""; display: block; height: 2200px; }'
    document.head.appendChild(style)
  })
  await scrollActiveRouteTo(page, 640)
  await expect.poll(() => getActiveRouteScrollY(page)).toBe(640)

  await expect(
    page.getByRole('cell', { name: 'Synthetic Long Recorded 16', exact: true }),
  ).toBeVisible()
  await page.getByRole('cell', { name: 'Synthetic Long Recorded 16', exact: true }).click()
  await expect(page.getByTestId('recorded-detail-page')).toBeVisible()
  await page.evaluate(() => {
    document.querySelector('[data-testid="recorded-late-layout-scroll-restore-style"]')?.remove()
    const observer = new MutationObserver(() => {
      if (document.querySelector('[data-testid="recorded-page"]') === null) {
        return
      }

      observer.disconnect()
      window.setTimeout(() => {
        const style = document.createElement('style')
        style.dataset.testid = 'recorded-late-layout-scroll-restore-style'
        style.textContent =
          '[data-testid="shell-main"]::after { content: ""; display: block; height: 2200px; }'
        document.head.appendChild(style)
      }, 200)
    })
    observer.observe(document.body, { childList: true, subtree: true })
  })

  await page.goBack()

  await expect(page.getByTestId('recorded-page')).toBeVisible()
  await expect
    .poll(() => getActiveRouteScrollY(page), {
      message:
        'Recorded list keeps applying the saved scroll position until delayed layout growth finishes',
    })
    .toBe(640)
})

test('renders Recorded empty, error, and loading states without fixture leakage', async ({
  page,
}) => {
  await installRecordedApiMocks(page, 'empty')
  await page.goto('/#/recorded?timestamp=empty')
  await expect(page.getByTestId('recorded-page')).toHaveAttribute('data-recorded-total', '0')
  await expect(page.getByTestId('recorded-list-item')).toHaveCount(0)
  await expect(page.getByText(/empty/i)).toHaveCount(0)

  await page.unrouteAll()
  await installAppShellApiMocks(page)
  await installRecordedApiMocks(page, 'list-failure')
  await page.goto('/#/recorded?timestamp=error')
  await expect(page.getByTestId('recorded-error')).toContainText('録画データ取得に失敗')
  await expectAnnounced(page, '録画データ取得に失敗')
  await expect(page.getByText('synthetic-recorded-list-failure')).toHaveCount(0)

  await page.unrouteAll()
  await installAppShellApiMocks(page)
  await installRecordedApiMocks(page, 'slow-list')
  await page.goto('/#/recorded?timestamp=loading')
  await expect(page.getByTestId('recorded-loading')).toContainText('読み込み中')
  await expect(page.getByTestId('recorded-page')).toBeVisible()
})

test('submits Recorded search menu filters from loaded options', async ({ page }) => {
  await setRecordedBrowserSettings(page)
  const requestLog = createRecordedRequestLog()
  await installRecordedApiMocks(page, 'success', requestLog)

  await page.goto('/#/recorded')
  await page.getByRole('button', { name: '録画検索' }).click()

  const recordedSearchMenu = page.getByRole('menu', { name: '録画検索' })
  await recordedSearchMenu.getByLabel('キーワード').fill('Synthetic')
  await recordedSearchMenu.getByRole('button', { name: 'キーワードをクリア' }).click()
  await expect(recordedSearchMenu.getByLabel('キーワード')).toHaveValue('')

  // ルールは v2 と同じく、入力のたびに /rules/keyword?keyword=<入力> を叩く autocomplete。
  // 選択肢は id ではなく rule の keyword で選ぶ。
  const ruleCombobox = recordedSearchMenu.getByRole('combobox', { name: 'ルール' })
  await ruleCombobox.fill('Syn')
  await expect
    .poll(() => requestLog.apiPaths)
    .toContain('/api/rules/keyword?limit=1000&keyword=Syn')
  await page.getByRole('option', { name: 'Synthetic Recorded Rule' }).click()
  await expect(ruleCombobox).toHaveValue('Synthetic Recorded Rule')
  await selectMuiOption({ page, name: '放送局', value: '4101' })
  await expect(muiSelectInput(page, '放送局')).toHaveValue('4101')
  await selectMuiOption({ page, name: 'ジャンル', value: '7' })
  await expect(muiSelectInput(page, 'ジャンル')).toHaveValue('7')
  await expect(recordedSearchMenu.getByRole('button', { name: 'ルールをクリア' })).toBeVisible()
  await expect(recordedSearchMenu.getByRole('button', { name: '放送局をクリア' })).toBeVisible()
  await expect(recordedSearchMenu.getByRole('button', { name: 'ジャンルをクリア' })).toBeVisible()
  await recordedSearchMenu.getByRole('button', { name: '放送局をクリア' }).click()
  await expect(muiSelectInput(page, '放送局')).toHaveValue('')
  const channelCombobox = recordedSearchMenu.getByRole('combobox', { name: '放送局' })
  await expect(channelCombobox).toContainText('放送局')
  const clearedChannelLegacyLabel = channelCombobox.locator(
    'xpath=ancestor::label[1]/span[normalize-space(.)="放送局"]',
  )
  await expect(clearedChannelLegacyLabel).toBeHidden()
  await selectMuiOption({ page, name: '放送局', value: '4101' })
  await expect(ruleCombobox).toHaveValue('Synthetic Recorded Rule')
  await expect(channelCombobox).toContainText('Synthetic Recorded Channel')
  const selectedChannelLabelBox = await clearedChannelLegacyLabel.boundingBox()
  const selectedChannelBox = await channelCombobox.boundingBox()
  const selectedChannelPaddingTop = await channelCombobox.evaluate((node) =>
    Number.parseFloat(window.getComputedStyle(node).paddingTop),
  )
  expect(selectedChannelLabelBox).not.toBeNull()
  expect(selectedChannelBox).not.toBeNull()
  if (selectedChannelLabelBox !== null && selectedChannelBox !== null) {
    expect(selectedChannelLabelBox.y + selectedChannelLabelBox.height).toBeLessThanOrEqual(
      selectedChannelBox.y + selectedChannelPaddingTop,
    )
  }
  await expect(recordedSearchMenu.getByRole('combobox', { name: 'ジャンル' })).toContainText(
    'Synthetic Recorded Genre',
  )
  await page.getByLabel('元ファイルを含む').check()
  await page.getByRole('button', { name: '検索' }).click()

  await expect(page).toHaveURL(
    /#\/recorded\?ruleId=5101&channelId=4101&genre=7&hasOriginalFile=true&timestamp=\d+$/,
  )
  await expect
    .poll(() => requestLog.apiPaths)
    .toContain(
      '/api/recorded?isHalfWidth=true&limit=24&offset=0&ruleId=5101&channelId=4101&genre=7&hasOriginalFile=true',
    )
})

// Source B: v2 build output client/dist/css/chunk-vendors.*.css —
// `.theme--light.v-data-table>...>tr:hover:not(...){background:#eee}`
test('changes Recorded table row background on hover like v2', async ({ page }) => {
  await setRecordedBrowserSettings(page)
  await installRecordedApiMocks(page)

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/#/recorded')

  const row = page.getByRole('row', { name: /Synthetic Recorded Matrix A/ })
  const beforeHover = await row.evaluate((element) => getComputedStyle(element).backgroundColor)
  await row.hover()
  await expect
    .poll(() => row.evaluate((element) => getComputedStyle(element).backgroundColor))
    .toBe('rgb(238, 238, 238)')
  expect(beforeHover).not.toBe('rgb(238, 238, 238)')
})
