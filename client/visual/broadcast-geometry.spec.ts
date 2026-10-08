import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test'
import { installAppShellApiMocks } from '../e2e/support/appShellMocks'
import { installGuideOnAirApiMocks } from '../e2e/support/guideOnAirMocks'

test.beforeEach(async ({ page }) => {
  await installAppShellApiMocks(page, { enableBroadcastWaveNavigation: true })
  await installGuideOnAirApiMocks(page)
})

async function expectChromiumScreenshot(
  locator: Locator,
  testInfo: TestInfo,
  name: string,
): Promise<void> {
  if (testInfo.project.name !== 'Desktop Chromium') {
    return
  }

  await expect(locator).toHaveScreenshot(name)
}

async function expectNoDocumentHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )

  // Provenance (D): v3-only "no horizontal scrollbar" contract. v2 (5cf2ea383, client/)
  // ships no e2e/visual suite at all, so 0px is not a value carried over from v2.
  expect(overflow).toBeLessThanOrEqual(0)
}

test('keeps Guide grid geometry and scroll sync stable', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/#/guide?time=23111507')

  await expect(page.getByTestId('guide-page')).toHaveAttribute('data-guide-visible', 'true')
  await expectNoDocumentHorizontalOverflow(page)

  const geometry = await page.getByTestId('guide-page').evaluate((pageElement) => {
    const grid = pageElement.querySelector<HTMLElement>('[data-testid="guide-program-grid"]')
    const header = pageElement.querySelector<HTMLElement>('[data-testid="guide-channel-header"]')
    const timeScale = pageElement.querySelector<HTMLElement>('[data-testid="guide-time-scale"]')
    const gridRect = grid?.getBoundingClientRect()
    const programRects = Array.from(
      pageElement.querySelectorAll<HTMLElement>('.guide-program-cell'),
    ).map((element) => element.getBoundingClientRect())

    return {
      channelCount: pageElement.querySelectorAll('[data-channel-index]').length,
      programCount: programRects.length,
      gridScrollWidth: grid?.scrollWidth ?? 0,
      gridClientWidth: grid?.clientWidth ?? 0,
      visibleProgramCount: programRects.filter((rect) => rect.width > 0 && rect.height > 0).length,
      headerTop: header?.getBoundingClientRect().top ?? -1,
      gridTop: gridRect?.top ?? -1,
      timeScaleLeft: timeScale?.getBoundingClientRect().left ?? -1,
      gridLeft: gridRect?.left ?? -1,
    }
  })

  // Provenance (D, fixture): e2e/support/guideOnAirFixtures.ts `syntheticGuideSchedules` is
  // deterministic - 2 named channels (301, 302) + `Array.from({ length: 12 })` extra channels = 14
  // channels; programs = 2 (channel 301) + 2 (channel 302) + 12 (one per extra channel) = 16.
  // Confirmed by instrumented run (`npx playwright test visual/broadcast-geometry.spec.ts -g
  // "Guide grid geometry"`, 5 runs): channelCount 14 and programCount 16 every time. The fixture is
  // static, so these are exact counts rather than a floor.
  expect(geometry.channelCount).toBe(14)
  expect(geometry.programCount).toBe(16)
  expect(geometry.gridScrollWidth).toBeGreaterThan(geometry.gridClientWidth)
  // Provenance (C): measured (`npx playwright test visual/broadcast-geometry.spec.ts -g
  // "Guide grid geometry"` across all 4 configured projects). This is engine-dependent, not just
  // fixture/viewport-dependent, so it cannot be pinned to one exact value: Desktop Chromium, Desktop
  // Firefox, and Android Chrome all reported 11 of the 16 rendered `.guide-program-cell` nodes with
  // a non-zero bounding rect (5 fall outside the grid's clipped rendering window for this fixed
  // 1440x900 viewport/time param), but iOS Safari (WebKit) reported all 16 as non-zero-size -
  // WebKit does not clip the same way. 11 is the floor observed across every configured project, so
  // it replaces the unconditional `> 0` without becoming flaky on WebKit.
  expect(geometry.visibleProgramCount).toBeGreaterThanOrEqual(11)
  // Provenance (D): v3-only stacking-order contract (header above the grid, time scale left of
  // the grid); confirmed by instrumented run (headerTop 64 < gridTop 94, timeScaleLeft 256 <
  // gridLeft 286). v2 has no equivalent e2e/visual suite to compare against.
  expect(geometry.headerTop).toBeLessThan(geometry.gridTop)
  expect(geometry.timeScaleLeft).toBeLessThan(geometry.gridLeft)

  await page.getByTestId('guide-program-grid').evaluate((grid) => {
    grid.scrollLeft = 80
    grid.scrollTop = 120
    grid.dispatchEvent(new Event('scroll'))
  })

  await expect
    .poll(() => page.getByTestId('guide-channel-header').evaluate((header) => header.scrollLeft))
    .toBe(80)
  await expect
    .poll(() => page.getByTestId('guide-time-scale').evaluate((timeScale) => timeScale.scrollTop))
    .toBe(120)

  await expect(page.getByTestId('guide-program-4201')).toHaveClass(/reserve/)
  await expect(page.getByTestId('guide-program-4102')).toHaveClass(/conflict/)
  await expect(page.getByTestId('guide-program-4301')).toHaveClass(/skip/)
  await expect(page.getByTestId('guide-program-4302')).toHaveClass(/overlap/)
})

