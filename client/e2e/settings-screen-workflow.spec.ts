import { expect, test } from '@playwright/test'
import { installAppShellApiMocks } from './support/appShellMocks'
import { expectAnnounced } from './support/notificationObservation'

async function readSavedSettings(page: import('@playwright/test').Page) {
  return page.evaluate(() => JSON.parse(window.localStorage.getItem('settings') ?? '{}'))
}

test('saves settings changes and regenerates broadcast-wave navigation', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await installAppShellApiMocks(page, { enableBroadcastWaveNavigation: false })
  await page.goto('/#/settings')

  await expect(page.getByTestId('navigation-item-guide')).toBeVisible()
  await expect(page.getByTestId('navigation-item-guide-GR')).toHaveCount(0)

  const guideWaveSwitch = page.getByRole('switch', { name: '番組表 放送波種別表示' })
  await guideWaveSwitch.check()
  await expect(guideWaveSwitch).toBeChecked()
  await expect
    .poll(() => readSavedSettings(page))
    .toMatchObject({
      isEnableDisplayForEachBroadcastWave: false,
    })
  await expect(page.getByTestId('navigation-item-guide')).toBeVisible()

  await page.getByRole('button', { name: '保存' }).click()

  await expectAnnounced(page, '保存されました')
  await expect
    .poll(() => readSavedSettings(page))
    .toMatchObject({
      isEnableDisplayForEachBroadcastWave: true,
    })
  await expect(page.getByTestId('navigation-item-guide-GR')).toBeVisible()
  await expect(page.getByTestId('navigation-item-guide')).toHaveCount(0)
})

test('[AC 1.17] keeps settings select controls operable through the styled field surface', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await installAppShellApiMocks(page)
  await page.goto('/#/settings')

  const guideModeSelect = page.getByRole('combobox', { name: '番組表 描画設定' })
  await expect(guideModeSelect).toBeVisible()
  await guideModeSelect.click()
  await page.getByRole('option', { name: '最小' }).click()

  await expect(guideModeSelect).toHaveText('最小')
})

test('[AC 1.18] renders settings select controls with MUI select without blank native options', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await installAppShellApiMocks(page)
  await page.goto('/#/settings')

  const guideModeSelect = page.getByRole('combobox', { name: '番組表 描画設定' })
  await expect(guideModeSelect).toBeVisible()
  await expect(guideModeSelect).toHaveClass(/MuiSelect-select/)
  await expect(page.locator('select')).toHaveCount(0)
  await expect(page.locator('option[value=""]')).toHaveCount(0)

  await guideModeSelect.click()
  await expect(page.getByRole('listbox')).toBeVisible()
  await expect(page.getByRole('option').first()).toHaveText(/^\S/)
})

