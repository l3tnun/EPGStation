import { expect, test } from '@playwright/test'
import { installAppShellApiMocks } from './support/appShellMocks'
import { installGuideOnAirApiMocks } from './support/guideOnAirMocks'
import { collectVisibleUiAuditRows, expectNoUiAuditFailures } from './support/uiAudit'

test('audits dark Guide grid, menu, genre dialog, time selector, and setting page', async ({
  page,
}, testInfo) => {
  await installAppShellApiMocks(page, {
    enableBroadcastWaveNavigation: true,
    forceDarkTheme: true,
  })
  await installGuideOnAirApiMocks(page)
  await page.goto('/#/guide?type=GR&time=23111507')
  await page.getByTestId('title-bar').getByRole('button', { name: '番組表メニュー' }).click()

  const menuRows = await collectVisibleUiAuditRows(page, {
    page: 'guide',
    route: '/guide',
    dataState: 'main menu open',
    theme: 'dark',
    viewportDevice: testInfo.project.name,
    openedState: 'main menu open',
    component: 'guide main menu',
    rootSelector: '.MuiPopover-root',
  })

  testInfo.attach('dark-guide-main-menu-audit.json', {
    body: JSON.stringify(menuRows, null, 2),
    contentType: 'application/json',
  })
  await expectNoUiAuditFailures(menuRows)
  await page.getByRole('menuitem', { name: '表示ジャンル' }).click()

  const genreRows = await collectVisibleUiAuditRows(page, {
    page: 'guide',
    route: '/guide',
    dataState: 'genre dialog open',
    theme: 'dark',
    viewportDevice: testInfo.project.name,
    openedState: 'genre dialog open',
    component: 'guide genre dialog',
    rootSelector: '[role="dialog"][aria-label="表示ジャンル"]',
  })

  testInfo.attach('dark-guide-genre-dialog-audit.json', {
    body: JSON.stringify(genreRows, null, 2),
    contentType: 'application/json',
  })
  await expectNoUiAuditFailures(genreRows)
  await page.getByRole('button', { name: 'キャンセル' }).click()

  const gridRows = await collectVisibleUiAuditRows(page, {
    page: 'guide',
    route: '/guide',
    dataState: 'grid visible',
    theme: 'dark',
    viewportDevice: testInfo.project.name,
    openedState: 'default',
    component: 'guide grid',
    rootSelector: '[data-testid="guide-page"]',
  })

  testInfo.attach('dark-guide-grid-audit.json', {
    body: JSON.stringify(gridRows, null, 2),
    contentType: 'application/json',
  })
  const sourceGuideGridBackgrounds = new Set([
    'rgb(64, 182, 189)',
    'rgb(151, 160, 57)',
    'rgb(89, 177, 199)',
    'rgb(216, 134, 134)',
    'rgb(127, 165, 52)',
    'rgb(207, 86, 161)',
    'rgb(216, 91, 42)',
    'rgb(235, 130, 66)',
    'rgb(81, 85, 133)',
    'rgb(131, 169, 147)',
    'rgb(44, 120, 115)',
    'rgb(70, 179, 230)',
    'rgb(68, 81, 101)',
    'rgb(113, 113, 113)',
    'rgb(248, 248, 248)',
    'rgb(39, 33, 33)',
    'rgb(152, 195, 47)',
    'rgb(180, 200, 49)',
    'rgb(209, 204, 52)',
    'rgb(239, 204, 53)',
    'rgb(255, 205, 62)',
    'rgb(255, 198, 54)',
    'rgb(254, 175, 51)',
    'rgb(254, 156, 48)',
    'rgb(254, 136, 47)',
    'rgb(254, 123, 45)',
    'rgb(254, 113, 44)',
    'rgb(253, 105, 43)',
    'rgb(253, 95, 37)',
    'rgb(253, 87, 43)',
    'rgb(244, 76, 60)',
    'rgb(227, 63, 110)',
    'rgb(206, 53, 162)',
    'rgb(182, 48, 217)',
    'rgb(158, 47, 252)',
    'rgb(133, 47, 252)',
    'rgb(101, 47, 252)',
    'rgb(63, 44, 243)',
    'rgb(41, 35, 213)',
    'rgb(37, 32, 192)',
  ])
  await expectNoUiAuditFailures(
    gridRows.filter(
      (row) =>
        ![...sourceGuideGridBackgrounds].some((background) =>
          row.actual.includes(` on ${background};`),
        ),
    ),
  )
  const timeScaleTextColors = await page
    .getByTestId('guide-time-scale')
    .locator('.guide-time-scale-item:not(.guide-time-scale-dummy)')
    .evaluateAll((items) => [...new Set(items.map((item) => getComputedStyle(item).color))].sort())
  expect(timeScaleTextColors).toEqual(['rgb(255, 255, 255)'])
  const brightTimeScaleBackgrounds = await page
    .getByTestId('guide-time-scale')
    .locator('.guide-time-scale-item:not(.guide-time-scale-dummy)')
    .evaluateAll((items) =>
      items
        .map((item) => {
          const { backgroundColor } = getComputedStyle(item)
          const match = /^rgb\((\d+), (\d+), (\d+)\)$/.exec(backgroundColor)

          return match === null
            ? { backgroundColor, isBright: false }
            : {
                backgroundColor,
                isBright:
                  Number(match[1]) > 140 || Number(match[2]) > 140 || Number(match[3]) > 140,
              }
        })
        .filter((entry) => entry.isBright)
        .map((entry) => entry.backgroundColor),
    )
  expect(brightTimeScaleBackgrounds).toContain('rgb(255, 205, 62)')

  await page.getByRole('button', { name: '時刻選択' }).click()
  const timeRows = await collectVisibleUiAuditRows(page, {
    page: 'guide',
    route: '/guide',
    dataState: 'time selector open',
    theme: 'dark',
    viewportDevice: testInfo.project.name,
    openedState: 'time selector open',
    component: 'guide time selector',
    rootSelector: '[role="menu"]',
  })

  testInfo.attach('dark-guide-time-selector-audit.json', {
    body: JSON.stringify(timeRows, null, 2),
    contentType: 'application/json',
  })
  await expectNoUiAuditFailures(timeRows)

  await page.goto('/#/guide/setting')
  const settingRows = await collectVisibleUiAuditRows(page, {
    page: 'guide-setting',
    route: '/guide/setting',
    dataState: 'setting form',
    theme: 'dark',
    viewportDevice: testInfo.project.name,
    openedState: 'default',
    component: 'guide setting form',
    rootSelector: '[data-testid="guide-setting-page"]',
  })

  testInfo.attach('dark-guide-setting-audit.json', {
    body: JSON.stringify(settingRows, null, 2),
    contentType: 'application/json',
  })
  await expectNoUiAuditFailures(settingRows)
})
