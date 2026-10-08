import { expect, test, type Locator, type Page } from '@playwright/test'
import { installAppShellApiMocks } from './support/appShellMocks'
import {
  muiSelectCombobox,
  muiSelectInput,
  muiSelectName,
  selectMuiOption,
} from './support/muiSelect'
import { installStoragesUploadApiMocks } from './support/storagesUploadMocks'
import { expectAnnounced } from './support/notificationObservation'

test.beforeEach(async ({ page }) => {
  await installAppShellApiMocks(page)
  await installStoragesUploadApiMocks(page)
})

async function waitForUploadFormReady(page: Page): Promise<void> {
  await expect(page.getByTestId('recorded-upload-page')).toBeVisible()
  await expect(muiSelectInput(page, 'directory')).toHaveValue('archive-root')
}

async function fillUploadForm(page: Page): Promise<void> {
  await waitForUploadFormReady(page)
  await expect(await selectMuiOption({ page, name: '放送局※', value: '34' })).toBe('34')
  await expect(await selectMuiOption({ page, name: 'genre', value: '5', exact: true })).toBe('5')
  await expect(muiSelectCombobox(page, 'sub genre', true)).toBeVisible()
  await expect(await selectMuiOption({ page, name: 'sub genre', value: '0', exact: true })).toBe(
    '0',
  )
  await page.getByLabel('日付※').fill('2026-05-05T12:30')
  await page.getByLabel('長さ※').fill('30')
  await page.getByLabel('番組名※').fill('Synthetic Browser Upload')
  await page.getByLabel('name', { exact: true }).fill('Synthetic Video File')
  await selectMuiOption({ page, name: 'file type', value: 'ts', exact: true })
  await page.getByLabel('video file', { exact: true }).setInputFiles({
    name: 'synthetic-upload.ts',
    mimeType: 'video/mp2t',
    buffer: Buffer.from('synthetic upload payload'),
  })
}

function selectInputRoot(combobox: Locator): Locator {
  return combobox.locator('xpath=ancestor::*[contains(@class, "MuiInputBase-root")][1]')
}

async function expectClearableSelectGeometryStable({
  page,
  clearButtonName,
  beforeBox,
}: {
  page: Page
  clearButtonName: string
  beforeBox: NonNullable<Awaited<ReturnType<Locator['boundingBox']>>>
}): Promise<void> {
  const clearButton = page.getByRole('button', { name: clearButtonName, exact: true })
  const root = clearButton.locator(
    'xpath=preceding-sibling::*[contains(@class, "MuiTextField-root")][1]//*[contains(@class, "MuiInputBase-root")][1]',
  )
  const afterBox = await root.boundingBox()
  const clearButtonBox = await clearButton.boundingBox()

  expect(afterBox).not.toBeNull()
  expect(clearButtonBox).not.toBeNull()
  if (afterBox === null || clearButtonBox === null) {
    return
  }

  expect(Math.abs(afterBox.width - beforeBox.width)).toBeLessThanOrEqual(1)
  expect(afterBox.height).toBe(48)
  // Provenance (D): the clear button is absolutely positioned inside/over the select's input
  // wrapper, so it must stay within the wrapper's horizontal bounds (+1 tolerates rounding).
  expect(clearButtonBox.x).toBeGreaterThanOrEqual(afterBox.x)
  expect(clearButtonBox.x + clearButtonBox.width).toBeLessThanOrEqual(
    afterBox.x + afterBox.width + 1,
  )
  // Provenance (C), corrected: this is not MUI's default IconButton padding — src/shared/
  // AppSelect.tsx explicitly sets the clear button's own `padding: 0` (line 225), so that default
  // is not in effect here. The button is positioned via `top: controlHeight / 2` + `height: 32` +
  // `transform: translateY(-50%)` (AppSelect.tsx:222,228-229) inside the same position:relative
  // wrapper as the standard-variant TextField's label row. Measured directly (channel/genre/sub
  // genre selects on /#/recorded/upload): clearButtonBox.y - afterBox.y is exactly -8 in every
  // case, so -8 is the real value, not a loose tolerance.
  expect(clearButtonBox.y).toBeGreaterThanOrEqual(afterBox.y - 8)
  expect(clearButtonBox.y + clearButtonBox.height).toBeLessThanOrEqual(
    afterBox.y + afterBox.height + 1,
  )
}