test('keeps Settings bottom spacer, URL Scheme input, and action button visual parity', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await installAppShellApiMocks(page)
  await page.goto('/#/settings')

  const settingsScreen = page.getByTestId('settings-screen')
  const settingsCard = page.getByTestId('settings-card')
  await expect(settingsScreen).toBeVisible()
  await expect(settingsCard).toBeVisible()
  await expect
    .soft(
      settingsScreen
        .locator('[aria-hidden="true"]')
        .last()
        .evaluate((node) => ({
          height: Math.round(node.getBoundingClientRect().height),
          visibility: getComputedStyle(node).visibility,
        })),
      'Settings keeps the source-compatible invisible bottom spacer after the card',
    )
    .resolves.toEqual({ height: 24, visibility: 'hidden' })

  const onAirSchemeInput = page.getByRole('textbox', { name: '放映中 視聴 URL Scheme' })
  const onAirSchemeRow = onAirSchemeInput.locator('xpath=ancestor::label[1]')
  await expect(onAirSchemeInput).toBeVisible()
  await expect(onAirSchemeInput).toHaveCSS('border-bottom-width', '1px')
  await page.getByRole('switch', { name: '録画 視聴 URL Scheme' }).check()
  await page.getByRole('switch', { name: '録画 ダウンロード URL Scheme' }).check()
  const schemePlaceholderMechanism = await page.evaluate(() => {
    return ['放映中 視聴 URL Scheme', '録画 視聴 URL Scheme', '録画 ダウンロード URL Scheme'].map(
      (label) => {
        const input = document.querySelector<HTMLInputElement>(
          `input[type="text"][aria-label="${label}"]`,
        )
        const row = input?.closest('label')
        const fakePlaceholder = row?.querySelector('span[aria-hidden="true"]')

        return {
          label,
          fakePlaceholderCount: fakePlaceholder === null ? 0 : 1,
          placeholder: input?.getAttribute('placeholder') ?? '',
        }
      },
    )
  })
  expect(schemePlaceholderMechanism).toEqual([
    {
      label: '放映中 視聴 URL Scheme',
      fakePlaceholderCount: 0,
      placeholder: 'URL',
    },
    {
      label: '録画 視聴 URL Scheme',
      fakePlaceholderCount: 0,
      placeholder: 'URL',
    },
    {
      label: '録画 ダウンロード URL Scheme',
      fakePlaceholderCount: 0,
      placeholder: 'URL',
    },
  ])
  const schemeInputLabels = [
    '放映中 視聴 URL Scheme',
    '録画 視聴 URL Scheme',
    '録画 ダウンロード URL Scheme',
  ]

  for (const label of schemeInputLabels) {
    const input = page.getByRole('textbox', { name: label })
    await input.fill(`synthetic-view://${label}`)
  }

  await expect(onAirSchemeRow.locator('span[aria-hidden="true"]', { hasText: 'URL' })).toHaveCount(
    0,
  )
  await expect(onAirSchemeInput).toHaveValue('synthetic-view://放映中 視聴 URL Scheme')
  for (const label of schemeInputLabels) {
    const clearButtonGeometry = await page
      .getByRole('button', { name: `${label}をクリア` })
      .evaluate((button, inputLabel) => {
        const input = document.querySelector<HTMLInputElement>(
          `input[type="text"][aria-label="${inputLabel}"]`,
        )
        const buttonBox = button.getBoundingClientRect()
        const inputBox = input?.getBoundingClientRect()

        return {
          centerDelta:
            inputBox === undefined
              ? Number.POSITIVE_INFINITY
              : Math.abs(
                  buttonBox.top + buttonBox.height / 2 - (inputBox.top + inputBox.height / 2),
                ),
          rightDelta:
            inputBox === undefined
              ? Number.POSITIVE_INFINITY
              : Math.abs(buttonBox.right - inputBox.right),
        }
      }, label)
    // Provenance (D), corrected: these URL Scheme rows render via
    // src/features/settings/components/SettingsSchemeControl.tsx, not ClearableTextField.tsx (that
    // component is unused here). SettingsPage.module.css gives both `.textControl` (the input) and
    // `.textControlClearButton` the same `grid-area: 1 / 1` and `height: 32px`, so they occupy the
    // same grid cell and are pixel-aligned by design; the 1px tolerance only covers sub-pixel
    // rounding between the two independent bounding-rect reads.
    expect(clearButtonGeometry.centerDelta).toBeLessThanOrEqual(1)
    expect(clearButtonGeometry.rightDelta).toBeLessThanOrEqual(1)
  }
  await page.getByRole('button', { name: '放映中 視聴 URL Schemeをクリア' }).click()
  await expect(onAirSchemeInput).toHaveValue('')

  const actions = page.getByTestId('settings-card').locator('div[class*="_actions_"]').last()
  await expect
    .soft(
      actions.evaluate((node) => ({
        minHeight: getComputedStyle(node).minHeight,
        padding: getComputedStyle(node).padding,
        justifyContent: getComputedStyle(node).justifyContent,
      })),
      'Settings action row keeps source-like v-card-actions geometry',
    )
    .resolves.toEqual({
      minHeight: '52px',
      padding: '8px',
      justifyContent: 'flex-end',
    })
  await expect(page.getByRole('button', { name: 'リセット' })).toHaveCSS(
    'background-color',
    'rgba(0, 0, 0, 0)',
  )
  await expect(page.getByRole('button', { name: '保存' })).toHaveCSS(
    'background-color',
    'rgba(0, 0, 0, 0)',
  )
})

