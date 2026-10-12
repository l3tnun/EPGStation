import { expect, test, type Locator } from '@playwright/test'
import { installAppShellApiMocks } from './support/appShellMocks'
import { expectShellMainOffset } from './support/searchRuleHelpers'
import { installSearchRuleWorkflowApiMocks } from './support/searchRuleMocks'

// viewport を変えた直後は、clientWidth が新しい値を返していても要素の幅が前の layout の
// ままのことがある。実測では 794 px の viewport に対し list が 936 px を返し、500 ms 後に
// 770 px へ落ち着いた。連続する 2 回の測定が一致するまで読み直し、落ち着いた値だけを使う。
async function readSettledGeometry(locator: Locator): Promise<RuleGeometry> {
  const read = () =>
    locator.evaluate((node) => {
      const rect = node.getBoundingClientRect()

      return {
        listRight: Math.round(rect.right),
        listWidth: Math.round(rect.width),
        scrollWidth: document.documentElement.scrollWidth,
        viewportWidth: document.documentElement.clientWidth,
      }
    })

  let previous = await read()
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await locator.page().waitForTimeout(50)
    const current = await read()
    if (
      current.listRight === previous.listRight &&
      current.listWidth === previous.listWidth &&
      current.scrollWidth === previous.scrollWidth &&
      current.viewportWidth === previous.viewportWidth
    ) {
      return current
    }

    previous = current
  }

  return previous
}

interface RuleGeometry {
  listRight: number
  listWidth: number
  scrollWidth: number
  viewportWidth: number
}

test.beforeEach(async ({ page }) => {
  await installAppShellApiMocks(page, { enableBroadcastWaveNavigation: true })
})

