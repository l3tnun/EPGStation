import { expect, test } from '@playwright/test'
import { installAppShellApiMocks } from './support/appShellMocks'
import { installBroadcastWorkflowMocks } from './support/broadcastWorkflow'
import { selectMuiOption } from './support/muiSelect'

test.beforeEach(async ({ page }) => {
  await installBroadcastWorkflowMocks(page)
})

test('keeps Guide ProgramDialog mobile controls compact and operable', async ({ page }) => {
  await page.unroute('**/api/{config,version}').catch(() => undefined)
  await installAppShellApiMocks(page, {
    enableBroadcastWaveNavigation: true,
    encodeModes: ['synthetic-encode-main', 'synthetic-encode-sub'],
  })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/#/guide?type=GR&time=23111507')

  await expect(page.getByTestId('guide-page')).toHaveAttribute('data-guide-visible', 'true')
  await page.getByTestId('guide-program-4101').click()

  const dialog = page.getByRole('dialog', { name: 'Synthetic Morning News' })
  await expect(dialog).toBeVisible()

  const checkbox = dialog.getByRole('checkbox', { name: '元ファイル削除' })
  await expect(checkbox).toBeVisible()
  const checkboxBox = await checkbox.boundingBox()
  expect(checkboxBox?.width).toBeGreaterThanOrEqual(20)
  expect(checkboxBox?.height).toBeGreaterThanOrEqual(20)
  await checkbox.check()
  await expect(checkbox).toBeChecked()

  const encodeSelect = dialog.getByRole('combobox', { name: 'エンコード' })
  await expect(encodeSelect).toBeVisible()
  const optionListScrollState = await dialog
    .locator('[class*="programOptionList"]')
    .evaluate((optionList) => ({
      clientHeight: optionList.clientHeight,
      overflowY: getComputedStyle(optionList).overflowY,
      scrollHeight: optionList.scrollHeight,
    }))
  expect(optionListScrollState.overflowY).not.toMatch(/auto|scroll/)
  expect(optionListScrollState.scrollHeight).toBeLessThanOrEqual(
    optionListScrollState.clientHeight + 1,
  )
  const selectBox = await encodeSelect.boundingBox()
  expect(selectBox?.width).toBeGreaterThanOrEqual(96)
  await selectMuiOption({ page, root: dialog, name: 'エンコード', value: 'synthetic-encode-main' })
  await expect(encodeSelect).toContainText('synthetic-encode-main')
  await expect(dialog.locator('span').filter({ hasText: 'synthetic-encode-main' })).toHaveCount(0)
  await encodeSelect.click()
  const encodeListbox = page.getByRole('listbox')
  await expect(encodeListbox).toBeVisible()
  await expect(page.getByRole('option', { name: 'synthetic-encode-sub' })).toBeVisible()
  await page.waitForFunction(
    () => {
      const heights = [...document.querySelectorAll('[role="option"]')].map(
        (option) => option.getBoundingClientRect().height,
      )
      return heights.length >= 3 && heights.every((height) => height >= 44)
    },
    undefined,
    { timeout: 2000 },
  )
  const optionHeights = await encodeListbox
    .getByRole('option')
    .evaluateAll((options) => options.map((option) => option.getBoundingClientRect().height))
  expect(optionHeights.length).toBeGreaterThanOrEqual(3)
  for (const optionHeight of optionHeights) {
    expect(optionHeight).toBeGreaterThanOrEqual(44)
  }
  const paper = encodeListbox.locator('xpath=ancestor::*[contains(@class, "MuiPaper-root")][1]')
  const paperBox = await paper.boundingBox()
  expect(paperBox).not.toBeNull()
  if (paperBox !== null) {
    expect(paperBox.height).toBeLessThanOrEqual(360)
  }
  const menuScrollState = await encodeListbox.evaluate((listbox) => {
    const paperElement = listbox.closest('.MuiPaper-root')
    return {
      listboxClientHeight: listbox.clientHeight,
      listboxOverflowY: getComputedStyle(listbox).overflowY,
      listboxScrollHeight: listbox.scrollHeight,
      paperClientHeight: paperElement?.clientHeight ?? 0,
      paperOverflowY:
        paperElement instanceof HTMLElement ? getComputedStyle(paperElement).overflowY : '',
      paperScrollHeight: paperElement?.scrollHeight ?? 0,
    }
  })
  expect(menuScrollState.listboxOverflowY).not.toMatch(/auto|scroll/)
  expect(menuScrollState.listboxScrollHeight).toBeLessThanOrEqual(
    menuScrollState.listboxClientHeight + 1,
  )
  expect(menuScrollState.paperOverflowY).not.toMatch(/auto|scroll/)
  expect(menuScrollState.paperScrollHeight).toBeLessThanOrEqual(
    menuScrollState.paperClientHeight + 1,
  )
  await page.keyboard.press('Escape')

  const dialogBox = await dialog.boundingBox()
  const footerBox = await dialog.locator('[class*="programDialogFooter"]').boundingBox()
  expect(dialogBox).not.toBeNull()
  expect(footerBox).not.toBeNull()
  if (dialogBox !== null && footerBox !== null) {
    // v3 contract: .programDialogFooter (GuidePage.module.css) is the last element in the dialog
    // paper with no bottom padding after it, so its bottom edge should coincide with the dialog's
    // bottom edge (measured actual gap: 0px on Desktop Chromium/Firefox and Android Chrome/iOS
    // Safari emulation through this same open-dialog-and-select-encode flow); the <=4 tolerance is
    // headroom for subpixel rounding on real devices, not a v2-sourced value.
    const blankAfterFooter = dialogBox.y + dialogBox.height - (footerBox.y + footerBox.height)
    expect(blankAfterFooter).toBeLessThanOrEqual(4)
  }
})

