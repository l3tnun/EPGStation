import { expect, test, type Page } from '@playwright/test'
import { installAppShellApiMocks } from '../e2e/support/appShellMocks'
import { muiSelectInput, selectMuiOption } from '../e2e/support/muiSelect'
import { installStoragesUploadApiMocks } from '../e2e/support/storagesUploadMocks'
import { expectAnnounced } from '../e2e/support/notificationObservation'

test.beforeEach(async ({ page }) => {
  await installAppShellApiMocks(page)
  await installStoragesUploadApiMocks(page)
})

async function expectNoDocumentHorizontalOverflow(page: Page): Promise<void> {
  // Provenance (D): v3-only contract. v2 (5cf2ea383, client/) ships no e2e/visual
  // suite at all (no playwright/cypress dep, no e2e dir), so 0px is the strictest "no horizontal
  // scrollbar" bar, not a value carried over from v2.
  // A viewport change reflows on a later frame, so sampling once right after `setViewportSize`
  // reads the previous layout. Poll until the document settles, with the offenders reported below
  // if it never does.
  await expect
    .poll(
      async () =>
        page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        ),
      { timeout: 5_000 },
    )
    .toBeLessThanOrEqual(0)

  const measured = await page.evaluate(() => {
    const root = document.documentElement
    const offenders = [...document.querySelectorAll('*')]
      .map((element) => {
        const rect = element.getBoundingClientRect()
        return {
          className: String((element as HTMLElement).className ?? '').slice(0, 60),
          right: Math.round(rect.right),
          tag: element.tagName,
          width: Math.round(rect.width),
        }
      })
      .filter((entry) => entry.right > root.clientWidth + 1)
      .sort((left, right) => right.right - left.right)
      .slice(0, 5)

    return {
      clientWidth: root.clientWidth,
      offenders,
      overflow: root.scrollWidth - root.clientWidth,
      scrollWidth: root.scrollWidth,
    }
  })

  // Naming the widest elements that cross the viewport edge turns a bare pixel count into
  // something actionable: the count alone does not say which box is too wide.
  // Provenance (D): same 0px "no horizontal scrollbar" contract as the poll above.
  expect(
    measured.overflow,
    `document overflows by ${measured.overflow}px (scrollWidth ${measured.scrollWidth}, clientWidth ${measured.clientWidth}); widest offenders: ${JSON.stringify(measured.offenders)}`,
  ).toBeLessThanOrEqual(0)
}

async function readStorageGeometry(page: Page) {
  return page.getByTestId('storages-page').evaluate((pageElement) => {
    const pageRect = pageElement.getBoundingClientRect()
    const rows = Array.from(pageElement.querySelectorAll<HTMLElement>('[role="listitem"]')).map(
      (element) => element.getBoundingClientRect(),
    )

    return {
      pageWidth: pageRect.width,
      pageLeft: pageRect.left,
      rowCount: rows.length,
      equalWidths:
        rows.length > 1 && rows.every((rect) => Math.abs(rect.width - rows[0].width) < 1),
      rowsHaveArea: rows.every((rect) => rect.width > 0 && rect.height > 0),
      rowWidth: rows[0]?.width ?? 0,
      rowsContained: rows.every(
        (rect) => rect.left >= pageRect.left - 1 && rect.right <= pageRect.right + 1,
      ),
    }
  })
}

test('keeps storage usage layout stable on desktop and mobile', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/#/storages')
  await expectNoDocumentHorizontalOverflow(page)

  const desktopGeometry = await readStorageGeometry(page)

  expect(desktopGeometry.rowCount).toBe(5)
  expect(desktopGeometry.equalWidths).toBe(true)
  expect(desktopGeometry.rowsHaveArea).toBe(true)
  expect(desktopGeometry.rowsContained).toBe(true)
  // Desktop rows fill a container whose max-width is far short of the 1440px viewport.
  expect(desktopGeometry.pageWidth).toBeLessThan(1440)
  expect(desktopGeometry.pageWidth).toBeGreaterThan(390)

  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/#/storages?timestamp=mobile')
  await expectNoDocumentHorizontalOverflow(page)

  const mobileGeometry = await readStorageGeometry(page)

  expect(mobileGeometry.rowCount).toBe(5)
  expect(mobileGeometry.equalWidths).toBe(true)
  expect(mobileGeometry.rowsHaveArea).toBe(true)
  expect(mobileGeometry.rowsContained).toBe(true)
  // At mobile width the page and its rows must fit inside the narrow viewport rather than
  // retaining the desktop container width, which would clip or force horizontal scrolling.
  expect(mobileGeometry.pageWidth).toBeLessThanOrEqual(390)
  expect(mobileGeometry.rowWidth).toBeLessThan(desktopGeometry.rowWidth)
})