test('keeps Search result cards and Rule list width responsive', async ({ page }) => {
  await installSearchRuleWorkflowApiMocks(page)

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/#/search?keyword=Synthetic')
  await expect(page.getByRole('heading', { name: '検索' })).toBeVisible()
  await expect(page.getByText('1 件ヒット')).toBeVisible()

  const searchPage = page.getByTestId('search-rule-page')
  const searchForm = page.getByRole('region', { name: '検索条件' })
  const resultRegion = page.getByRole('region', { name: '検索結果' })
  const resultCard = resultRegion.getByRole('button', { name: 'Synthetic Search Program Alpha' })
  const ruleOptionCard = page.locator('form[class*="ruleOptionCard"]').first()

  const readSearchGeometry = async () =>
    searchPage.evaluate((root) => {
      const rect = (selector: string) => {
        const element = root.querySelector<HTMLElement>(selector)
        if (element === null) {
          throw new Error(`missing geometry target: ${selector}`)
        }

        const bounds = element.getBoundingClientRect()

        return {
          left: Math.round(bounds.left),
          width: Math.round(bounds.width),
        }
      }

      return {
        form: rect('section[aria-label="検索条件"]'),
        result: rect('section[aria-label="検索結果"]'),
        resultCard: rect(
          'section[aria-label="検索結果"] button[aria-label="Synthetic Search Program Alpha"]',
        ),
        ruleOption: rect('form[class*="ruleOptionCard"]'),
      }
    })

  const searchGeometry = await readSearchGeometry()

  for (const [name, geometry] of Object.entries(searchGeometry)) {
    expect.soft(geometry.width, `${name} width keeps 800px source max`).toBeLessThanOrEqual(800)
    expect.soft(geometry.width, `${name} width remains content width`).toBeGreaterThan(760)
    expect.soft(geometry.left, `${name} is centered at desktop width`).toBeGreaterThan(300)
  }
  expect(searchGeometry.result.width).toBe(searchGeometry.form.width)
  expect(searchGeometry.resultCard.width).toBe(searchGeometry.form.width)
  expect(searchGeometry.ruleOption.width).toBe(searchGeometry.form.width)
  await expect(searchForm).toBeVisible()
  await expect(resultCard).toBeVisible()
  await expect(ruleOptionCard).toBeVisible()

  await page.setViewportSize({ width: 960, height: 900 })
  const middleSearchGeometry = await readSearchGeometry()
  for (const [name, geometry] of Object.entries(middleSearchGeometry)) {
    expect.soft(geometry.width, `${name} width keeps 800px max at 960px`).toBeLessThanOrEqual(800)
  }
  expect(middleSearchGeometry.result.width).toBe(middleSearchGeometry.form.width)
  expect(middleSearchGeometry.resultCard.width).toBe(middleSearchGeometry.form.width)
  expect(middleSearchGeometry.ruleOption.width).toBe(middleSearchGeometry.form.width)

  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/#/search?keyword=Synthetic')
  await expect(page.getByRole('heading', { name: '検索' })).toBeVisible()
  await expect(page.getByText('1 件ヒット')).toBeVisible()
  const mobileSearchGeometry = await readSearchGeometry()
  for (const [name, geometry] of Object.entries(mobileSearchGeometry)) {
    expect.soft(geometry.width, `${name} width fits mobile viewport`).toBeLessThanOrEqual(390)
  }
  expect(mobileSearchGeometry.result.width).toBe(mobileSearchGeometry.form.width)
  expect(mobileSearchGeometry.resultCard.width).toBe(mobileSearchGeometry.form.width)
  expect(mobileSearchGeometry.ruleOption.width).toBe(mobileSearchGeometry.form.width)

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/#/rule?keyword=Synthetic&page=2')
  await expect(page.getByRole('heading', { name: 'ルール' })).toBeVisible()
  await expect(page.getByText('Synthetic Rule Alpha')).toBeVisible()

  const ruleList = page.locator('[class*="ruleList"]').first()
  const ruleHeader = page.locator('[class*="ruleHeader"]').first()
  const firstRuleRowMain = page
    .getByTestId('rule-item-6201')
    .locator('button[class*="ruleItemMain"]')
  await expect(ruleList).toBeVisible()
  await expect(ruleHeader).toBeVisible()
  await expect(firstRuleRowMain).toBeVisible()
  await expect
    .soft(
      firstRuleRowMain.evaluate((node) => getComputedStyle(node).display),
      'Rule width regression is checked in table layout, not mobile card display',
    )
    .resolves.toBe('grid')
  const wideRuleListWidth = (await readSettledGeometry(ruleList)).listWidth

  await page.setViewportSize({ width: 960, height: 900 })
  await expectShellMainOffset(page, 0)
  await expect(ruleList).toBeVisible()
  await expect(ruleHeader).toBeVisible()
  await expect
    .soft(
      firstRuleRowMain.evaluate((node) => getComputedStyle(node).display),
      'Rule table layout remains active at 960px while measuring responsive width',
    )
    .resolves.toBe('grid')
  const narrowRuleListWidth = (await readSettledGeometry(ruleList)).listWidth

  await page.setViewportSize({ width: 780, height: 900 })
  await expectShellMainOffset(page, 0)
  await expect(ruleHeader).toBeVisible()
  await expect
    .soft(
      firstRuleRowMain.evaluate((node) => getComputedStyle(node).display),
      'Rule table layout remains active at the v2 measured 780px viewport parity point',
    )
    .resolves.toBe('grid')
  await expect(ruleList).toBeVisible()

  await page.setViewportSize({ width: 779, height: 900 })
  await expectShellMainOffset(page, 0)
  await expect(ruleHeader).toBeHidden()
  // list layout (`data-rule-layout='list'`, container width < 780px) の `.ruleItemMain` は
  // `display: flex` の実ボックスであり、`display: contents` ではない
  // (client/src/features/search/rule/SearchRulePage.module.css の `.ruleItemMain`)。
  // frontend-search-rule の要求 3.34 は、この行選択領域が switch 列と
  // action menu 列を除いた行全体を占める実ボックスであることを求めており、`display: contents` では
  // 要素自身のボックスが消え、keyword text 右側の余白などが hit-test 対象にならず要求を満たさない。
  await expect
    .soft(
      firstRuleRowMain.evaluate((node) => getComputedStyle(node).display),
      'Rule card layout starts below the v2 measured 780px viewport parity point',
    )
    .resolves.toBe('flex')
  const compactRuleGeometry = await readSettledGeometry(ruleList)

  expect(wideRuleListWidth).toBeGreaterThan(1000)
  expect(narrowRuleListWidth).toBeLessThan(wideRuleListWidth)
  expect(narrowRuleListWidth).toBeGreaterThan(0)
  expect(compactRuleGeometry.listWidth).toBeLessThanOrEqual(compactRuleGeometry.viewportWidth)
  expect(compactRuleGeometry.listRight).toBeLessThanOrEqual(compactRuleGeometry.viewportWidth)
  expect(compactRuleGeometry.scrollWidth).toBeLessThanOrEqual(compactRuleGeometry.viewportWidth + 1)
})