test('keeps Guide mobile breakpoint geometry stable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/#/guide?time=23111507')

  await expect(page.getByTestId('guide-page')).toHaveAttribute('data-guide-visible', 'true')
  await expectNoDocumentHorizontalOverflow(page)

  const geometry = await page.getByTestId('guide-page').evaluate((pageElement) => {
    const grid = pageElement.querySelector<HTMLElement>('[data-testid="guide-program-grid"]')
    const firstChannel = pageElement.querySelector<HTMLElement>('[data-channel-index="0"]')
    const firstProgram = pageElement.querySelector<HTMLElement>(
      '[data-testid="guide-program-4101"]',
    )

    return {
      gridClientWidth: grid?.clientWidth ?? 0,
      gridScrollWidth: grid?.scrollWidth ?? 0,
      channelWidth: firstChannel?.getBoundingClientRect().width ?? 0,
      programWidth: firstProgram?.getBoundingClientRect().width ?? 0,
    }
  })

  expect(geometry.gridScrollWidth).toBeGreaterThan(geometry.gridClientWidth)
  expect(geometry.channelWidth).toBeLessThan(120)
  expect(geometry.programWidth).toBeCloseTo(geometry.channelWidth, 1)
})

test('keeps Guide mobile ProgramDialog height fitted to content', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/#/guide?time=23111507')

  await expect(page.getByTestId('guide-page')).toHaveAttribute('data-guide-visible', 'true')
  await page.getByTestId('guide-program-4101').click()

  const dialog = page.getByRole('dialog', { name: 'Synthetic Morning News' })
  await expect(dialog).toBeVisible()

  const geometry = await dialog.evaluate((dialogElement) => {
    const content = dialogElement.querySelector<HTMLElement>('[class*="programDialogContent"]')
    const footer = dialogElement.querySelector<HTMLElement>('[class*="programDialogFooter"]')
    const dialogRect = dialogElement.getBoundingClientRect()
    const contentRect = content?.getBoundingClientRect()
    const footerRect = footer?.getBoundingClientRect()

    return {
      contentBlank: (content?.clientHeight ?? 0) - (content?.scrollHeight ?? 0),
      contentHeight: contentRect?.height ?? 0,
      dialogHeight: dialogRect.height,
      footerBottomGap: footerRect === undefined ? 0 : dialogRect.bottom - footerRect.bottom,
      footerHeight: footerRect?.height ?? 0,
    }
  })

  expect(geometry.dialogHeight).toBeLessThan(520)
  // Provenance (D, checked against v3 src): 16 matches `.programDialogContent` padding
  // (`padding: 16px 16px 20px`, src/features/guide/GuidePage.module.css:477), the module's base
  // spacing unit; instrumented runs across all projects measured contentBlank === 0px, so the
  // 16px slack is headroom above the design's own unit, not an exploited gap.
  expect(geometry.contentBlank).toBeLessThanOrEqual(16)
  // Provenance (D): sub-pixel rounding tolerance (instrumented runs measured 0px across all
  // projects); consistent with the `<= 1` tolerance used elsewhere in this suite.
  expect(geometry.footerBottomGap).toBeLessThanOrEqual(1)
  expect(geometry.contentHeight).toBeGreaterThan(0)
  expect(geometry.footerHeight).toBeGreaterThan(0)
})