test('applies the Storages list max-width tiers from 960px like the legacy v-container', async ({
  page,
}) => {
  await page.setViewportSize({ width: 959, height: 900 })
  await page.goto('/#/storages')
  const storagesPage = page.getByTestId('storages-page')
  await expect(storagesPage).toBeVisible()
  const renderedWidth = () =>
    storagesPage.evaluate((node) => Math.round(node.getBoundingClientRect().width))

  // No max-width below the 960px (md) breakpoint: the list fills the viewport.
  await expect(storagesPage).toHaveCSS('max-width', 'none')
  await expect.poll(renderedWidth).toBe(959)

  await page.setViewportSize({ width: 960, height: 900 })
  await expect(storagesPage).toHaveCSS('max-width', '900px')
  await expect.poll(renderedWidth).toBe(900)

  // The permanent drawer (256px) takes width from 1264px up; 1500px leaves 1244px, so the 1185px
  // tier binds.
  await page.setViewportSize({ width: 1500, height: 900 })
  await expect(storagesPage).toHaveCSS('max-width', '1185px')
  await expect.poll(renderedWidth).toBe(1185)

  await page.setViewportSize({ width: 2400, height: 900 })
  await expect(storagesPage).toHaveCSS('max-width', '1785px')
  await expect.poll(renderedWidth).toBe(1785)
})

test('keeps upload form, FAB, and progress dialog inside viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/#/recorded/upload')

  await expect(page.getByTestId('recorded-upload-page')).toBeVisible()
  await expectNoDocumentHorizontalOverflow(page)

  const readControlOrder = () =>
    page.locator('label, input, textarea, [role="combobox"]').evaluateAll((elements) =>
      elements.map((element) => {
        const name = element.textContent ?? element.getAttribute('aria-label') ?? ''
        const stablePrefixes = [
          'channel',
          'genre',
          'file type',
          'directory',
          'sub directory',
          'video file',
        ]
        const stablePrefix = stablePrefixes.find((prefix) => name.startsWith(prefix))

        return stablePrefix ?? name
      }),
    )

  const initialOrder = await readControlOrder()

  await page.getByRole('button', { name: '動画ファイルを追加' }).click()
  await expect(page.getByTestId('recorded-upload-page')).toHaveAttribute(
    'data-video-block-count',
    '2',
  )
  await expect(page.getByTestId('recorded-upload-video-block-0').getByLabel('name')).toBeVisible()
  await expect(page.getByTestId('recorded-upload-video-block-1').getByLabel('name')).toBeVisible()
  await expectNoDocumentHorizontalOverflow(page)

  const addVideoButton = page.getByRole('button', { name: '動画ファイルを追加' })
  await addVideoButton.scrollIntoViewIfNeeded()
  const addVideoButtonBox = await addVideoButton.boundingBox()
  const addVideoViewport = page.viewportSize()

  expect(addVideoButtonBox).not.toBeNull()
  expect(addVideoViewport).not.toBeNull()
  // Provenance (D): v3-only "control stays on-screen" contract (x/y >= 0 = not scrolled off the
  // top/left edge); v2 has no equivalent e2e/visual suite to compare against.
  expect(addVideoButtonBox?.x).toBeGreaterThanOrEqual(0)
  expect(addVideoButtonBox?.y).toBeGreaterThanOrEqual(0)
  expect((addVideoButtonBox?.x ?? 0) + (addVideoButtonBox?.width ?? 0)).toBeLessThanOrEqual(
    addVideoViewport?.width ?? 0,
  )
  expect((addVideoButtonBox?.y ?? 0) + (addVideoButtonBox?.height ?? 0)).toBeLessThanOrEqual(
    addVideoViewport?.height ?? 0,
  )

  const nextOrder = await readControlOrder()

  expect(nextOrder.slice(0, initialOrder.length)).toEqual(initialOrder)

  await expect(
    muiSelectInput(page.getByTestId('recorded-upload-video-block-0'), 'directory'),
  ).toHaveValue('archive-root')
  await selectMuiOption({ page, name: '放送局※', value: '34' })
  await expect(muiSelectInput(page, '放送局※')).toHaveValue('34')
  await page.getByLabel('日付※').fill('2026-05-05T12:30')
  await page.getByLabel('長さ※').fill('30')
  await page.getByLabel('番組名※').fill('Synthetic Browser Upload')
  const rollbackVideoBlock = page.getByTestId('recorded-upload-video-block-0')
  await rollbackVideoBlock
    .getByRole('textbox', { name: 'name', exact: true })
    .fill('Synthetic Video File')
  await selectMuiOption({ page, root: rollbackVideoBlock, name: 'file type', value: 'ts' })
  await rollbackVideoBlock.getByLabel('video file').setInputFiles({
    name: 'synthetic-upload.ts',
    mimeType: 'video/mp2t',
    buffer: Buffer.from('synthetic upload payload'),
  })
  await page.getByRole('button', { name: 'アップロード' }).click()

  const dialog = page.getByRole('dialog', { name: 'アップロード中' })
  await expect(dialog).toBeVisible()
  const dialogBox = await dialog.boundingBox()
  const viewport = page.viewportSize()

  expect(dialogBox).not.toBeNull()
  expect(viewport).not.toBeNull()
  // Provenance (D): v3-only "dialog stays on-screen" contract (x/y >= 0); v2 has no equivalent
  // e2e/visual suite to compare against.
  expect(dialogBox?.x).toBeGreaterThanOrEqual(0)
  expect(dialogBox?.y).toBeGreaterThanOrEqual(0)
  expect((dialogBox?.x ?? 0) + (dialogBox?.width ?? 0)).toBeLessThanOrEqual(viewport?.width ?? 0)
  expect((dialogBox?.y ?? 0) + (dialogBox?.height ?? 0)).toBeLessThanOrEqual(viewport?.height ?? 0)
})