test('keeps Search result item typography at legacy size on mobile', async ({ page }) => {
  await installSearchRuleWorkflowApiMocks(page)
  await page.setViewportSize({ width: 390, height: 844 })

  await page.goto('/#/search?keyword=Synthetic')
  await expect(page.getByRole('heading', { name: '検索' })).toBeVisible()

  const resultCard = page
    .getByRole('region', { name: '検索結果' })
    .getByRole('button', { name: 'Synthetic Search Program Alpha' })
  await expect(resultCard).toBeVisible()

  const mobileResultTypography = await resultCard.evaluate((card) => {
    const title = card.querySelector<HTMLElement>('[data-search-result-text="title"]')
    const meta = card.querySelector<HTMLElement>('[data-search-result-text="meta"]')
    const description = card.querySelector<HTMLElement>('[data-search-result-text="description"]')

    if (title === null || meta === null || description === null) {
      throw new Error('Search result typography targets are missing')
    }

    const read = (element: HTMLElement) => {
      const style = getComputedStyle(element)

      return {
        fontSize: style.fontSize,
        fontWeight: style.fontWeight,
        lineHeight: style.lineHeight,
      }
    }

    return {
      description: read(description),
      meta: read(meta),
      title: read(title),
    }
  })

  expect(mobileResultTypography.title).toMatchObject({
    fontSize: '16px',
    fontWeight: '900',
    lineHeight: '28px',
  })
  expect(mobileResultTypography.meta.fontSize).toBe('14px')
  expect(mobileResultTypography.description).toMatchObject({
    fontSize: '14px',
    lineHeight: '20px',
  })
})

test('keeps Search result description readable in dark theme', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      'settings',
      JSON.stringify({
        shouldUseOSColorTheme: false,
        isForceDarkTheme: true,
      }),
    )
  })
  await installSearchRuleWorkflowApiMocks(page)
  await page.setViewportSize({ width: 390, height: 844 })

  await page.goto('/#/search?keyword=Synthetic')
  await expect(page.getByRole('heading', { name: '検索' })).toBeVisible()

  const descriptionColor = await page
    .getByRole('region', { name: '検索結果' })
    .getByRole('button', { name: 'Synthetic Search Program Alpha' })
    .locator('[data-search-result-text="description"]')
    .evaluate((node) => getComputedStyle(node).color)

  expect(descriptionColor).toBe('rgba(255, 255, 255, 0.7)')
})

test('keeps Rule add FAB icon white in dark theme', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      'settings',
      JSON.stringify({
        shouldUseOSColorTheme: false,
        isForceDarkTheme: true,
      }),
    )
  })
  await installSearchRuleWorkflowApiMocks(page)

  await page.goto('/#/rule?keyword=Synthetic')

  const fab = page.getByRole('button', { name: '追加' })
  await expect(fab).toBeVisible()
  const colors = await fab.evaluate((node) => {
    const fabStyle = getComputedStyle(node)
    const icon = node.querySelector('span')

    return {
      backgroundColor: fabStyle.backgroundColor,
      color: fabStyle.color,
      iconColor: icon === null ? '' : getComputedStyle(icon).color,
    }
  })

  expect(colors.backgroundColor).not.toBe('rgba(0, 0, 0, 0)')
  expect(colors.color).toBe('rgb(255, 255, 255)')
  expect(colors.iconColor).toBe('rgb(255, 255, 255)')
})
