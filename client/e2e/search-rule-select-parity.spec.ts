import { expect, test } from '@playwright/test'
import { installAppShellApiMocks } from './support/appShellMocks'
import { muiSelectCombobox, muiSelectInput, selectMuiOption } from './support/muiSelect'
import {
  expectHiddenPlaceholderOption,
  toggleChannelOption,
  expectRuleOptionFieldGaps,
  expectTextClear,
  expectSelectClear,
} from './support/searchRuleHelpers'
import { clickWithoutPointerStabilityWait } from './support/pointerInteractions'
import {
  createSearchRuleRequestLog,
  installSearchRuleWorkflowApiMocks,
} from './support/searchRuleMocks'

test.beforeEach(async ({ page }) => {
  await installAppShellApiMocks(page, { enableBroadcastWaveNavigation: true })
})

test('keeps ui-problem6 Search select visual parity in a real browser', async ({ page }) => {
  const requestLog = createSearchRuleRequestLog()
  await installSearchRuleWorkflowApiMocks(page, { requestLog })

  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/#/search')
  await expect(page.getByRole('heading', { name: '検索' })).toBeVisible()

  await expect(page.locator('[data-channel-select-wrapper] [role="combobox"]')).toContainText(
    'channel',
  )
  await expect
    .soft(
      page.locator('[data-channel-select-wrapper] [role="combobox"]').evaluate((node) => {
        const placeholder = node.querySelector<HTMLElement>('[class*="channelSelectPlaceholder"]')

        return placeholder === null ? null : getComputedStyle(placeholder).color
      }),
      'channel placeholder uses the same muted placeholder treatment as keyword inputs',
    )
    .resolves.toBe('rgba(0, 0, 0, 0.6)')
  await expect(page.locator('[data-channel-select-wrapper] fieldset')).toHaveCount(0)
  await expect(page.getByRole('combobox', { name: 'genre' })).toContainText('すべて')
  await expect(page.getByRole('combobox', { name: 'start' })).toContainText('start')
  await expect(page.getByRole('combobox', { name: 'range' })).toContainText('range')

  await page.locator('[data-channel-select-wrapper] [role="combobox"]').click()
  await expect(page.getByRole('listbox')).toBeVisible()
  await expect(page.getByRole('option', { name: 'channel', exact: true })).toHaveCount(0)
  await page.getByRole('listbox').press('Escape')
  await expect(page.locator('[data-channel-select-wrapper] [role="combobox"]')).toHaveAttribute(
    'aria-expanded',
    'false',
  )
  await expectHiddenPlaceholderOption(page, 'start', 'start')
  await expectHiddenPlaceholderOption(page, 'range', 'range')

  const channelBox = await page
    .locator('[data-channel-select-wrapper] [role="combobox"]')
    .boundingBox()
  const grBox = await page.getByLabel('GR').boundingBox()
  expect(channelBox).not.toBeNull()
  expect(grBox).not.toBeNull()
  if (channelBox !== null && grBox !== null) {
    expect(grBox.y - (channelBox.y + channelBox.height)).toBeGreaterThanOrEqual(8)
  }

  const rangeBox = await page.getByRole('combobox', { name: 'range' }).boundingBox()
  const mondayBox = await page.getByLabel('月').boundingBox()
  expect(rangeBox).not.toBeNull()
  expect(mondayBox).not.toBeNull()
  if (rangeBox !== null && mondayBox !== null) {
    expect(mondayBox.y - (rangeBox.y + rangeBox.height)).toBeGreaterThanOrEqual(8)
  }

  await toggleChannelOption(page, '4101')
  await expect(page.getByRole('listbox')).toBeVisible()
  await toggleChannelOption(page, '4102')
  await expect(page.locator('[role="option"][data-value="4101"]')).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await expect(page.locator('[role="option"][data-value="4102"]')).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await expect(
    page.locator('[role="option"][data-value="4101"]').getByRole('checkbox'),
  ).toBeChecked()
  await expect(
    page.locator('[role="option"][data-value="4102"]').getByRole('checkbox'),
  ).toBeChecked()
  await page.getByRole('listbox').press('Escape')
  await expect(page.locator('[data-channel-select-wrapper] [role="combobox"]')).toHaveAttribute(
    'aria-expanded',
    'false',
  )
  await expect(page.locator('[data-channel-select-wrapper] [role="combobox"]')).toContainText(
    'Synthetic Search Channel, Synthetic Search Channel Sub',
  )
  await expect
    .soft(
      page.locator('[data-channel-select-wrapper] [role="combobox"]').evaluate((node) => {
        const wrapper = node.closest<HTMLElement>('[data-channel-select-wrapper]')
        const card = node.closest<HTMLElement>('div[class*="searchCard"]')
        const nodeRect = node.getBoundingClientRect()
        const wrapperRect = wrapper?.getBoundingClientRect()
        const cardRect = card?.getBoundingClientRect()
        const style = getComputedStyle(node)

        return {
          height: Math.round(nodeRect.height),
          nodeRight: Math.round(nodeRect.right),
          wrapperRight: wrapperRect === undefined ? null : Math.round(wrapperRect.right),
          cardRight: cardRect === undefined ? null : Math.round(cardRect.right),
          overflowX: style.overflowX,
          textOverflow: style.textOverflow,
          whiteSpace: style.whiteSpace,
        }
      }),
      'channel multi-select keeps AppSelect-like height and clips selected text inside the card',
    )
    .resolves.toMatchObject({
      height: 48,
      overflowX: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
    })
  const channelGeometry = await page
    .locator('[data-channel-select-wrapper] [role="combobox"]')
    .evaluate((node) => {
      const wrapper = node.closest<HTMLElement>('[data-channel-select-wrapper]')
      const card = node.closest<HTMLElement>('div[class*="searchCard"]')
      const nodeRect = node.getBoundingClientRect()
      const wrapperRect = wrapper?.getBoundingClientRect()
      const cardRect = card?.getBoundingClientRect()

      return {
        nodeRight: Math.round(nodeRect.right),
        wrapperRight: wrapperRect === undefined ? null : Math.round(wrapperRect.right),
        cardRight: cardRect === undefined ? null : Math.round(cardRect.right),
      }
    })
  expect(channelGeometry.wrapperRight).not.toBeNull()
  expect(channelGeometry.cardRight).not.toBeNull()
  // Provenance (D): v3-only "control stays within its wrapper/card" containment contract; the
  // channel multi-select must not overflow its own wrapper or the search card around it. +1 only
  // tolerates sub-pixel rounding.
  expect(channelGeometry.nodeRight).toBeLessThanOrEqual((channelGeometry.wrapperRight ?? 0) + 1)
  expect(channelGeometry.nodeRight).toBeLessThanOrEqual((channelGeometry.cardRight ?? 0) + 1)
  const channelClearButton = page.getByRole('button', { name: 'channelIdをクリア' })
  await expect
    .soft(
      channelClearButton.evaluate((node) => {
        const rect = node.getBoundingClientRect()
        const icon = node.querySelector('span')

        return {
          color: getComputedStyle(node).color,
          fontSize: icon === null ? '' : getComputedStyle(icon).fontSize,
          height: Math.round(rect.height),
          iconColor: icon === null ? '' : getComputedStyle(icon).color,
          width: Math.round(rect.width),
        }
      }),
      'channel clear button uses the shared Settings clear button size and blue color',
    )
    .resolves.toMatchObject({
      color: 'rgb(25, 118, 210)',
      fontSize: '28px',
      height: 32,
      iconColor: 'rgb(25, 118, 210)',
      width: 32,
    })
  await channelClearButton.click()
  await expect(page.locator('[data-channel-select-wrapper] [role="combobox"]')).toContainText(
    'channel',
  )

  await toggleChannelOption(page, '4101')
  await expect(page.getByRole('listbox')).toBeVisible()
  await toggleChannelOption(page, '4102')
  await page.getByRole('listbox').press('Escape')
  await expect(page.locator('[data-channel-select-wrapper] [role="combobox"]')).toHaveAttribute(
    'aria-expanded',
    'false',
  )
  await selectMuiOption({ page, name: 'genre', value: '7' })
  await expect(page.getByRole('combobox', { name: 'genre' })).toContainText('アニメ・特撮')
  await expect(page.getByRole('button', { name: 'genreをクリア' })).toHaveCount(0)
  await selectMuiOption({ page, name: 'genre', value: '' })
  await expect(page.getByRole('combobox', { name: 'genre' })).toContainText('すべて')

  await selectMuiOption({ page, name: 'start', value: '10' })
  await clickWithoutPointerStabilityWait(page.getByRole('button', { name: 'startをクリア' }))
  await expect(page.getByRole('combobox', { name: 'start' })).toContainText('start')
  await selectMuiOption({ page, name: 'range', value: '3' })
  await clickWithoutPointerStabilityWait(page.getByRole('button', { name: 'rangeをクリア' }))
  await expect(page.getByRole('combobox', { name: 'range' })).toContainText('range')

  await selectMuiOption({ page, name: 'start', value: '10' })
  await selectMuiOption({ page, name: 'range', value: '3' })
  await clickWithoutPointerStabilityWait(
    page.getByTestId('search-rule-page').getByRole('button', { name: '検索' }),
  )
  await expect(page.getByText('1 件ヒット')).toBeVisible()
  expect(
    requestLog.bodies.find(
      (body) => typeof body === 'object' && body !== null && Object.hasOwn(body, 'option'),
    ),
  ).toMatchObject({
    option: {
      channelIds: [4101, 4102],
      times: [{ start: 10, range: 3 }],
    },
  })
})

