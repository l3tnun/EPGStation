import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test'
import { installAppShellApiMocks } from '../e2e/support/appShellMocks'
import { installDashboardWorkflowApiMocks } from '../e2e/support/dashboardMocks'
import { expectAnnounced } from '../e2e/support/notificationObservation'

test.beforeEach(async ({ page }) => {
  await installAppShellApiMocks(page, { enableBroadcastWaveNavigation: true })
  await installDashboardWorkflowApiMocks(page)
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

  // Provenance (C): measured via a temporary console.log in this function
  // (`npx playwright test visual/dashboard-geometry.spec.ts`, 5 runs, all 3 call sites in both
  // tests). Every reading was 0px; no source records a need for a 1px allowance, so the check now
  // matches the 0px threshold used by every other visual suite.
  expect(overflow).toBeLessThanOrEqual(0)
}

async function readDashboardGeometry(page: Page) {
  return page.getByTestId('dashboard-page').evaluate((pageElement) => {
    const dashboard = pageElement.getBoundingClientRect()
    const recordingSection = pageElement.querySelector<HTMLElement>(
      '[data-testid="dashboard-section-recording"]',
    )
    const recordingList = pageElement.querySelector<HTMLElement>(
      '[data-testid="dashboard-section-recording-list"]',
    )
    const sections = Array.from(
      pageElement.querySelectorAll<HTMLElement>(
        '[data-testid^="dashboard-section-"]:not([data-testid$="-list"])',
      ),
    ).map((section) => section.getBoundingClientRect())
    const lists = Array.from(
      pageElement.querySelectorAll<HTMLElement>('[data-testid$="-list"]'),
    ).map((list) => ({
      clientHeight: list.clientHeight,
      scrollHeight: list.scrollHeight,
    }))

    return {
      dashboardHeight: dashboard.height,
      recordingListClientHeight: recordingList?.clientHeight ?? 0,
      recordingListScrollHeight: recordingList?.scrollHeight ?? 0,
      recordingSectionHeight: recordingSection?.getBoundingClientRect().height ?? 0,
      sectionCount: sections.length,
      sectionsHaveArea: sections.every((section) => section.width > 0 && section.height > 0),
      sameRow: sections.every((section) => Math.abs(section.y - sections[0].y) < 2),
      stacked: sections.every((section, index) => index === 0 || section.y > sections[index - 1].y),
      similarWidths:
        sections.length <= 1 ||
        sections.every((section) => Math.abs(section.width - sections[0].width) <= 2),
      scrollableLists: lists.every(
        (list) => list.clientHeight > 0 && list.scrollHeight >= list.clientHeight,
      ),
    }
  })
}

test('keeps Dashboard desktop and mobile summary geometry stable', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await expect(page.getByTestId('dashboard-page')).toBeVisible()
  await expectNoDocumentHorizontalOverflow(page)
  await expect(readDashboardGeometry(page)).resolves.toMatchObject({
    sectionCount: 3,
    sectionsHaveArea: true,
    sameRow: true,
    similarWidths: true,
    scrollableLists: true,
  })
  const desktopGeometry = await readDashboardGeometry(page)
  expect(desktopGeometry.recordingSectionHeight).toBeLessThan(
    desktopGeometry.dashboardHeight * 0.45,
  )
  expect(desktopGeometry.recordingListClientHeight).toBe(desktopGeometry.recordingListScrollHeight)
  await expectChromiumScreenshot(page.getByTestId('dashboard-page'), testInfo, 'dashboard-list.png')

  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/?timestamp=mobile')
  await expect(page.getByTestId('dashboard-page')).toBeVisible()
  await expectNoDocumentHorizontalOverflow(page)
  await expect(readDashboardGeometry(page)).resolves.toMatchObject({
    sectionCount: 3,
    sectionsHaveArea: true,
    stacked: true,
    scrollableLists: true,
  })
  await expectChromiumScreenshot(
    page.getByTestId('dashboard-page'),
    testInfo,
    'dashboard-list-mobile.png',
  )
})

test('keeps Dashboard free of outer vertical scroll on desktop', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await expect(page.getByTestId('dashboard-page')).toBeVisible()
  await expect(page.getByTestId('dashboard-section-recording')).toBeVisible()

  const scroll = await page.evaluate(() => {
    const scrollingElement = document.scrollingElement ?? document.documentElement
    const shellMain = document.querySelector<HTMLElement>('[data-testid="shell-main"]')

    return {
      documentOverflow: scrollingElement.scrollHeight - scrollingElement.clientHeight,
      bodyOverflow: document.body.scrollHeight - document.body.clientHeight,
      shellMainOverflow:
        shellMain === null ? null : shellMain.scrollHeight - shellMain.clientHeight,
    }
  })

  // Dashboard sets height: calc(100vh - 72px) with overflow hidden at >= 1023px, so neither the
  // document nor shell-main scrolls; the lists scroll inside their sections instead.
  expect(scroll.documentOverflow).toBeLessThanOrEqual(0)
  expect(scroll.bodyOverflow).toBeLessThanOrEqual(0)
  expect(scroll.shellMainOverflow).not.toBeNull()
  expect(scroll.shellMainOverflow as number).toBeLessThanOrEqual(0)
  await expect(readDashboardGeometry(page)).resolves.toMatchObject({ scrollableLists: true })
})

