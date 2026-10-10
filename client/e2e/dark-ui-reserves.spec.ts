import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { installAppShellApiMocks } from './support/appShellMocks'
import { installPagedListApiMocks } from './support/pagedListMocks'
import {
  installReservesApiMocks,
  manualProgramDetail,
  reserveDeleteTarget,
  reserveDialogFull,
} from './support/reservesMocks'
import { seedExtendedPagination } from './support/searchRuleMocks'
import {
  collectVisibleUiAuditRows,
  expectNoUiAuditFailures,
  type UiAuditRow,
} from './support/uiAudit'

const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
] as const

async function attachAudit(testInfo: TestInfo, name: string, rows: UiAuditRow[]): Promise<void> {
  await testInfo.attach(name, {
    body: JSON.stringify(rows, null, 2),
    contentType: 'application/json',
  })
  await expectNoUiAuditFailures(rows)
}

async function prepareDarkReserves(page: Page): Promise<void> {
  await installAppShellApiMocks(page, {
    enableBroadcastWaveNavigation: true,
    forceDarkTheme: true,
  })
}

for (const viewport of VIEWPORTS) {
  const viewportLabel = `${viewport.width}x${viewport.height}`

  test.describe(`dark Reserves at ${viewportLabel}`, () => {
    test.beforeEach(async ({ page }) => {
      await prepareDarkReserves(page)
      await page.setViewportSize(viewport)
    })

    test('audits the card list, title menu, item menu, and bulk dialog', async ({
      page,
    }, testInfo) => {
      await installReservesApiMocks(page)
      await page.goto('/#/reserves')
      await page.getByTestId('title-bar').getByRole('button', { name: '予約メニュー' }).click()

      const titleMenuRows = await collectVisibleUiAuditRows(page, {
        page: 'reserves',
        route: '/reserves',
        dataState: 'title menu open',
        theme: 'dark',
        viewportDevice: testInfo.project.name,
        openedState: 'title menu open',
        component: 'reserves title menu',
        rootSelector: '.MuiPopover-root',
      })
      await attachAudit(testInfo, 'dark-reserves-title-menu-audit.json', titleMenuRows)
      await page.keyboard.press('Escape')

      const listRows = await collectVisibleUiAuditRows(page, {
        page: 'reserves',
        route: '/reserves',
        dataState: 'card list',
        theme: 'dark',
        viewportDevice: testInfo.project.name,
        openedState: 'default',
        component: 'reserves card list',
        rootSelector: '[data-testid="reserves-page"]',
      })
      await attachAudit(testInfo, 'dark-reserves-card-list-audit.json', listRows)

      await page.getByRole('button', { name: `予約メニュー: ${reserveDeleteTarget.name}` }).click()
      const itemMenuRows = await collectVisibleUiAuditRows(page, {
        page: 'reserves',
        route: '/reserves',
        dataState: 'item menu open',
        theme: 'dark',
        viewportDevice: testInfo.project.name,
        openedState: 'item menu open',
        component: 'reserves item menu',
        rootSelector: '.MuiPopover-root',
      })
      await attachAudit(testInfo, 'dark-reserves-item-menu-audit.json', itemMenuRows)
      await page.keyboard.press('Escape')

      await page.getByTestId('title-bar').getByRole('button', { name: '予約メニュー' }).click()
      await page.getByRole('menuitem', { name: '編集' }).click()
      await page.getByRole('button', { name: 'すべて選択' }).click()
      await page.getByRole('button', { name: '選択項目を削除' }).click()
      const bulkDialogRows = await collectVisibleUiAuditRows(page, {
        page: 'reserves',
        route: '/reserves',
        dataState: 'bulk delete dialog open',
        theme: 'dark',
        viewportDevice: testInfo.project.name,
        openedState: 'bulk delete dialog open',
        component: 'reserves bulk delete dialog',
        rootSelector: '[role="dialog"][aria-labelledby="reserve-bulk-delete-title"]',
      })
      await attachAudit(testInfo, 'dark-reserves-bulk-delete-dialog-audit.json', bulkDialogRows)
    })

    test('audits the reserve dialog with its description, extended text, and link', async ({
      page,
    }, testInfo) => {
      await installReservesApiMocks(page)
      await page.goto('/#/reserves')
      await page
        .getByTestId('reserves-list-item')
        .filter({ hasText: reserveDialogFull.name })
        .click()
      const dialog = page.getByRole('dialog', { name: reserveDialogFull.name })
      await expect(dialog.getByRole('link')).toBeVisible()

      const dialogRows = await collectVisibleUiAuditRows(page, {
        page: 'reserves',
        route: '/reserves',
        dataState: 'reserve dialog open',
        theme: 'dark',
        viewportDevice: testInfo.project.name,
        openedState: 'reserve dialog open',
        component: 'reserves reserve dialog',
        rootSelector: '[role="dialog"]',
      })
      expect(dialogRows.length).toBeGreaterThan(0)
      await attachAudit(testInfo, 'dark-reserves-reserve-dialog-audit.json', dialogRows)
    })

    test('audits the manual reserve form with its description, disabled fields, and option panels', async ({
      page,
    }, testInfo) => {
      await installReservesApiMocks(page)
      await page.goto(`/#/reserves/manual?programId=${manualProgramDetail.id}`)
      await expect(page.getByTestId('manual-reserve-page')).toHaveAttribute(
        'data-manual-mode',
        'add',
      )
      await expect(page.getByRole('heading', { name: manualProgramDetail.name })).toBeVisible()

      const formRows = await collectVisibleUiAuditRows(page, {
        page: 'reserves manual',
        route: '/reserves/manual',
        dataState: 'manual reserve form',
        theme: 'dark',
        viewportDevice: testInfo.project.name,
        openedState: 'default',
        component: 'manual reserve form',
        rootSelector: '[data-testid="manual-reserve-page"]',
      })
      expect(formRows.length).toBeGreaterThan(0)
      await attachAudit(testInfo, 'dark-manual-reserve-form-audit.json', formRows)
    })

    for (const isExtended of [false, true]) {
      test(`audits the ${isExtended ? 'extended' : 'legacy'} pagination of a list with several pages`, async ({
        page,
      }, testInfo) => {
        await installPagedListApiMocks(page)
        await seedExtendedPagination(page, isExtended)
        await page.goto('/#/reserves?page=2')
        const pagination = page.getByRole('navigation', { name: 'ページ' })
        await expect(pagination).toBeVisible()

        const paginationRows = await collectVisibleUiAuditRows(page, {
          page: 'reserves',
          route: '/reserves',
          dataState: `${isExtended ? 'extended' : 'legacy'} pagination`,
          theme: 'dark',
          viewportDevice: testInfo.project.name,
          openedState: 'default',
          component: `reserves ${isExtended ? 'extended' : 'legacy'} pagination`,
          rootSelector: 'nav[aria-label="ページ"]',
        })
        expect(paginationRows.length).toBeGreaterThan(0)
        await attachAudit(
          testInfo,
          `dark-reserves-${isExtended ? 'extended' : 'legacy'}-pagination-audit.json`,
          paginationRows,
        )
      })
    }
  })
}
