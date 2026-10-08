import { expect, test } from '@playwright/test'
import { installAppShellApiMocks } from './support/appShellMocks'
import {
  muiSelectCombobox,
  muiSelectInput,
  muiSelectName,
  selectMuiOption,
} from './support/muiSelect'
import { fillTextInput } from './support/searchRuleHelpers'
import { clickWithoutPointerStabilityWait } from './support/pointerInteractions'
import {
  createSearchRuleRequestLog,
  installSearchRuleWorkflowApiMocks,
} from './support/searchRuleMocks'

test.beforeEach(async ({ page }) => {
  await installAppShellApiMocks(page, { enableBroadcastWaveNavigation: true })
})

test('keeps plain Search initial result area blank before a user search', async ({ page }) => {
  await installSearchRuleWorkflowApiMocks(page)

  await page.goto('/#/search')

  await expect(page.getByRole('heading', { name: '検索' })).toBeVisible()
  await expect(page.getByText('検索条件を入力してください')).toHaveCount(0)
  await expect(page.getByRole('region', { name: '検索結果' })).toHaveCount(0)
})

test('toggles Search sub genre visibility from the genre form control', async ({ page }) => {
  await installSearchRuleWorkflowApiMocks(page)

  await page.goto('/#/search')

  await expect(page.getByRole('button', { name: 'ニュース・報道', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '定時・総合', exact: true })).toBeVisible()

  await page.getByLabel('サブジャンル表示').uncheck()

  await expect(page.getByRole('button', { name: 'ニュース・報道', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '定時・総合', exact: true })).toHaveCount(0)

  await page.getByLabel('サブジャンル表示').check()

  await expect(page.getByRole('button', { name: '定時・総合', exact: true })).toBeVisible()
})

test('keeps Search genre hover visually distinct from selected state', async ({ page }) => {
  await installSearchRuleWorkflowApiMocks(page)

  await page.goto('/#/search')

  const unselectedGenre = page.getByRole('button', { name: 'ニュース・報道', exact: true })
  const selectedGenre = page.getByRole('button', { name: 'スポーツ', exact: true }).first()
  await expect(unselectedGenre).toBeVisible()
  await expect(selectedGenre).toBeVisible()

  const baseStyle = await unselectedGenre.evaluate((node) => {
    const style = getComputedStyle(node)

    return {
      backgroundColor: style.backgroundColor,
      color: style.color,
    }
  })

  await unselectedGenre.hover()
  await expect
    .soft(
      unselectedGenre.evaluate((node) => {
        const style = getComputedStyle(node)

        return {
          backgroundColor: style.backgroundColor,
          color: style.color,
        }
      }),
      'unselected genre hover must not reuse selected blue tint',
    )
    .resolves.toEqual(baseStyle)

  await selectedGenre.click()
  const selectedStyle = await selectedGenre.evaluate((node) => {
    const style = getComputedStyle(node)

    return {
      backgroundColor: style.backgroundColor,
      color: style.color,
    }
  })

  await expect.soft(selectedGenre).toHaveAttribute('data-selected', 'true')
  expect(selectedStyle.backgroundColor).not.toBe(baseStyle.backgroundColor)
  expect(selectedStyle.color).not.toBe(baseStyle.color)
})

test('shows clear actions for Search and Rule text fields', async ({ page }) => {
  await installSearchRuleWorkflowApiMocks(page)

  await page.goto('/#/search')
  await page.getByLabel('keyword', { exact: true }).fill('Synthetic')
  await page.getByRole('button', { name: 'keywordをクリア' }).click()
  await expect(page.getByLabel('keyword', { exact: true })).toHaveValue('')

  await page.getByLabel('ignore keyword').fill('Ignore')
  await page.getByRole('button', { name: 'ignore keywordをクリア' }).click()
  await expect(page.getByLabel('ignore keyword')).toHaveValue('')

  await page.getByLabel('最小(分)').fill('15')
  await page.getByRole('button', { name: '最小(分)をクリア' }).click()
  await expect(page.getByLabel('最小(分)')).toHaveValue('')

  await page.getByLabel('keyword', { exact: true }).fill('Synthetic')
  await page.getByTestId('search-rule-page').getByRole('button', { name: '検索' }).click()
  await expect(page.locator('[class*="ruleOptionCard"]').first()).toBeVisible()
  await page.getByLabel('sub directory', { exact: true }).fill('RuleSubDirectory')
  await page.getByRole('button', { name: 'sub directoryをクリア' }).click()
  await expect(page.getByLabel('sub directory', { exact: true })).toHaveValue('')

  await page.goto('/#/rule?keyword=Synthetic')
  await page.getByTestId('title-bar').getByRole('button', { name: '検索' }).click()
  const ruleSearchMenu = page.getByRole('menu', { name: 'ルール検索' })
  await expect(ruleSearchMenu).toBeVisible()
  await ruleSearchMenu.getByRole('button', { name: 'キーワードをクリア' }).click()
  await expect(ruleSearchMenu.getByRole('textbox', { name: 'キーワード' })).toHaveValue('')
})