test('switches Dashboard between stacked and side-by-side at 1023px', async ({ page }) => {
  await page.setViewportSize({ width: 1022, height: 800 })
  await page.goto('/')
  await expect(page.getByTestId('dashboard-page')).toBeVisible()
  await expect(readDashboardGeometry(page)).resolves.toMatchObject({
    sectionCount: 3,
    stacked: true,
    sameRow: false,
  })

  await page.setViewportSize({ width: 1023, height: 800 })
  await expect.poll(async () => (await readDashboardGeometry(page)).sameRow).toBe(true)
  await expect(readDashboardGeometry(page)).resolves.toMatchObject({
    sectionCount: 3,
    sectionsHaveArea: true,
    stacked: false,
    similarWidths: true,
  })
  await expectNoDocumentHorizontalOverflow(page)
})

test('keeps Dashboard sections side by side inside the content area at 1264px', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1264, height: 720 })
  await page.goto('/')
  await expect(page.getByTestId('dashboard-page')).toBeVisible()
  await expect(page.getByTestId('dashboard-section-recording')).toBeVisible()
  // Measure only once the permanent drawer is in place and the content is offset by it.
  await expect(page.getByTestId('shell-drawer')).toHaveAttribute('data-drawer-variant', 'permanent')
  await expect(page.getByTestId('shell-main')).toHaveAttribute('data-main-offset', '256')

  const rects = await page.getByTestId('dashboard-page').evaluate((pageElement) =>
    Array.from(
      pageElement.querySelectorAll<HTMLElement>(
        '[data-testid^="dashboard-section-"]:not([data-testid$="-list"])',
      ),
    ).map((section) => {
      const rect = section.getBoundingClientRect()

      return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }
    }),
  )
  const drawerWidth = Number(
    await page.getByTestId('shell-drawer').getAttribute('data-drawer-width'),
  )

  // The permanent drawer (256px) is not part of the content area; every section stays to its
  // right and inside the viewport, and the three sections do not overlap.
  expect(drawerWidth).toBe(256)
  expect(rects).toHaveLength(3)
  const ordered = [...rects].sort((first, second) => first.left - second.left)
  for (const rect of ordered) {
    expect(rect.left).toBeGreaterThanOrEqual(drawerWidth)
    expect(rect.right).toBeLessThanOrEqual(1264)
  }
  for (let index = 1; index < ordered.length; index += 1) {
    expect(ordered[index - 1].right).toBeLessThanOrEqual(ordered[index].left + 0.5)
  }
  expect(Math.max(...ordered.map((rect) => Math.abs(rect.top - ordered[0].top)))).toBeLessThan(2)
})

test('keeps Dashboard dark conflict and delegated dialog geometry stable', async ({
  page,
}, testInfo) => {
  await page.unrouteAll()
  await installAppShellApiMocks(page, {
    enableBroadcastWaveNavigation: true,
    forceDarkTheme: true,
  })
  await installDashboardWorkflowApiMocks(page)
  await page.setViewportSize({ width: 1264, height: 720 })
  await page.goto('/')

  const dashboard = page.getByTestId('dashboard-page')
  await expect(page.getByTestId('app-shell')).toHaveAttribute('data-theme-mode', 'dark')
  await expect(page.getByRole('button', { name: '競合 2 件' })).toBeVisible()
  await expectNoDocumentHorizontalOverflow(page)
  await expectChromiumScreenshot(dashboard, testInfo, 'dashboard-dark-conflict.png')

  await page
    .getByTestId('dashboard-section-reserves-list')
    .getByRole('button', { name: 'Synthetic Dashboard Reserve Alpha', exact: true })
    .click()
  const dialog = page.getByRole('dialog', { name: 'Synthetic Dashboard Reserve Alpha' })
  await expect(dialog).toBeVisible()
  await expectChromiumScreenshot(dialog, testInfo, 'dashboard-reserve-dialog-dark.png')
})

test.describe('Chromium Dashboard empty and error screenshots', () => {
  test('captures empty and error presentations', async ({ page }, testInfo) => {
    if (testInfo.project.name !== 'Desktop Chromium') {
      return
    }

    await page.unrouteAll()
    await installAppShellApiMocks(page)
    await installDashboardWorkflowApiMocks(page, { mode: 'empty' })
    await page.goto('/?timestamp=empty')
    await expect(page.getByRole('heading', { name: '録画中 0/0' })).toBeVisible()
    await expect(page.getByTestId('dashboard-page')).toHaveScreenshot('dashboard-empty.png')

    await page.unrouteAll()
    await installAppShellApiMocks(page)
    await installDashboardWorkflowApiMocks(page, { mode: 'failure' })
    await page.goto('/?timestamp=error')
    await expectAnnounced(page, '予約データ取得に失敗')
    await expect(page.getByTestId('dashboard-page')).toHaveScreenshot('dashboard-error.png')
  })
})