test('keeps upload desktop progress and rollback error geometry stable', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/#/recorded/upload')
  await expect(page.getByTestId('recorded-upload-page')).toBeVisible()
  await expectNoDocumentHorizontalOverflow(page)

  const formBox = await page.getByTestId('recorded-upload-page').boundingBox()
  const viewport = page.viewportSize()

  expect(formBox).not.toBeNull()
  expect(viewport).not.toBeNull()
  expect(formBox?.width).toBeLessThanOrEqual(1000)
  expect((formBox?.x ?? 0) + (formBox?.width ?? 0)).toBeLessThanOrEqual(viewport?.width ?? 0)

  await expect(
    muiSelectInput(page.getByTestId('recorded-upload-video-block-0'), 'directory'),
  ).toHaveValue('archive-root')
  await selectMuiOption({ page, name: '放送局※', value: '34' })
  await expect(muiSelectInput(page, '放送局※')).toHaveValue('34')
  await page.getByLabel('日付※').fill('2026-05-05T12:30')
  await page.getByLabel('長さ※').fill('30')
  await page.getByLabel('番組名※').fill('Synthetic Browser Upload')
  const successVideoBlock = page.getByTestId('recorded-upload-video-block-0')
  await successVideoBlock
    .getByRole('textbox', { name: 'name', exact: true })
    .fill('Synthetic Video File')
  await selectMuiOption({ page, root: successVideoBlock, name: 'file type', value: 'ts' })
  await successVideoBlock.getByLabel('video file').setInputFiles({
    name: 'synthetic-upload.ts',
    mimeType: 'video/mp2t',
    buffer: Buffer.from('synthetic upload payload'),
  })
  await page.getByRole('button', { name: 'アップロード' }).click()

  const dialog = page.getByRole('dialog', { name: 'アップロード中' })
  await expect(dialog).toBeVisible()
  const dialogBox = await dialog.boundingBox()

  expect(dialogBox).not.toBeNull()
  // Provenance (D): same "dialog stays on-screen" contract as the upload dialog check above.
  expect(dialogBox?.x).toBeGreaterThanOrEqual(0)
  expect(dialogBox?.y).toBeGreaterThanOrEqual(0)
  expect((dialogBox?.x ?? 0) + (dialogBox?.width ?? 0)).toBeLessThanOrEqual(viewport?.width ?? 0)
  expect((dialogBox?.y ?? 0) + (dialogBox?.height ?? 0)).toBeLessThanOrEqual(viewport?.height ?? 0)
  await expectAnnounced(page, 'アップロード完了')

  await page.unrouteAll()
  await installAppShellApiMocks(page)
  await installStoragesUploadApiMocks(page, 'upload-failure')
  await page.goto('/#/recorded/upload?timestamp=rollback')
  await expect(
    muiSelectInput(page.getByTestId('recorded-upload-video-block-0'), 'directory'),
  ).toHaveValue('archive-root')
  await selectMuiOption({ page, name: '放送局※', value: '34' })
  await page.getByLabel('日付※').fill('2026-05-05T12:30')
  await page.getByLabel('長さ※').fill('30')
  await page.getByLabel('番組名※').fill('Synthetic Browser Upload')
  const rollbackVideoBlock = page.getByTestId('recorded-upload-video-block-0')
  await rollbackVideoBlock
    .getByRole('textbox', { name: 'name', exact: true })
    .fill('Synthetic Video File')
  await selectMuiOption({ page, root: rollbackVideoBlock, name: 'file type', value: 'ts' })
  await rollbackVideoBlock.getByLabel('video file').setInputFiles({
    name: 'synthetic-upload.ts',
    mimeType: 'video/mp2t',
    buffer: Buffer.from('synthetic upload payload'),
  })
  await page.getByRole('button', { name: 'アップロード' }).click()
  await expectAnnounced(page, 'アップロードに失敗')
  await expect(page.getByText('synthetic-upload-failure')).toHaveCount(0)
  await expectNoDocumentHorizontalOverflow(page)
})