test('keeps minimum Guide cells visible after Android edge scroll sequence', async ({ page }) => {
  await page.addInitScript(() => {
    const settings = JSON.parse(window.localStorage.getItem('settings') ?? '{}') as Record<
      string,
      unknown
    >
    window.localStorage.setItem(
      'settings',
      JSON.stringify({
        ...settings,
        guideMode: 'minimum',
        guideLength: 8,
      }),
    )
    window.localStorage.setItem(
      'GuideSizeSetting',
      JSON.stringify({
        tablet: {
          channelHeight: 30,
          channelWidth: 140,
          channelFontsize: 14,
          timescaleHeight: 180,
          timescaleWidth: 30,
          timescaleFontsize: 16,
          programFontSize: 10,
        },
        mobile: {
          channelHeight: 10,
          channelWidth: 60,
          channelFontsize: 8,
          timescaleHeight: 60,
          timescaleWidth: 20,
          timescaleFontsize: 8,
          programFontSize: 6,
        },
      }),
    )
  })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/#/guide?type=GR&time=23111507')
  await expect(page.getByTestId('guide-page')).toHaveAttribute('data-guide-visible', 'true')

  const grid = page.getByTestId('guide-program-grid')
  await grid.evaluate((element) => {
    element.scrollTop = 0
    element.scrollLeft = element.scrollWidth
    element.dispatchEvent(new Event('scroll', { bubbles: true }))
  })
  await grid.evaluate((element) => {
    element.scrollTop = element.scrollHeight
    element.dispatchEvent(new Event('scroll', { bubbles: true }))
  })
  await grid.evaluate((element) => {
    element.scrollLeft = 0
    element.dispatchEvent(new Event('scroll', { bubbles: true }))
  })

  const visibleCellCount = await grid.evaluate((element) => {
    const gridRect = element.getBoundingClientRect()

    return [...element.querySelectorAll<HTMLElement>('.guide-program-cell')].filter((cell) => {
      const rect = cell.getBoundingClientRect()
      const intersects =
        rect.right > gridRect.left &&
        rect.left < gridRect.right &&
        rect.bottom > gridRect.top &&
        rect.top < gridRect.bottom

      return intersects && !cell.classList.contains('hidden')
    }).length
  })

  // Provenance (C): measured (`npx playwright test
  // e2e/broadcast-guide-dialog-workflow.spec.ts -g "Android edge scroll"`, 2 runs x all 4 configured
  // projects - Desktop Chromium, Desktop Firefox, Android Chrome, iOS Safari): visibleCellCount was
  // 9 every time, given the fixed 390x844 viewport, the type=GR fixture filter, and the
  // guideMode=minimum / GuideSizeSetting override this test applies before navigating. Deterministic
  // across engines, so pinned exactly instead of only guarding against the grid going fully blank.
  expect(visibleCellCount).toBe(9)
})