test('previews theme changes, resets without persistence, and discards unsaved edits on leave', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await installAppShellApiMocks(page, { forceDarkTheme: false })
  await page.goto('/#/settings')

  await expect(page.getByTestId('app-shell')).toHaveAttribute('data-theme-mode', 'light')

  await page.getByRole('switch', { name: '全般 PWA' }).click()
  await page.getByRole('switch', { name: '全般 ダークテーマ' }).click()

  await expect(page.getByTestId('app-shell')).toHaveAttribute('data-theme-mode', 'dark')
  const savedBeforeReset = await readSavedSettings(page)

  expect(savedBeforeReset).toMatchObject({
    isEnablePWA: true,
    shouldUseOSColorTheme: false,
    isForceDarkTheme: false,
  })

  await page.getByRole('button', { name: 'リセット' }).click()

  await expect(page.getByRole('switch', { name: '全般 OSカラーテーマ' })).toBeChecked()
  await expect(page.getByTestId('app-shell')).toHaveAttribute('data-theme-mode', 'light')
  await expect
    .poll(() => readSavedSettings(page))
    .toMatchObject({
      shouldUseOSColorTheme: false,
      isForceDarkTheme: false,
    })

  await page.getByRole('switch', { name: '全般 OSカラーテーマ' }).click()
  await page.getByRole('switch', { name: '全般 ダークテーマ' }).click()
  await expect(page.getByTestId('app-shell')).toHaveAttribute('data-theme-mode', 'dark')

  await page.getByTestId('navigation-item-dashboard').click()

  await expect(
    page.getByTestId('title-bar').getByRole('heading', { name: 'EPGStation' }),
  ).toBeVisible()
  await expect(page.getByTestId('app-shell')).toHaveAttribute('data-theme-mode', 'light')
  await expect
    .poll(() => readSavedSettings(page))
    .toMatchObject({
      shouldUseOSColorTheme: false,
      isForceDarkTheme: false,
    })
})

test('uses legacy-compatible dark chrome for shell and switches', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await installAppShellApiMocks(page, { forceDarkTheme: true })
  await page.goto('/#/settings')

  await expect(page.getByTestId('app-shell')).toHaveAttribute('data-theme-mode', 'dark')
  await expect(page.getByTestId('title-bar')).toHaveCSS('background-color', 'rgb(39, 39, 39)')

  await expect(page.getByTestId('shell-drawer').locator('[role="presentation"]').first()).toHaveCSS(
    'background-color',
    'rgb(30, 30, 30)',
  )

  const darkSwitch = page.getByRole('switch', { name: '全般 ダークテーマ' })
  await expect(darkSwitch).toHaveCSS('width', '38px')
  await expect
    .poll(() =>
      darkSwitch.evaluate((switchElement) => ({
        thumb: getComputedStyle(switchElement, '::before').backgroundColor,
        track: getComputedStyle(switchElement, '::after').backgroundColor,
      })),
    )
    .toEqual({
      thumb: 'rgb(144, 202, 249)',
      track: 'rgba(144, 202, 249, 0.5)',
    })
  if (testInfo.project.name === 'Desktop Chromium') {
    await expect(darkSwitch).toHaveScreenshot('settings-dark-theme-switch.png')
  }
})

test('announces a save failure and keeps the previous navigation when storage rejects the write', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await installAppShellApiMocks(page, { enableBroadcastWaveNavigation: false })
  await page.goto('/#/settings')

  await expect(page.getByTestId('navigation-item-guide')).toBeVisible()
  await page.getByRole('switch', { name: '番組表 放送波種別表示' }).check()
  await page.evaluate(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException('Synthetic quota exceeded', 'QuotaExceededError')
    }
  })
  await page.getByRole('button', { name: '保存' }).click()

  await expectAnnounced(page, '設定の保存に失敗しました')
  await expect(page.getByTestId('shell-announced-notification')).not.toHaveAttribute(
    'data-announced-history',
    /保存されました/,
  )
  await expect(page.getByTestId('navigation-item-guide')).toBeVisible()
  await expect(page.getByTestId('navigation-item-guide-GR')).toHaveCount(0)
})
