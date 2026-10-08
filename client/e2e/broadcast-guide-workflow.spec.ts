import { expect, test } from '@playwright/test'
import { getHashSearchParams, installBroadcastWorkflowMocks } from './support/broadcastWorkflow'
import { selectMuiOption } from './support/muiSelect'
import {
  createSearchRuleRequestLog,
  installSearchRuleWorkflowApiMocks,
} from './support/searchRuleMocks'
import { expectAnnounced } from './support/notificationObservation'

test.beforeEach(async ({ page }) => {
  await installBroadcastWorkflowMocks(page)
})

test('opens the shared stream dialog from Guide and returns to single-channel Guide', async ({
  page,
}) => {
  await page.goto('/#/guide?type=GR&time=23111507')

  await expect(page.getByTestId('guide-page')).toHaveAttribute('data-guide-visible', 'true')
  await page.getByText('Synthetic Guide GR').click()

  const dialog = page.getByRole('dialog', { name: 'ストリーム選択' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('button', { name: '番組表' })).toBeVisible()
  await dialog.getByRole('button', { name: '番組表' }).click()

  await expect
    .poll(() => new URLSearchParams(page.url().split('?')[1] ?? '').get('channelId'))
    .toBe('301')
  await expect
    .poll(() => new URLSearchParams(page.url().split('?')[1] ?? '').get('time'))
    .toBe('23111507')
  await expect
    .poll(() => new URLSearchParams(page.url().split('?')[1] ?? '').get('type'))
    .toBeNull()
  await expect(page.getByTestId('guide-page')).toHaveAttribute('data-guide-visible', 'true')
})

test('opens the program dialog from a Guide program cell', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/#/guide?type=GR&time=23111507')

  await expect(page.getByTestId('guide-page')).toHaveAttribute('data-guide-visible', 'true')
  await page.getByTestId('guide-program-4101').click()

  const dialog = page.getByRole('dialog', { name: 'Synthetic Morning News' })
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('Synthetic guide news description')
})