test('renders storage usage and keeps blank empty/error states', async ({ page }) => {
  await page.goto('/#/storages')

  await expect(
    page.getByTestId('title-bar').getByRole('heading', { name: 'ストレージ' }),
  ).toBeVisible()
  await expect(page.getByTestId('storages-page')).toHaveAttribute('data-storages-count', '5')
  await expect(page.getByText('Synthetic archive storage - 1.3GB')).toBeVisible()
  await expect(page.getByText('768.0MB 使用済み')).toBeVisible()
  await expect(page.getByText('512.0MB 空き')).toBeVisible()
  await expect(page.getByText('Synthetic zero usage storage - 1.0MB')).toBeVisible()
  await expect(page.getByText('Synthetic nearly full storage - 20.0KB')).toBeVisible()
  await expect(page.getByText('Synthetic unknown total storage - 0.0B')).toBeVisible()

  await page.unrouteAll()
  await installAppShellApiMocks(page)
  await installStoragesUploadApiMocks(page, 'storage-empty')
  await page.goto('/#/storages?timestamp=empty')
  await expect(
    page.getByTestId('title-bar').getByRole('heading', { name: 'ストレージ' }),
  ).toBeVisible()
  await expect(page.getByTestId('storages-page')).toHaveCount(0)

  await page.unrouteAll()
  await installAppShellApiMocks(page)
  await installStoragesUploadApiMocks(page, 'storage-failure')
  await page.goto('/#/storages?timestamp=failure')
  await expectAnnounced(page, 'ストレージ情報取得に失敗')
  await expect(page.getByTestId('storages-page')).toHaveCount(0)
})