test('keeps ui-problem6 Rule option spacing and clear controls exhaustive in a real browser', async ({
  page,
}) => {
  await installSearchRuleWorkflowApiMocks(page)

  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/#/search')
  await expect(page.getByRole('heading', { name: '検索' })).toBeVisible()

  await toggleChannelOption(page, '4101')
  await page.getByRole('listbox').press('Escape')
  await page.getByRole('button', { name: 'channelIdをクリア', exact: true }).click()
  await expect(page.locator('[data-channel-select-wrapper] [role="combobox"]')).toContainText(
    'channel',
  )

  await selectMuiOption({ page, name: 'start', value: '10' })
  await page.getByRole('button', { name: 'startをクリア', exact: true }).click()
  await expect(muiSelectInput(page, 'start')).toHaveValue('')

  await selectMuiOption({ page, name: 'range', value: '3' })
  await page.getByRole('button', { name: 'rangeをクリア', exact: true }).click()
  await expect(muiSelectInput(page, 'range')).toHaveValue('')

  await page.getByRole('switch', { name: '時刻指定' }).click()
  await expectTextClear(page, '終了', '23:30')
  await page.getByRole('switch', { name: '時刻指定' }).click()

  await page.getByLabel('keyword', { exact: true }).fill('Synthetic')
  await page.getByTestId('search-rule-page').getByRole('button', { name: '検索' }).click()
  await expect(page.getByText('1 件ヒット')).toBeVisible()
  await expect(page.locator('form[class*="ruleOptionCard"]')).toBeVisible()

  await clickWithoutPointerStabilityWait(page.locator('summary[data-title="エンコード2"]'))
  await expect(muiSelectCombobox(page, 'mode2')).toBeVisible()
  await clickWithoutPointerStabilityWait(page.locator('summary[data-title="エンコード3"]'))
  await expect(muiSelectCombobox(page, 'mode3')).toBeVisible()

  await expectRuleOptionFieldGaps(page, [
    'sub directory',
    'directory1',
    'sub directory1',
    'directory2',
    'sub directory2',
    'directory3',
    'sub directory3',
  ])

  await expectTextClear(page, '日数', '7')
  await expectSelectClear(page, 'directory', 'archive-root')
  await expectTextClear(page, 'sub directory', 'synthetic/sub')
  await expectTextClear(page, 'file format', 'synthetic-format')
  await page.getByRole('combobox', { name: 'mode1', exact: true }).click()
  await expect(page.getByRole('listbox')).toBeVisible()
  await expect(page.getByRole('option', { name: 'mode1', exact: true })).toHaveCount(0)
  await page.getByRole('listbox').press('Escape')
  await expectSelectClear(page, 'mode1', 'synthetic-encode-main')
  await page.getByRole('combobox', { name: 'directory1', exact: true }).click()
  await expect(page.getByRole('listbox')).toBeVisible()
  await expect(page.getByRole('option', { name: 'directory1', exact: true })).toHaveCount(0)
  await page.getByRole('listbox').press('Escape')
  await expectSelectClear(page, 'directory1', 'archive-root')
  await expectTextClear(page, 'sub directory1', 'synthetic/sub1')
  await expectSelectClear(page, 'directory2', 'backup-root')
  await expectTextClear(page, 'sub directory2', 'synthetic/sub2')
  await expectSelectClear(page, 'mode2', 'synthetic-encode-sub')
  await expectSelectClear(page, 'directory3', 'archive-root')
  await expectTextClear(page, 'sub directory3', 'synthetic/sub3')
  await expectSelectClear(page, 'mode3', 'synthetic-encode-main')
})
