import { expect, test } from '@playwright/test'
import { installAppShellApiMocks } from './support/appShellMocks'
import { muiSelectInput } from './support/muiSelect'
import {
  SYNTHETIC_RECORDED_DETAIL_ID,
  SYNTHETIC_RECORDED_ENCODED_VIDEO_ID,
  SYNTHETIC_RECORDED_ORIGINAL_VIDEO_ID,
  SYNTHETIC_RECORDED_RECORDING_DETAIL_ID,
  SYNTHETIC_RECORDED_ZERO_DROP_DETAIL_ID,
  createRecordedRequestLog,
  installRecordedApiMocks,
} from './support/recordedMocks'
import { installStoragesUploadApiMocks } from './support/storagesUploadMocks'
import { setRecordedBrowserSettings } from './support/recordedWorkflow'

test.beforeEach(async ({ page }) => {
  await installAppShellApiMocks(page)
  await installStoragesUploadApiMocks(page)
})

test('renders detail actions, dialogs, linkify, and adjacent handoffs', async ({ page }) => {
  await setRecordedBrowserSettings(page)
  await page.addInitScript(() => {
    window.localStorage.setItem(
      'SendVideoFileSelectHostSetting',
      JSON.stringify({ hostName: 'kodi-one' }),
    )
    window.localStorage.setItem(
      'RecordedSelectStreamSetting',
      JSON.stringify({ type: 'HLS', mode: 0 }),
    )
  })
  const requestLog = createRecordedRequestLog()
  await installRecordedApiMocks(page, 'success', requestLog)

  await page.goto(`/#/recorded/detail/${SYNTHETIC_RECORDED_DETAIL_ID}`)

  await expect(
    page.getByTestId('title-bar').getByRole('heading', { name: '録画詳細' }),
  ).toBeVisible()
  await expect(page.getByTestId('recorded-detail-page')).toContainText('Synthetic Detail Target')
  const link = page.getByRole('link', { name: 'https://example.invalid/recorded/detail' })
  await expect(link).toHaveAttribute('target', '_blank')
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer')

  await page.getByRole('button', { name: 'streaming' }).click()
  await page.getByRole('button', { name: 'Synthetic Encoded MP4' }).click()
  await expect(page.getByRole('dialog', { name: 'ストリーム選択' })).toBeVisible()
  await expect(muiSelectInput(page, '配信方式')).toHaveValue('HLS')
  const streamDialog = page.getByRole('dialog', { name: 'ストリーム選択' })
  await expect(streamDialog.getByRole('combobox', { name: '配信方式' })).toHaveCSS('height', '32px')
  await expect(streamDialog.getByRole('combobox', { name: '画質' })).toHaveCSS('height', '32px')
  await page.getByRole('button', { name: '視聴' }).click()
  await expect(page).toHaveURL(
    new RegExp(
      `/#/recorded/streaming/${SYNTHETIC_RECORDED_ENCODED_VIDEO_ID}\\?recordedId=${SYNTHETIC_RECORDED_DETAIL_ID}&streamingType=hls&mode=0&fileType=encoded&timestamp=\\d+$`,
    ),
  )

  await page.goto(`/#/recorded/detail/${SYNTHETIC_RECORDED_DETAIL_ID}`)
  await page.getByRole('button', { name: '録画詳細メニュー: Synthetic Detail Target' }).click()
  await page.getByRole('menuitem', { name: 'download' }).click()
  await expect(page.getByRole('dialog', { name: '録画ダウンロード' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Synthetic Encoded MP4 (2.2MB)' })).toHaveAttribute(
    'href',
    /\/api\/videos\/8402\?isDownload=true$/,
  )
  await expect(
    page.getByRole('link', { name: 'Synthetic Encoded MP4', exact: true }),
  ).toHaveAttribute('href', /\/api\/videos\/8402\/playlist$/)
  await page.getByRole('button', { name: '閉じる' }).click()

  await page.getByRole('button', { name: 'kodi' }).click()
  await expect(page.getByRole('dialog', { name: 'Kodi 送信' })).toBeVisible()
  await expect(muiSelectInput(page, 'kodi host')).toHaveValue('kodi-one')
  await expect(
    page.getByRole('dialog', { name: 'Kodi 送信' }).getByRole('combobox', { name: 'kodi host' }),
  ).toHaveCSS('height', '32px')
  await page.getByRole('button', { name: 'Synthetic Encoded MP4' }).click()
  await expect.poll(() => requestLog.bodies).toContainEqual({ kodiName: 'kodi-one' })
  expect(requestLog.bodies).toContainEqual({ kodiName: 'kodi-one' })
  await page.getByRole('button', { name: '閉じる' }).click()

  await page.getByRole('button', { name: 'encode', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'エンコード追加' })).toBeVisible()
  const encodeDialog = page.getByRole('dialog', { name: 'エンコード追加' })
  await expect(encodeDialog).toHaveCSS('max-width', '500px')
  await expect(encodeDialog).toHaveJSProperty(
    'scrollWidth',
    await encodeDialog.evaluate((node) => node.clientWidth),
  )
  const sourceSelect = muiSelectInput(encodeDialog, 'source')
  const presetSelect = muiSelectInput(encodeDialog, 'preset')
  const recordedSelect = muiSelectInput(encodeDialog, 'recorded')
  const subDirectoryInput = encodeDialog.getByLabel('sub directory')
  await expect(sourceSelect).toHaveValue(String(SYNTHETIC_RECORDED_ORIGINAL_VIDEO_ID))
  await expect(presetSelect).toHaveValue('synthetic-encode-main')
  for (const name of ['source', 'preset', 'recorded']) {
    await expect(encodeDialog.getByRole('combobox', { name })).toHaveCSS('height', '32px')
  }
  await expect(sourceSelect).toHaveCSS('appearance', 'none')
  await expect(presetSelect).toHaveCSS('appearance', 'none')
  await expect(recordedSelect).toHaveCSS('appearance', 'none')
  await expect(recordedSelect).toBeEnabled()
  await subDirectoryInput.fill('synthetic/encode/sub')
  await encodeDialog.getByRole('button', { name: 'sub directoryをクリア' }).click()
  await expect(subDirectoryInput).toHaveValue('')
  await page.getByLabel('元ファイルと同じ場所に保存する').check()
  await expect(recordedSelect).toBeDisabled()
  await expect(subDirectoryInput).toBeDisabled()
  await page.getByRole('button', { name: '追加' }).click()
  await expect
    .poll(() => requestLog.bodies)
    .toContainEqual({
      recordedId: SYNTHETIC_RECORDED_DETAIL_ID,
      sourceVideoFileId: SYNTHETIC_RECORDED_ORIGINAL_VIDEO_ID,
      mode: 'synthetic-encode-main',
      removeOriginal: false,
      isSaveSameDirectory: true,
    })
})

test('keeps zero drop detail metadata neutral while preserving drop log access', async ({
  page,
}) => {
  await setRecordedBrowserSettings(page)
  await installRecordedApiMocks(page)

  await page.goto(`/#/recorded/detail/${SYNTHETIC_RECORDED_ZERO_DROP_DETAIL_ID}`)

  const dropButton = page.getByRole('button', {
    name: /drop: 0, error: 0, scrambling: 0/,
  })
  await expect(dropButton).toBeVisible()
  await expect(dropButton).toHaveAttribute('data-has-drop-error', 'false')
  await dropButton.click()
  const dropDialog = page.getByRole('dialog', { name: 'Synthetic Zero Drop Detail' })
  await expect(dropDialog).toBeVisible()
  await expect(dropDialog).toHaveCSS('max-width', '600px')
  await expect(dropDialog.locator('pre')).toHaveCSS('font-size', '14px')
  await expect(dropDialog.locator('pre')).toHaveCSS('color', 'rgba(0, 0, 0, 0.87)')
  await expect(dropDialog).toContainText('Synthetic drop log content')
})

test('hides Recorded detail drop metadata while recording even if zero drop counters exist', async ({
  page,
}) => {
  await setRecordedBrowserSettings(page)
  await installRecordedApiMocks(page)

  await page.goto(`/#/recorded/detail/${SYNTHETIC_RECORDED_RECORDING_DETAIL_ID}`)

  await expect(page.getByTestId('recorded-detail-page')).toBeVisible()
  await expect(page.getByText('Synthetic Recording Detail')).toBeVisible()
  await expect(page.getByRole('button', { name: /drop: 0, error: 0, scrambling: 0/ })).toHaveCount(
    0,
  )
})

test('matches legacy Recorded detail content width and padding', async ({ page }) => {
  await setRecordedBrowserSettings(page)
  await installRecordedApiMocks(page)

  await page.setViewportSize({ width: 959, height: 900 })
  await page.goto(`/#/recorded/detail/${SYNTHETIC_RECORDED_DETAIL_ID}`)

  const detailPage = page.getByTestId('recorded-detail-page')
  await expect(detailPage).toBeVisible()
  // Vuetify's v-container has no max-width below the 960px (md) breakpoint, so the detail content
  // fills the whole viewport at 959px instead of stopping at 900px.
  await expect(detailPage).toHaveCSS('max-width', 'none')
  await expect
    .poll(() => detailPage.evaluate((node) => Math.round(node.getBoundingClientRect().width)))
    .toBe(959)

  await page.setViewportSize({ width: 960, height: 900 })
  await expect(detailPage).toHaveCSS('max-width', '900px')
  await page.setViewportSize({ width: 1000, height: 900 })
  // Source B: v2 build output client/dist/css/chunk-vendors.*.css carries the Vuetify v-container
  // 3-tier max-width — @media(min-width:960px){900px}, (min-width:1264px){1185px}, (min-width:1904px){1785px}
  // — past the 960px breakpoint instead of capping at 900px on wide viewports.
  await expect(detailPage).toHaveCSS('max-width', '900px')

  const renderedWidth = () =>
    detailPage.evaluate((node) => Math.round(node.getBoundingClientRect().width))
  const drawerToggle = page.getByRole('button', { name: 'ナビゲーションを開閉' })

  await page.setViewportSize({ width: 1440, height: 900 })
  await expect(detailPage).toHaveCSS('max-width', '1185px')
  // Source C: the max-width above is only the CSS declaration; nothing here asserted the
  // *rendered* width, so a regression that kept the box at 900px despite a correct max-width
  // (e.g. a stray width/flex constraint upstream) would go undetected. AppShell's shell-content
  // box carries a `margin-left: drawerLayout.mainContentOffset` and no explicit width of its own
  // (client/src/app/AppShell.tsx), so it fills whatever width the browser's own block layout
  // leaves after that margin, and APP_SHELL_DRAWER_WIDTH is 256 with the desktop drawer open by
  // default at this breakpoint (client/src/app/drawerLayout.ts). At a 1440px viewport that leaves
  // the container's parent 1440 - 256 = 1184px wide, which is narrower than the 1185px tier
  // above, so the tier never binds and the container fills its parent exactly. Measured via
  // `npx playwright test e2e/recorded-detail-workflow.spec.ts -g 'matches legacy Recorded detail
  // content width and padding'` against a container image of the app built from the same tree, on
  // all 4 projects (Desktop Chromium/Firefox, Android Chrome, iOS Safari): 1184px on all of them.
  await expect.poll(renderedWidth).toBe(1184)

  // Closing the drawer drops AppShell's content offset from 256 to 0
  // (client/src/app/drawerLayout.ts mainContentOffset), so the container's parent widens to the
  // full 1440px viewport — wider than the 1185px tier above, which now binds instead. Measured the
  // same way as above: 1185px on all 4 projects.
  await drawerToggle.click()
  await expect.poll(renderedWidth).toBe(1185)
  // Reopen the drawer so the 1920px viewport below starts from the same "drawer open by default"
  // state as the 1440px viewport did, rather than carrying over the closed state from this check.
  await drawerToggle.click()
  await expect.poll(renderedWidth).toBe(1184)

  await page.setViewportSize({ width: 1920, height: 1080 })
  await expect(detailPage).toHaveCSS('max-width', '1785px')
  // Same reasoning at the 1904px breakpoint: 1920 - 256 (drawer) = 1664px, still narrower than the
  // 1785px tier, so the container is still bound by the drawer-adjusted content width rather than
  // the tier. Measured the same way as above: 1664px on all 4 projects.
  await expect.poll(renderedWidth).toBe(1664)

  // Closing the drawer widens the parent to the full 1920px viewport, past the 1785px tier, which
  // now binds. Measured the same way as above: 1785px on all 4 projects.
  await drawerToggle.click()
  await expect.poll(renderedWidth).toBe(1785)

  // Reopen the drawer before widening further, so the 2400px check below measures "drawer open"
  // rather than carrying over the closed state from the check above.
  await drawerToggle.click()
  await page.setViewportSize({ width: 2400, height: 1080 })
  // Drawer open at 2400px: the parent is 2400 - 256 = 2144px, still wider than the 1785px tier, so
  // the tier binds regardless of the drawer. Measured the same way as above: 1785px on all 4
  // projects.
  await expect.poll(renderedWidth).toBe(1785)

  await page.setViewportSize({ width: 1000, height: 900 })
  await expect(detailPage).toHaveCSS('padding-top', '12px')
  await expect(detailPage).toHaveCSS('padding-right', '12px')
  await expect(detailPage).toHaveCSS('padding-bottom', '12px')
  await expect(detailPage).toHaveCSS('padding-left', '12px')

  const channel = detailPage.getByText('Synthetic Recorded Channel')
  await expect(channel).toHaveCSS('font-size', '16px')
  await expect(channel).toHaveCSS('line-height', '28px')
  const genre = detailPage.getByText('Synthetic Recorded Genre')
  await expect(genre).toHaveCSS('font-size', '14px')
  await expect(genre).toHaveCSS('line-height', '22px')

  const detailHero = page.getByTestId('recorded-detail-hero')
  await expect(detailHero).toHaveCSS('grid-template-columns', /400px/)
  const detailNoImage = detailHero.getByTestId('recorded-no-image')
  await expect(detailNoImage).toHaveAttribute('src', './img/noimg.png')
  await expect(detailNoImage).toHaveCSS('background-color', /rgba?\(0, 0, 0, 0\)/)
  await expect(detailNoImage).toHaveCSS('border-radius', '0px')
  await expect(detailNoImage).toHaveCSS('max-height', '400px')

  await page.setViewportSize({ width: 790, height: 900 })
  await expect(detailHero).toHaveCSS('grid-template-columns', /^766px$/)
  await expect(detailNoImage).toHaveCSS('max-height', '240px')

  const extended = detailPage.getByText(/Synthetic detail link/)
  await expect(extended).toHaveCSS('padding-top', '0px')
})

test('keeps Recorded detail dialogs animated on open', async ({ page }) => {
  await setRecordedBrowserSettings(page)
  await installRecordedApiMocks(page)

  await page.goto(`/#/recorded/detail/${SYNTHETIC_RECORDED_DETAIL_ID}`)
  await page.getByRole('button', { name: 'streaming' }).click()
  await page.getByRole('button', { name: 'Synthetic Encoded MP4' }).click()

  const dialog = page.getByRole('dialog', { name: 'ストリーム選択' })
  await expect(dialog).toBeVisible()
  await expect
    .poll(() =>
      dialog.evaluate((element) => {
        const style = getComputedStyle(element)
        return (
          Number.parseFloat(style.transitionDuration) + Number.parseFloat(style.animationDuration)
        )
      }),
    )
    // RecordedPlainDialog renders a plain MUI Dialog without a custom transitionDuration, so the
    // Fade/Grow transition falls back to MUI's default enter/leave durations (node_modules/@mui/material/Dialog/Dialog.js
    // defaultTransitionDuration, backed by createTransitions.js duration.enteringScreen/leavingScreen = 225/195ms).
    .toBeGreaterThan(0)
})