test('uploads recorded metadata and video file with progress feedback', async ({ page }) => {
  await page.goto('/#/recorded/upload')

  await expect(
    page.getByTestId('title-bar').getByRole('heading', { name: 'アップロード' }),
  ).toBeVisible()
  await expect(page.getByTestId('recorded-upload-video-block-0')).toContainText('name')
  await expect(page.getByTestId('recorded-upload-video-block-0')).toContainText('file type')
  await expect(page.getByTestId('recorded-upload-video-block-0')).toContainText('directory')
  await expect(page.getByTestId('recorded-upload-video-block-0')).toContainText('sub directory')
  await expect(page.getByTestId('recorded-upload-video-block-0')).toContainText('video file')
  await expect(page.getByText('ファイルタイプ')).toHaveCount(0)
  await expect(page.getByText('ディレクトリ', { exact: true })).toHaveCount(0)
  await expect(page.getByText('放送局※')).toHaveCSS('color', 'rgb(255, 0, 0)')
  await expect(page.getByText('日付※')).toHaveCSS('color', 'rgb(255, 0, 0)')
  await expect(page.getByText('長さ※')).toHaveCSS('color', 'rgb(255, 0, 0)')
  await expect(page.getByText('番組名※')).toHaveCSS('color', 'rgb(255, 0, 0)')
  const channelSelect = page.getByRole('combobox', { name: '放送局※' })
  await expect(channelSelect).toBeVisible()
  await expect(channelSelect).not.toHaveText(/^\d+$/)
  await channelSelect.click()
  const channelOptionTexts = await page.getByRole('listbox').getByRole('option').allTextContents()
  expect(channelOptionTexts.filter((text) => /^\d+$/.test(text.trim()))).toEqual([])
  await page.getByRole('listbox').getByRole('option').first().click()
  await expect(page.getByRole('listbox')).toBeHidden()
  const fileTypeSelect = page
    .getByTestId('recorded-upload-video-block-0')
    .getByRole('combobox')
    .first()
  await expect(fileTypeSelect).toHaveCSS('height', '48px')
  await expect(fileTypeSelect).toHaveCSS('border-radius', '0px')
  await expect(fileTypeSelect).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  await expect(page.getByRole('combobox', { name: muiSelectName('genre', true) })).toHaveCSS(
    'height',
    '48px',
  )
  await expect(page.getByRole('combobox', { name: muiSelectName('sub genre', true) })).toHaveCSS(
    'height',
    '48px',
  )
  await page.getByLabel('日付※').click()
  await expect(page.getByRole('dialog', { name: '日付選択' })).toBeVisible()
  await page.getByRole('button', { name: '設定' }).click()
  await expect(page.getByRole('dialog', { name: '日付選択' })).toHaveCount(0)
  await page.getByLabel('長さ※').fill('45')
  await page.getByRole('button', { name: '長さ(分)をクリア' }).click()
  await expect(page.getByLabel('長さ※')).toHaveValue('')
  await page.getByLabel('description').fill('Synthetic description')
  await page.getByRole('button', { name: 'descriptionをクリア' }).click()
  await expect(page.getByLabel('description')).toHaveValue('')
  await page.getByLabel('sub directory', { exact: true }).fill('synthetic/video/sub')
  await page.getByRole('button', { name: 'sub directoryをクリア' }).click()
  await expect(page.getByLabel('sub directory', { exact: true })).toHaveValue('')
  await fillUploadForm(page)

  await page.getByRole('button', { name: 'アップロード' }).click()

  await expectAnnounced(page, 'アップロード完了')
  await expect(page).toHaveURL(/#\/recorded\/upload\?timestamp=\d+$/)
  await expect(page.getByLabel('番組名※')).toHaveValue('Synthetic Browser Upload')
})

test('keeps clearable upload selects inside the original field geometry', async ({ page }) => {
  await page.goto('/#/recorded/upload')
  await waitForUploadFormReady(page)

  const channelSelect = page.getByRole('combobox', { name: '放送局※' })
  const genreSelect = page.getByRole('combobox', { name: muiSelectName('genre', true) })
  const channelRoot = selectInputRoot(channelSelect)
  const genreRoot = selectInputRoot(genreSelect)
  const channelBox = await channelRoot.boundingBox()
  const genreBox = await genreRoot.boundingBox()
  expect(channelBox).not.toBeNull()
  expect(genreBox).not.toBeNull()
  if (channelBox === null || genreBox === null) {
    return
  }

  await expect(await selectMuiOption({ page, name: '放送局※', value: '34' })).toBe('34')
  await expect(await selectMuiOption({ page, name: 'genre', value: '5', exact: true })).toBe('5')

  const subGenreSelect = page.getByRole('combobox', { name: muiSelectName('sub genre', true) })
  const subGenreRoot = selectInputRoot(subGenreSelect)
  const subGenreBox = await subGenreRoot.boundingBox()
  expect(subGenreBox).not.toBeNull()
  if (subGenreBox === null) {
    return
  }

  await expect(await selectMuiOption({ page, name: 'sub genre', value: '0', exact: true })).toBe(
    '0',
  )

  await expectClearableSelectGeometryStable({
    page,
    clearButtonName: '放送局※をクリア',
    beforeBox: channelBox,
  })
  await expectClearableSelectGeometryStable({
    page,
    clearButtonName: 'genreをクリア',
    beforeBox: genreBox,
  })
  await expectClearableSelectGeometryStable({
    page,
    clearButtonName: 'sub genreをクリア',
    beforeBox: subGenreBox,
  })

  const horizontalOverflow = await page
    .getByTestId('recorded-upload-page')
    .evaluate((element) => element.scrollWidth - element.clientWidth)
  // Provenance (D): v3-only "no horizontal scrollbar" contract; v2 has no equivalent e2e/visual
  // suite to compare against. The 1px allowance only tolerates sub-pixel width rounding.
  expect(horizontalOverflow).toBeLessThanOrEqual(1)
})

test('rolls back metadata and reports upload failure without leaking rollback details', async ({
  page,
}) => {
  await page.unrouteAll()
  await installAppShellApiMocks(page)
  const uploadMocks = await installStoragesUploadApiMocks(page, 'upload-failure')
  await page.goto('/#/recorded/upload')

  await fillUploadForm(page)

  await page.getByRole('button', { name: 'アップロード' }).click()

  await expectAnnounced(page, 'アップロードに失敗')
  await expect.poll(() => uploadMocks.deletedRecordedIds).toEqual([901])
  await expect(page.getByText('synthetic-upload-failure')).toHaveCount(0)
})
