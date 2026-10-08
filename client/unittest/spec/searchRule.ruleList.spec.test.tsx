import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'
import {
  SyntheticRealtimeConnection,
  createShellRepository,
  createSearchRuleRepository,
} from './searchRuleSupport'

describe('Rule list route lifecycle', () => {
  it('[AC 3.25] paints selected rule rows as filled edit-mode rows instead of outline-only rows', () => {
    const css = readFileSync('src/features/search/rule/SearchRulePage.module.css', 'utf8')

    expect(css).toContain(".ruleItem[data-selected='true']")
    expect(css).toContain('background: #4285f4;')
    expect(css).toContain('color: #fff;')
    expect(css).not.toContain("ruleItem[data-selected='true'] {\n  outline:")
  })

  it('[AC 3.26][AC 4.3] keeps the rule table responsive and card count/menu visible in dark mode', () => {
    const css = readFileSync('src/features/search/rule/SearchRulePage.module.css', 'utf8')

    expect(css).toMatch(/\.ruleList\s*\{[^}]*max-width:\s*100%;/s)
    expect(css).not.toContain('max-width: 1160px;')
    expect(css).toMatch(/\.ruleItemMain > span:nth-child\(5\)\s*\{[^}]*currentColor/s)
    expect(css).not.toMatch(/\.ruleActions button:last-child \.ruleActionIcon\s*\{[^}]*color:/s)
    expect(css).not.toMatch(
      /:global\(\[data-theme-mode='dark'\]\) \.ruleActions button:last-child \.ruleActionIcon/s,
    )
    // The table/list switch is driven by the measured list container width (`data-rule-layout`,
    // set from `resolveRuleLayout`/`useMeasuredContainerWidth` in RuleListPage.tsx), not a
    // viewport `@media` query, so the `.ruleHeader`/`.ruleItem`/`.ruleActions` list-mode rules
    // live under a `.page[data-rule-layout='list']` attribute selector instead. The `755px`
    // search-form media query still exists for unrelated fields (`.searchCard`, `.searchRow`,
    // `.rulePanel`, ...); it does not carry the rule list rules. There is no `794px` media query (it would
    // duplicate the exact same rule list declarations at a second, different viewport width).
    const mediaQuery755 = css.match(/@media \(max-width: 755px\) \{([\s\S]*?)\n\}\n/)
    expect(mediaQuery755).not.toBeNull()
    expect(mediaQuery755?.[1]).not.toContain('.ruleHeader')
    expect(mediaQuery755?.[1]).not.toContain('.ruleActions')
    expect(css).not.toContain('@media (max-width: 794px)')
    expect(css).toContain(".page[data-rule-layout='list'] .ruleHeader")
    expect(css).toMatch(/\.page\[data-rule-layout='list'\] \.ruleHeader\s*\{[^}]*display:\s*none;/s)
  })

  it('[AC 3.34] list layout row selection hit-area is a real box spanning the keyword and reservesCnt columns, not display:contents', () => {
    const css = readFileSync('src/features/search/rule/SearchRulePage.module.css', 'utf8')

    const listRuleItemMain = css.match(
      /\.page\[data-rule-layout='list'\] \.ruleItemMain\s*\{([^}]*)\}/s,
    )
    expect(listRuleItemMain).not.toBeNull()
    const body = listRuleItemMain?.[1] ?? ''
    expect(body).not.toMatch(/display:\s*contents/)
    expect(body).toMatch(/display:\s*flex/)
    expect(body).toMatch(/align-self:\s*stretch/)
    // Spans columns 2 and 3 only -- never column 1 (`.ruleSwitchButton`) or column 4
    // (`.ruleActions`), so the row hit-area cannot overlap either (要求3 AC33/AC34).
    expect(body).toMatch(/grid-column:\s*2\s*\/\s*4/)
    expect(css).toMatch(
      /\.page\[data-rule-layout='list'\] \.ruleSwitchButton\s*\{[^}]*grid-column:\s*1;/s,
    )
    expect(css).toMatch(
      /\.page\[data-rule-layout='list'\] \.ruleActions button\s*\{[^}]*grid-column:\s*4;/s,
    )
  })

  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('[AC 3.30][AC 2.32][AC 2.35][AC 3.6][AC 3.11][AC 3.12] keeps the rule enable switch animated', () => {
    const css = readFileSync('src/features/search/rule/SearchRulePage.module.css', 'utf8')
    const source = readFileSync('src/features/search/rule/RuleListPage.tsx', 'utf8')
    const titleBarSource = readFileSync(
      'src/features/search/rule/components/RuleListTitleBar.tsx',
      'utf8',
    )
    const searchMenuSource = readFileSync(
      'src/features/search/rule/components/RuleSearchMenu.tsx',
      'utf8',
    )
    const itemMenuSource = readFileSync(
      'src/features/search/rule/components/RuleItemMenu.tsx',
      'utf8',
    )

    expect(css).toContain('transition: background-color 300ms ease;')
    expect(css).toContain('left 300ms ease')
    expect(css).not.toContain('.searchCard::after')
    expect(css).toContain('border-top: 1px solid rgba(0, 0, 0, 0.12);')
    expect(css).toContain('grid-template-columns: repeat(2, minmax(0, 100px));')
    expect(css).toContain(".ruleOptionField[data-width='period']")
    expect(css).toContain('max-width: 90px;')
    expect(css).toContain(".ruleOptionField[data-width='directory']")
    expect(css).toContain('max-width: 150px;')
    expect(searchMenuSource).toContain('function RuleSearchMenu')
    expect(titleBarSource).toContain('onClick={(event) => onOpenSearch(event.currentTarget)}')
    expect(source).toContain('onOpenSearch={setSearchAnchor}')
    expect(source).toContain('setTimeout(() =>')
    expect(source).toContain('}, 300)')
    expect(itemMenuSource).toContain('navigate(`/recorded?ruleId=${target.id}`)')
    expect(itemMenuSource).toContain('navigate(`/search?rule=${target.id}`)')
  })

  it('[AC 3.2][AC 3.22][AC 3.26] fetches /rule from route query and renders list actions without an empty message', async () => {
    window.history.replaceState(null, '', '/#/rule?keyword=Synthetic&page=2')
    const searchRuleRepository = createSearchRuleRepository()

    render(
      <App
        settings={{
          ...new DefaultSettingsFactory().create(),
          rulesLength: 25,
          isHalfWidthDisplayed: false,
        }}
        apiRepository={createShellRepository()}
        searchRuleApiRepository={searchRuleRepository}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    expect(await screen.findByRole('heading', { name: 'ルール' })).toBeVisible()
    await waitFor(() => {
      expect(searchRuleRepository.fetchRules).toHaveBeenCalledWith({
        type: 'normal',
        offset: 25,
        limit: 25,
        isHalfWidth: false,
        keyword: 'Synthetic',
      })
    })
    expect(screen.getByText('Synthetic Rule Keyword')).toBeVisible()
    expect(screen.getByText('Synthetic Ignore')).toBeVisible()
    expect(screen.getByText('101 他1')).toBeVisible()
    expect(screen.getByText('その他')).toBeVisible()
    expect(screen.getByText('4')).toBeVisible()
    expect(screen.getAllByText('-').length).toBeGreaterThan(0)
  })

  it('[AC 3.9][AC 3.13][AC 3.14][AC 3.15][AC 3.16][AC 3.17][AC 3.19][AC 3.24] runs rule item enable, navigation, single delete, and bulk edit workflows', async () => {
    window.history.replaceState(null, '', '/#/rule')
    const searchRuleRepository = createSearchRuleRepository()

    render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        searchRuleApiRepository={searchRuleRepository}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    const firstRule = await screen.findByTestId('rule-item-901')
    // The action snackbar closes on a 5 second wall-clock timer. Read it under fake timers
    // instead of polling, so the assertion never races the host.
    vi.useFakeTimers()
    fireEvent.click(within(firstRule).getByRole('button', { name: '無効化' }))
    expect(searchRuleRepository.disableRule).toHaveBeenCalledWith(901)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.getByText('無効化: Synthetic Rule Keyword')).toBeVisible()
    vi.useRealTimers()

    fireEvent.click(
      within(await screen.findByTestId('rule-item-901')).getByRole('button', {
        name: /ルールメニュー:/,
      }),
    )
    fireEvent.click(await screen.findByRole('menuitem', { name: 'delete' }))
    expect(await screen.findByRole('dialog', { name: 'ルール削除' })).toHaveTextContent(
      'Synthetic Rule Keyword を削除しますか?',
    )
    vi.useFakeTimers()
    fireEvent.click(screen.getByRole('button', { name: '削除' }))
    expect(searchRuleRepository.deleteRule).toHaveBeenCalledWith(901)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.getByText('Synthetic Rule Keyword を削除')).toBeVisible()
    expect(screen.getByText('Synthetic Rule Keyword')).toBeVisible()
    vi.useRealTimers()

    fireEvent.click(screen.getByRole('button', { name: 'ルールを編集' }))
    expect(await screen.findByRole('heading', { name: '0 件選択' })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'すべて選択' }))
    expect(await screen.findByRole('heading', { name: '2 件選択' })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: '選択項目を削除' }))
    const bulkDialog = await screen.findByRole('dialog', { name: 'ルール削除' })
    expect(bulkDialog).toHaveTextContent('選択した 2 件のルールを削除しますか。')
    fireEvent.click(screen.getByRole('button', { name: '削除' }))
    await waitFor(() => {
      expect(searchRuleRepository.deleteRule).toHaveBeenCalledWith(902)
    })
    vi.useFakeTimers()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.getByText('選択したルールを削除しました。')).toBeVisible()
    vi.useRealTimers()
  })

  it('[AC 3.25] drops a selected rule id once a non-route refetch removes it from the visible rows', async () => {
    window.history.replaceState(null, '', '/#/rule')
    const searchRuleRepository = createSearchRuleRepository()
    const connection = new SyntheticRealtimeConnection()

    render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        searchRuleApiRepository={searchRuleRepository}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
        realtimeConnectionFactory={() => connection}
      />,
    )

    expect(await screen.findByTestId('rule-item-902')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'ルールを編集' }))
    expect(await screen.findByRole('heading', { name: '0 件選択' })).toBeVisible()
    fireEvent.click(within(screen.getByTestId('rule-item-902')).getByRole('button'))
    expect(await screen.findByRole('heading', { name: '1 件選択' })).toBeVisible()

    // A Socket.IO driven refetch (no route change) now resolves without rule 902.
    vi.mocked(searchRuleRepository.fetchRules).mockResolvedValueOnce({
      ok: true,
      value: {
        rules: [
          {
            id: 901,
            searchOption: {
              keyword: 'Synthetic Rule Keyword',
              ignoreKeyword: 'Synthetic Ignore',
              channelIds: [101, 102],
              genres: [{ genre: 7, subGenre: 3 }],
              times: [{ week: 0x7f }],
            },
            reserveOption: {
              enable: true,
              allowEndLack: true,
              avoidDuplicate: false,
              periodToAvoidDuplicate: null,
            },
            reservesCnt: 4,
          },
        ],
        total: 1,
      },
    })
    connection.emit('updateStatus')
    await waitFor(() => expect(screen.queryByTestId('rule-item-902')).not.toBeInTheDocument())

    expect(await screen.findByRole('heading', { name: '0 件選択' })).toBeVisible()
  })
})