test('keeps Guide grid, selectors, genre visibility, and search handoff source-compatible', async ({
  page,
}) => {
  await page.goto('/#/guide?type=GR&time=23111507')

  await expect(page.getByTestId('guide-page')).toHaveAttribute('data-guide-visible', 'true')
  const programCell = page.getByTestId('guide-program-4101')
  await expect(programCell).toBeVisible()
  await expect(programCell).toHaveCSS('text-align', 'left')
  await expect(programCell).toHaveCSS('justify-content', 'flex-start')
  const firstTextOffset = await programCell.evaluate((cell) => {
    const firstChild = cell.querySelector<HTMLElement>('div.name')

    if (firstChild === null) {
      return Number.POSITIVE_INFINITY
    }

    return firstChild.getBoundingClientRect().top - cell.getBoundingClientRect().top
  })
  // Source A/D/C: src/features/guide/GuidePage.module.css:696 `border: 1px solid #ccc` + :710
  // `padding: 2px 4px` on `.guide-program-cell` puts the first child's top 3px below the cell's own
  // top (border 1px + padding-top 2px). Measured via a temporary console.log
  // (`npx playwright test e2e/broadcast-guide-workflow.spec.ts -g source-compatible`, 3 runs):
  // firstTextOffset is exactly 3 every time, matching the CSS. The v2 counterpart differs: v2
  // client/src/views/Guide.vue:513-525 `.programs .item` is `padding: 0; border: 1px solid #ccc`
  // (offset 1px), and `.name` (Guide.vue:531) only sets font-weight, so v3 deliberately adds the
  // 2px padding on top of v2's 1px.
  expect(firstTextOffset).toBeLessThanOrEqual(3)

  await page.getByRole('heading', { name: '番組表' }).click()
  const dayOptions = page.getByTestId('guide-day-option')
  await expect(dayOptions).toHaveCount(8)
  await expect(dayOptions.nth(0)).toHaveText('11/15(水)')
  await expect(dayOptions.nth(1)).toHaveText('11/16(木)')
  await expect(dayOptions.nth(7)).toHaveText('11/22(水)')
  const dayOptionBoxes = await dayOptions.evaluateAll((options) =>
    options.map((option) => {
      const rect = option.getBoundingClientRect()
      return { left: Math.round(rect.left), top: Math.round(rect.top) }
    }),
  )
  expect(new Set(dayOptionBoxes.map((box) => box.left)).size).toBe(1)
  for (let index = 1; index < dayOptionBoxes.length; index += 1) {
    expect(dayOptionBoxes[index].top).toBeGreaterThan(dayOptionBoxes[index - 1].top)
  }
  await page.keyboard.press('Escape')

  await page.getByRole('button', { name: '時刻選択' }).click()
  const timeMenu = page.getByRole('menu')
  await expect(timeMenu).toBeVisible()
  await expect(page.getByRole('combobox', { name: '放送波' })).toContainText('GR')
  await expect(page.getByRole('combobox', { name: '日付' })).toContainText('11/15(水)')
  await expect(page.getByRole('combobox', { name: '時' })).toContainText('7時')
  await selectMuiOption({ page, name: '時', value: '10' })
  await timeMenu.getByRole('button', { name: '表示' }).click()
  await expect(page).toHaveURL(/#\/guide\?time=23111510&type=GR&timestamp=\d+$/)

  await page.goto('/#/guide?type=GR&time=23111507')
  await expect(page.getByTestId('guide-page')).toHaveAttribute('data-guide-visible', 'true')
  await page.getByTestId('title-bar').getByRole('button', { name: '番組表メニュー' }).click()
  await page.getByRole('menuitem', { name: '表示ジャンル' }).click()
  const genreDialog = page.getByRole('dialog', { name: '表示ジャンル' })
  await expect(genreDialog).toBeVisible()
  await genreDialog.getByRole('switch', { name: 'ニュース・報道' }).click()
  await genreDialog.getByRole('button', { name: '更新' }).click()
  await expect(programCell).toHaveClass(/hide/)
  await expect(programCell).toBeVisible()
  await expect(programCell).toHaveCSS('background-color', 'rgb(248, 248, 248)')
  await expect(programCell).toHaveCSS('color', 'rgb(136, 136, 136)')
  await expect(programCell).toHaveCount(1)

  await programCell.evaluate((element) => element.classList.remove('hide'))
  await programCell.click()
  const dialog = page.getByRole('dialog', { name: 'Synthetic Morning News' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: '検索' }).click()
  expect(page.url()).toContain('#/guide?type=GR&time=23111507')
  await expect(dialog).toBeHidden()
  await expect(page).toHaveURL(/#\/search\?/)
  await expect
    .poll(() => getHashSearchParams(page.url()).get('keyword'))
    .toBe('Synthetic Morning News')
  await expect.poll(() => getHashSearchParams(page.url()).get('channelId')).toBe('301')
  await expect.poll(() => getHashSearchParams(page.url()).get('genre')).toBe('0')
  await expect.poll(() => getHashSearchParams(page.url()).get('timestamp')).toBe('1700000000000')
})

test('adds a rule from Guide ProgramDialog search handoff without null optional payload fields', async ({
  page,
}) => {
  const requestLog = createSearchRuleRequestLog()
  await installSearchRuleWorkflowApiMocks(page, { requestLog })

  await page.goto('/#/guide?type=GR&time=23111507')
  await expect(page.getByTestId('guide-page')).toHaveAttribute('data-guide-visible', 'true')
  await page.getByTestId('guide-program-4101').click()

  const dialog = page.getByRole('dialog', { name: 'Synthetic Morning News' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: '検索' }).click()

  await expect(page).toHaveURL(/#\/search\?/)
  await expect(page.getByText('1 件ヒット')).toBeVisible()

  await page.getByRole('button', { name: '追加' }).click()
  await expect.poll(() => requestLog.methods).toContain('POST /api/rules')
  const addRuleBody = requestLog.bodies.find(
    (body) =>
      typeof body === 'object' &&
      body !== null &&
      Object.hasOwn(body, 'reserveOption') &&
      Object.hasOwn(body, 'saveOption'),
  )
  expect(addRuleBody).toMatchObject({
    searchOption: {
      keyword: 'Synthetic Morning News',
      name: true,
      description: true,
      channelIds: [301],
      genres: [{ genre: 0 }],
    },
    reserveOption: {
      enable: true,
      allowEndLack: true,
      avoidDuplicate: false,
    },
    saveOption: {},
  })
  expect(JSON.stringify(addRuleBody)).not.toContain(':null')
  await expectAnnounced(page, 'ルール追加に成功')
})

test('reflects ProgramDialog reserve actions in the Guide grid without fetch errors', async ({
  page,
}) => {
  await page.goto('/#/guide?type=GR&time=23111507')

  await expect(page.getByTestId('guide-page')).toHaveAttribute('data-guide-visible', 'true')
  await expect(page.getByTestId('guide-program-4101')).not.toHaveClass(/reserve/)

  await page.getByTestId('guide-program-4101').click()
  const dialog = page.getByRole('dialog', { name: 'Synthetic Morning News' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: '予約' }).click()

  await expectAnnounced(page, 'Synthetic Morning News 予約')
  await expect(page.getByTestId('guide-program-4101')).toHaveClass(/reserve/)
  await expect(page.getByText('番組表情報の取得に失敗しました')).toHaveCount(0)

  await page.goto('/#/dashboard')
  await page.goto('/#/guide?type=GR&time=23111507')

  await expect(page.getByTestId('guide-page')).toHaveAttribute('data-guide-visible', 'true')
  await expect(page.getByTestId('guide-program-4101')).toHaveClass(/reserve/)
  await expect(page.getByText('番組表情報の取得に失敗しました')).toHaveCount(0)
})

test('keeps Guide setting select controls operable through the styled field surface', async ({
  page,
}) => {
  await page.goto('/#/guide/setting')

  await expect(page.getByTestId('guide-setting-page')).toBeVisible()
  const channelWidthSelect = page.getByRole('combobox', { name: '通常表示 チャンネル横幅' })
  await expect(channelWidthSelect).toBeVisible()
  await expect(channelWidthSelect).toContainText('140')

  await selectMuiOption({ page, name: '通常表示 チャンネル横幅', value: '200' })

  await expect(channelWidthSelect).toContainText('200')
})