test('keeps Search selects, checkboxes, period, duplicate, and encode option controls operable', async ({
  page,
}) => {
  const requestLog = createSearchRuleRequestLog()
  await installSearchRuleWorkflowApiMocks(page, { requestLog })

  await page.goto('/#/search')
  await expect(page.getByRole('heading', { name: '検索' })).toBeVisible()
  await expect(page.getByLabel('GR')).toBeVisible()
  await page.getByRole('combobox', { name: 'channelId' }).click()
  await expect(page.locator('[role="option"][data-value="4101"]')).toHaveText(
    'Synthetic Search Channel',
  )
  await page.keyboard.press('Escape')

  await selectMuiOption({ page, name: 'channelId', value: '4101' })
  await expect(muiSelectInput(page, 'channelId')).toHaveValue('4101')
  await selectMuiOption({ page, name: 'genre', value: '7' })
  await expect(muiSelectInput(page, 'genre')).toHaveValue('7')
  await page.getByRole('button', { name: '国内アニメ', exact: true }).click()
  await selectMuiOption({ page, name: 'start', value: '10' })
  await expect(muiSelectInput(page, 'start')).toHaveValue('10')
  await selectMuiOption({ page, name: 'range', value: '3' })
  await expect(muiSelectInput(page, 'range')).toHaveValue('3')
  await page.getByRole('textbox', { name: '最小(分)' }).fill('15')
  await page.getByRole('textbox', { name: '最大(分)' }).fill('90')
  await expect(page.getByRole('textbox', { name: '最小(分)' })).toHaveValue('15')
  await expect(page.getByRole('textbox', { name: '最大(分)' })).toHaveValue('90')

  await page.getByTestId('search-rule-page').getByRole('button', { name: '検索' }).click()
  await expect(page.getByRole('region', { name: '検索結果' })).toBeVisible()
  await expect(page.getByText('1 件ヒット')).toBeVisible()
  expect(
    requestLog.bodies.find(
      (body) => typeof body === 'object' && body !== null && Object.hasOwn(body, 'option'),
    ),
  ).toMatchObject({
    option: {
      channelIds: [4101],
      genres: [{ genre: 7, subGenre: 0 }],
      durationMin: 900,
      durationMax: 5400,
      times: [{ start: 10, range: 3 }],
    },
  })

  await page.getByLabel('有効').uncheck()
  await page.getByLabel('状況に応じて末尾がかけることを許可').uncheck()
  await page.getByLabel('録画済み番組を排除').check()
  await page.getByRole('textbox', { name: '日数' }).fill('7')
  await expect(page.getByRole('textbox', { name: '日数' })).toHaveValue('7')
  // v2: client/src/components/search/SearchRuleOption.vue:174 `.period { max-width: 90px }`.
  // v3: SearchRulePage.module.css `.ruleOptionField[data-width='period'] { max-width: 90px }`;
  // also spec'd at .kiro/specs/frontend-search-rule/visual-cases.md:56 ("duplicate period は 90px 程度").
  // 100 = 90px + 10px margin for box-model rounding.
  await expect
    .soft(
      page
        .getByRole('textbox', { name: '日数' })
        .evaluate((node) => Math.round(node.getBoundingClientRect().width)),
      'duplicate period field keeps source-like compact width',
    )
    .resolves.toBeLessThanOrEqual(100)
  await expect(page.locator('span').filter({ hasText: /^directory$/ })).toBeVisible()
  await expect(page.locator('span').filter({ hasText: /^sub directory$/ })).toBeVisible()
  await expect
    .soft(
      page.locator('summary[data-title="ディレクトリ"]').evaluate((summary) => {
        const panel = summary.closest('details')

        return panel === null
          ? 'missing'
          : getComputedStyle(panel, '::details-content').transitionDuration
      }),
      'Rule option accordion keeps a non-zero native details-content transition',
    )
    .resolves.not.toBe('0s')
  await expect(muiSelectCombobox(page, 'directory', true)).toBeVisible()
  // v2: client/src/components/search/SearchRuleOption.vue:176 `.directory { max-width: 150px }`.
  // v3: SearchRulePage.module.css `.ruleOptionField[data-width='directory'] { max-width: 150px }`;
  // also spec'd at .kiro/specs/frontend-search-rule/visual-cases.md:56 ("directory/mode select は 150px 程度").
  // 160 = 150px + 10px margin for box-model rounding.
  await expect
    .soft(
      muiSelectCombobox(page, 'directory', true).evaluate((node) =>
        Math.round(node.getBoundingClientRect().width),
      ),
      'directory select keeps source-like compact width',
    )
    .resolves.toBeLessThanOrEqual(160)

  await expect(muiSelectCombobox(page, 'mode1')).toBeVisible()
  await selectMuiOption({ page, name: 'mode1', value: 'synthetic-encode-main' })
  await selectMuiOption({ page, name: 'directory1', value: 'archive-root', exact: true })
  await fillTextInput(page.getByLabel('sub directory1', { exact: true }), 'encoded-sub-1')
  await expect(page.getByLabel('sub directory1', { exact: true })).toHaveValue('encoded-sub-1')

  await page.locator('summary[data-title="エンコード2"]').click()
  await expect(muiSelectCombobox(page, 'mode2')).toBeVisible()
  await expect(muiSelectCombobox(page, 'directory2', true)).toBeVisible()
  await expect(page.getByLabel('sub directory2', { exact: true })).toBeVisible()
  await fillTextInput(page.getByLabel('sub directory2', { exact: true }), 'encoded-sub-2')
  await expect(page.getByLabel('sub directory2', { exact: true })).toHaveValue('encoded-sub-2')
  await selectMuiOption({ page, name: 'directory2', value: 'backup-root', exact: true })
  await selectMuiOption({ page, name: 'mode2', value: 'synthetic-encode-sub' })
  // v2: client/src/components/search/SearchRuleOption.vue:178 `.encode-mode { max-width: 150px }`.
  // v3: SearchRulePage.module.css `.ruleOptionField[data-width='encode'] { max-width: 150px }`;
  // also spec'd at .kiro/specs/frontend-search-rule/visual-cases.md:56 ("directory/mode select は 150px 程度").
  // 160 = 150px + 10px margin for box-model rounding.
  await expect
    .soft(
      page
        .getByRole('combobox', { name: muiSelectName('mode2', true) })
        .evaluate((node) => Math.round(node.getBoundingClientRect().width)),
      'mode2 select keeps source-like compact width',
    )
    .resolves.toBeLessThanOrEqual(160)
  await clickWithoutPointerStabilityWait(page.locator('summary[data-title="エンコード3"]'))
  await expect(muiSelectCombobox(page, 'mode3')).toBeVisible()
  await expect(muiSelectCombobox(page, 'directory3', true)).toBeVisible()
  await expect(page.getByLabel('sub directory3', { exact: true })).toBeVisible()
  await fillTextInput(page.getByLabel('sub directory3', { exact: true }), 'encoded-sub-3')
  await expect(page.getByLabel('sub directory3', { exact: true })).toHaveValue('encoded-sub-3')
  await selectMuiOption({ page, name: 'directory3', value: 'archive-root', exact: true })
  await selectMuiOption({ page, name: 'mode3', value: 'synthetic-encode-main' })

  await page.getByRole('button', { name: '追加' }).click()
  await expect.poll(() => requestLog.methods).toContain('POST /api/rules')
  const addRuleBody = requestLog.bodies.find(
    (body) =>
      typeof body === 'object' &&
      body !== null &&
      Object.hasOwn(body, 'reserveOption') &&
      Object.hasOwn(body, 'encodeOption'),
  )
  expect(addRuleBody).toMatchObject({
    encodeOption: {
      mode1: 'synthetic-encode-main',
      encodeParentDirectoryName1: 'archive-root',
      directory1: 'encoded-sub-1',
      mode2: 'synthetic-encode-sub',
      encodeParentDirectoryName2: 'backup-root',
      directory2: 'encoded-sub-2',
      mode3: 'synthetic-encode-main',
      encodeParentDirectoryName3: 'archive-root',
      directory3: 'encoded-sub-3',
    },
  })
})