test('keeps Guide ProgramDialog reserve controls source-compatible', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/#/guide?time=23111507')

  await expect(page.getByTestId('guide-page')).toHaveAttribute('data-guide-visible', 'true')
  await page.getByTestId('guide-program-4101').click()

  const dialog = page.getByRole('dialog', { name: 'Synthetic Morning News' })
  await expect(dialog).toBeVisible()

  const encodeSelect = dialog.getByRole('combobox', { name: 'エンコード' })
  await encodeSelect.click()
  const encodeOptions = await page
    .getByRole('option')
    .evaluateAll((options) => options.map((option) => option.textContent?.trim() ?? ''))
  await page.keyboard.press('Escape')

  expect(encodeOptions).toStrictEqual(['TS', 'synthetic-encode-main', 'synthetic-encode-sub'])

  const controlChrome = await encodeSelect.evaluate((combobox) => {
    const style = getComputedStyle(combobox)

    return {
      minHeight: style.minHeight,
      opacity: style.opacity,
    }
  })

  expect(controlChrome.opacity).toBe('1')
  expect(parseFloat(controlChrome.minHeight)).toBeGreaterThanOrEqual(40)

  const deleteOriginalCheckbox = dialog.getByRole('checkbox', { name: '元ファイル削除' })
  await expect(deleteOriginalCheckbox).not.toBeChecked()
  await deleteOriginalCheckbox.click()
  await expect(deleteOriginalCheckbox).toBeChecked()

  const checkboxBox = await deleteOriginalCheckbox.boundingBox()
  expect(checkboxBox).not.toBeNull()
  expect(checkboxBox?.width).toBeGreaterThanOrEqual(20)
  expect(checkboxBox?.height).toBeGreaterThanOrEqual(20)

  const footerGeometry = await dialog.evaluate((dialogElement) => {
    const footer = dialogElement.querySelector<HTMLElement>('[class*="programDialogFooter"]')
    const checkbox = dialogElement.querySelector<HTMLElement>('input[type="checkbox"]')
    const select = dialogElement.querySelector<HTMLElement>(
      '[role="combobox"][aria-label="エンコード"]',
    )
    const dialogRect = dialogElement.getBoundingClientRect()
    const footerRect = footer?.getBoundingClientRect()
    const checkboxRect = checkbox?.getBoundingClientRect()
    const selectRect = select?.getBoundingClientRect()

    return {
      checkboxInside:
        checkboxRect !== undefined &&
        checkboxRect.left >= dialogRect.left &&
        checkboxRect.right <= dialogRect.right,
      footerInside:
        footerRect !== undefined &&
        footerRect.left >= dialogRect.left &&
        footerRect.right <= dialogRect.right,
      selectInside:
        selectRect !== undefined &&
        selectRect.left >= dialogRect.left &&
        selectRect.right <= dialogRect.right,
    }
  })

  expect(footerGeometry.footerInside).toBe(true)
  expect(footerGeometry.checkboxInside).toBe(true)
  expect(footerGeometry.selectInside).toBe(true)
})

test('keeps On Air card, stream dialog, and watch info geometry stable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/#/onair')

  const onAirPage = page.getByTestId('onair-page')
  await expect(onAirPage).toHaveAttribute('data-onair-layout', 'tabs')
  await expect(page.getByRole('tab', { name: 'GR' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByTestId('onair-card-5101')).toContainText('Synthetic OnAir News')
  await expectNoDocumentHorizontalOverflow(page)

  const cardBox = await page.getByTestId('onair-card-5101').boundingBox()
  const listBox = await page.getByTestId('onair-list').boundingBox()

  expect(cardBox).not.toBeNull()
  expect(listBox).not.toBeNull()
  // Provenance (D): v3-only "card stays within its list container" contract; v2 has no
  // equivalent e2e/visual suite to compare against.
  expect(cardBox?.x).toBeGreaterThanOrEqual(listBox?.x ?? 0)
  expect((cardBox?.x ?? 0) + (cardBox?.width ?? 0)).toBeLessThanOrEqual(
    (listBox?.x ?? 0) + (listBox?.width ?? 0),
  )

  await page.getByTestId('onair-card-body-5101').click()

  const dialog = page.getByRole('dialog', { name: 'ストリーム選択' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('button', { name: '番組表' })).toHaveCount(0)
  await expect(dialog.getByRole('button', { name: '視聴' })).toBeVisible()

  const dialogBox = await dialog.boundingBox()
  const viewport = page.viewportSize()

  expect(dialogBox).not.toBeNull()
  expect(viewport).not.toBeNull()
  // Provenance (D): v3-only "dialog stays on-screen" contract (x >= 0); v2 has no equivalent
  // e2e/visual suite to compare against.
  expect(dialogBox?.x).toBeGreaterThanOrEqual(0)
  expect((dialogBox?.x ?? 0) + (dialogBox?.width ?? 0)).toBeLessThanOrEqual(viewport?.width ?? 0)

  const watchType = test.info().project.name === 'iOS Safari' ? 'hls' : 'webm'
  await page.goto(`/#/onair/watch?type=${watchType}&channel=301&mode=0`)
  await expect(page.getByTestId('title-bar').getByRole('heading', { name: '視聴' })).toBeVisible()
  await expect(page.getByTestId('onair-watch-info-card')).toContainText('Synthetic OnAir News')
  await expect(page.getByTestId('onair-watch-info-card')).toContainText(
    'Synthetic live stream description',
  )
  await expectNoDocumentHorizontalOverflow(page)
})

test('keeps On Air desktop card geometry stable', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/#/onair')

  const onAirPage = page.getByTestId('onair-page')
  await expect(onAirPage).toHaveAttribute('data-onair-layout', 'tabs')
  await expectNoDocumentHorizontalOverflow(page)

  const geometry = await onAirPage.evaluate((pageElement) => {
    const list = pageElement.querySelector<HTMLElement>('[data-testid="onair-list"]')
    const cardElements = Array.from(
      pageElement.querySelectorAll<HTMLElement>('[data-testid^="onair-card-"]'),
    ).filter(
      (element) =>
        element.dataset.testid !== undefined && /^onair-card-\d+$/.test(element.dataset.testid),
    )
    const cards = cardElements.map((element) => element.getBoundingClientRect())
    const listRect = list?.getBoundingClientRect()
    const listStyle = list === null ? undefined : getComputedStyle(list)
    const cardStyles = cardElements.map((element) => getComputedStyle(element))

    return {
      listWidth: listRect?.width ?? 0,
      listPadding: listStyle?.padding ?? '',
      listShadow: listStyle?.boxShadow ?? '',
      cardCount: cards.length,
      cardsInsideList:
        listRect !== undefined &&
        cards.every((rect) => rect.left >= listRect.left - 1 && rect.right <= listRect.right + 1),
      cardsHaveArea: cards.every((rect) => rect.width > 0 && rect.height > 0),
      cardsHaveNoOwnShadow: cardStyles.every((style) => style.boxShadow === 'none'),
    }
  })

  expect(geometry.listWidth).toBeGreaterThan(360)
  expect(geometry.listPadding).toBe('16px')
  expect(geometry.listShadow).not.toBe('none')
  // Provenance (D, fixture): e2e/support/guideOnAirFixtures.ts `syntheticOnAirSchedules` has one
  // channel/program pair with `channelType: 'GR'` (301) and one with `channelType: 'BS'` (302); the
  // page defaults to the GR tab (see `data-onair-layout`/`aria-selected` assertions above), so only
  // the 301 card renders. Confirmed by instrumented run (`npx playwright test
  // visual/broadcast-geometry.spec.ts -g "On Air desktop card"`, 5 runs): cardCount was 1 every
  // time. Deterministic given the fixture, so pinned exactly.
  expect(geometry.cardCount).toBe(1)
  expect(geometry.cardsInsideList).toBe(true)
  expect(geometry.cardsHaveArea).toBe(true)
  expect(geometry.cardsHaveNoOwnShadow).toBe(true)
})

test('shows a scrim and a circular progress over the Guide while the schedule is fetching without moving the title bar', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  let releaseSchedule: () => void = () => undefined
  const scheduleGate = new Promise<void>((resolve) => {
    releaseSchedule = resolve
  })
  await page.route(
    (url) => url.pathname.endsWith('/api/schedules'),
    async (route) => {
      await scheduleGate
      await route.fallback()
    },
  )

  await page.goto('/#/guide?time=23111507')

  const loading = page.getByTestId('guide-loading')
  const guidePage = page.getByTestId('guide-page')
  const titleBar = page.getByTestId('title-bar')
  await expect(loading).toBeVisible()
  await expect(loading.getByRole('progressbar')).toBeVisible()
  // v2 Loading.vue: rgb(0, 0, 0, 0.6) scrim over the whole guide area, 60px indeterminate progress.
  await expect(loading).toHaveCSS('background-color', 'rgba(0, 0, 0, 0.6)')
  await expect(loading.getByRole('progressbar')).toHaveCSS('width', '60px')
  await expect(page.getByTestId('guide-program-grid')).toHaveCount(0)

  const loadingGuideBox = await guidePage.boundingBox()
  const loadingScrimBox = await loading.boundingBox()
  const loadingTitleBarBox = await titleBar.boundingBox()
  expect(loadingGuideBox).not.toBeNull()
  expect(loadingScrimBox).toEqual(loadingGuideBox)

  releaseSchedule()

  await expect(loading).toHaveCount(0)
  await expect(guidePage).toHaveAttribute('data-guide-visible', 'true')
  await expect(page.getByTestId('guide-program-grid')).toBeVisible()
  expect(await titleBar.boundingBox()).toEqual(loadingTitleBarBox)
  expect(await guidePage.boundingBox()).toEqual(loadingGuideBox)
  expect((await page.getByTestId('guide-channel-header').boundingBox())?.y).toBe(loadingGuideBox?.y)
})

test('keeps program cell content top-aligned within 6px of the cell top', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/#/guide?time=23111507')

  await expect(page.getByTestId('guide-page')).toHaveAttribute('data-guide-visible', 'true')

  const offsets = await page.getByTestId('guide-page').evaluate((pageElement) =>
    Array.from(pageElement.querySelectorAll<HTMLElement>('.guide-program-cell'))
      .map((cell) => {
        const cellRect = cell.getBoundingClientRect()
        const firstVisibleChild = Array.from(cell.children).find(
          (child) => child.getBoundingClientRect().height > 0,
        )

        return {
          rendered: cellRect.height > 0,
          offset:
            firstVisibleChild === undefined
              ? null
              : firstVisibleChild.getBoundingClientRect().top - cellRect.top,
        }
      })
      .filter((row) => row.rendered),
  )

  // design.md (Visual Implementation Contract): the first visible child sits within 6px of the
  // cell top, so a cell taller than its content is never centred like a native button.
  expect(offsets.length).toBeGreaterThanOrEqual(11)
  for (const row of offsets) {
    expect(row.offset).not.toBeNull()
    expect(row.offset as number).toBeGreaterThanOrEqual(0)
    expect(row.offset as number).toBeLessThanOrEqual(6)
  }
})

test.describe('dense Guide schedule', () => {
  test.beforeEach(async ({ page }) => {
    await page.unrouteAll()
    await installAppShellApiMocks(page, { enableBroadcastWaveNavigation: true })
    await installGuideOnAirApiMocks(page, { dense: true })
    await page.addInitScript(() => {
      const settings = JSON.parse(window.localStorage.getItem('settings') ?? '{}') as Record<
        string,
        unknown
      >
      // 'all' renders every cell, so the geometry of programs outside the viewport is measurable.
      window.localStorage.setItem('settings', JSON.stringify({ ...settings, guideMode: 'all' }))
    })
  })

  test('keeps dense programs non-overlapping with proportional heights and all genre classes', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/#/guide?time=23111507')

    await expect(page.getByTestId('guide-page')).toHaveAttribute('data-guide-visible', 'true')
    await expect(page.getByTestId('guide-program-6001')).toBeAttached()

    const geometry = await page.getByTestId('guide-page').evaluate((pageElement) => {
      const cells = Array.from(pageElement.querySelectorAll<HTMLElement>('.guide-program-cell'))
      const rows = cells.map((cell) => {
        const rect = cell.getBoundingClientRect()
        const programId = Number(cell.dataset.programId)

        return {
          programId,
          channelId: Math.floor((programId - 6001) / 10),
          programIndex: (programId - 6001) % 10,
          left: rect.left,
          top: rect.top,
          bottom: rect.bottom,
          height: rect.height,
          genreClasses: Array.from(cell.classList).filter((name) => /^ctg-\d+$/.test(name)),
        }
      })

      return rows
    })

    // 8 channels x 6 programs.
    expect(geometry).toHaveLength(48)
    for (let channelId = 0; channelId < 8; channelId += 1) {
      const column = geometry
        .filter((row) => row.channelId === channelId)
        .sort((first, second) => first.top - second.top)
      expect(column).toHaveLength(6)
      for (let index = 1; index < column.length; index += 1) {
        // Programs of one channel are laid out one after another and never overlap.
        expect(column[index - 1].bottom).toBeLessThanOrEqual(column[index].top + 0.5)
      }

      // Heights are proportional to the duration (5 / 15 / 30 / 60 minutes, 3.5 hours, and the
      // 60 minute program that crosses midnight), and the 5 minute program stays rendered.
      const byIndex = new Map(column.map((row) => [row.programIndex, row.height]))
      const hourHeight = byIndex.get(3) as number
      expect(hourHeight).toBeGreaterThan(0)
      expect(byIndex.get(0) as number).toBeCloseTo((hourHeight / 60) * 5, 0)
      expect(byIndex.get(1) as number).toBeCloseTo((hourHeight / 60) * 15, 0)
      expect(byIndex.get(2) as number).toBeCloseTo((hourHeight / 60) * 30, 0)
      expect(byIndex.get(4) as number).toBeCloseTo((hourHeight / 60) * 210, 0)
      expect(byIndex.get(5) as number).toBeCloseTo(hourHeight, 0)
    }

    const genreClasses = new Set(geometry.flatMap((row) => row.genreClasses))
    for (let genre = 0; genre <= 15; genre += 1) {
      expect(genreClasses.has(`ctg-${genre}`), `ctg-${genre}`).toBe(true)
    }
  })

  test('captures the dense Guide grid and the ProgramDialog', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/#/guide?time=23111507')

    const guidePage = page.getByTestId('guide-page')
    await expect(guidePage).toHaveAttribute('data-guide-visible', 'true')
    await expect(page.getByTestId('guide-program-6001')).toBeVisible()
    await expectChromiumScreenshot(guidePage, testInfo, 'guide-dense-grid.png')

    await page.getByTestId('guide-program-6003').click()
    const dialog = page.getByRole('dialog', { name: 'Synthetic Dense Program 1-3' })
    await expect(dialog).toBeVisible()
    await expectChromiumScreenshot(dialog, testInfo, 'guide-program-dialog.png')
  })

  test('captures the dense Guide ProgramDialog in the dark theme', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.unrouteAll()
    await installAppShellApiMocks(page, {
      enableBroadcastWaveNavigation: true,
      forceDarkTheme: true,
    })
    await installGuideOnAirApiMocks(page, { dense: true })
    await page.goto('/#/guide?time=23111507')

    await expect(page.getByTestId('guide-page')).toHaveAttribute('data-guide-visible', 'true')
    await page.getByTestId('guide-program-6003').click()
    const dialog = page.getByRole('dialog', { name: 'Synthetic Dense Program 1-3' })
    await expect(dialog).toBeVisible()
    await expectChromiumScreenshot(dialog, testInfo, 'guide-program-dialog-dark.png')
  })
})
