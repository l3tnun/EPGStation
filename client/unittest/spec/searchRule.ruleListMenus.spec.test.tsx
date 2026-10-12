import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import { RuleItemMenu } from '@/features/search/rule/components/RuleItemMenu'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'
import {
  SyntheticRealtimeConnection,
  createShellRepository,
  createSearchRuleRepository,
} from './searchRuleSupport'

function renderRuleList(
  repository = createSearchRuleRepository(),
  rulesLength = 25,
  realtimeConnectionFactory?: () => SyntheticRealtimeConnection,
) {
  const view = render(
    <App
      settings={{ ...new DefaultSettingsFactory().create(), rulesLength }}
      apiRepository={createShellRepository()}
      searchRuleApiRepository={repository}
      osPrefersDark={false}
      viewportWidth={1440}
      initialDrawerState="none"
      {...(realtimeConnectionFactory === undefined ? {} : { realtimeConnectionFactory })}
    />,
  )
  return { ...view, repository }
}

describe('Rule list menus and edit mode', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('[AC 3.4][AC 3.5][AC 3.6] opens the rule search menu from the title bar, keeps the keyword, and navigates after the delay', async () => {
    window.history.replaceState(null, '', '/#/rule?keyword=Synthetic')
    const { unmount } = renderRuleList()
    expect(await screen.findByRole('heading', { name: 'ルール' })).toBeVisible()

    const openSearch = () =>
      fireEvent.click(within(screen.getByTestId('title-bar')).getByRole('button', { name: '検索' }))
    openSearch()
    const keyword = await screen.findByRole('textbox', { name: 'キーワード' })
    expect(keyword).toHaveValue('Synthetic')
    fireEvent.click(screen.getByRole('button', { name: '閉じる' }))
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'キーワード' })).toBeNull())

    openSearch()
    const again = await screen.findByRole('textbox', { name: 'キーワード' })
    fireEvent.change(again, { target: { value: 'Next' } })
    fireEvent.keyDown(again, { key: 'a' })

    // submitRuleSearch debounces the route navigation by 300ms (see RuleListPage.tsx).
    // waitFor/findBy* cannot see a faked clock, so read the outcome synchronously.
    vi.useFakeTimers()
    fireEvent.keyDown(again, { key: 'Enter' })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
    })
    vi.useRealTimers()
    expect(window.location.hash).toMatch(/^#\/rule\?keyword=Next/)

    await screen.findByTestId('title-bar')
    openSearch()
    const third = await screen.findByRole('textbox', { name: 'キーワード' })
    fireEvent.change(third, { target: { value: '' } })

    vi.useFakeTimers()
    fireEvent.click(
      within(screen.getByRole('menu', { name: 'ルール検索' })).getByRole('button', {
        name: '検索',
      }),
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
    })
    vi.useRealTimers()
    expect(window.location.hash).toMatch(/^#\/rule(\?timestamp=\d+)?$/)

    await screen.findByTestId('title-bar')
    openSearch()
    const fourth = await screen.findByRole('textbox', { name: 'キーワード' })
    fireEvent.change(fourth, { target: { value: 'Late' } })
    fireEvent.keyDown(fourth, { key: 'Enter' })
    // `RuleListPage` debounces the search navigation by 300 ms. Unmounting must cancel it, so let
    // that debounce come due on a clock this test advances and confirm nothing navigated.
    vi.useFakeTimers()
    unmount()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
    })

    expect(window.location.hash).not.toContain('Late')
    vi.useRealTimers()
  })

  it('[AC 3.11][AC 3.12] routes item menu actions to the recorded and search screens', async () => {
    window.history.replaceState(null, '', '/#/rule')
    renderRuleList()
    await screen.findByTestId('rule-item-901')
    fireEvent.click(screen.getByRole('button', { name: '追加' }))
    await waitFor(() => expect(window.location.hash).toMatch(/^#\/search(\?timestamp=\d+)?$/))

    window.location.hash = '#/rule'
    const row = await screen.findByTestId('rule-item-901')
    fireEvent.click(within(row).getByRole('button', { name: /ルールメニュー:/ }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'recorded' }))
    await waitFor(() => expect(window.location.hash).toMatch(/^#\/recorded\?ruleId=901/))
  })

  it('[AC 3.11] routes the item menu edit action and renders nothing when the menu is closed', async () => {
    const navigate = vi.fn()
    const { rerender } = render(
      <RuleItemMenu
        menuState={null}
        navigate={navigate}
        onClose={() => undefined}
        onDelete={() => undefined}
      />,
    )
    expect(screen.queryByRole('menuitem')).toBeNull()
    const anchor = document.createElement('button')
    document.body.append(anchor)
    const rule = {
      id: 5,
      searchOption: { times: [] },
      reserveOption: {
        enable: true,
        allowEndLack: true,
        avoidDuplicate: false,
        periodToAvoidDuplicate: null,
      },
    }
    rerender(
      <RuleItemMenu
        menuState={{ anchor, rule }}
        navigate={navigate}
        onClose={() => undefined}
        onDelete={() => undefined}
      />,
    )
    fireEvent.click(await screen.findByRole('menuitem', { name: 'edit' }))
    expect(navigate).toHaveBeenCalledWith('/search?rule=5')
    anchor.remove()
  })

  it('[AC 3.8][AC 3.10][AC 3.15] reports enable and delete failures without changing the list', async () => {
    window.history.replaceState(null, '', '/#/rule')
    const repository = createSearchRuleRepository()
    vi.mocked(repository.enableRule).mockResolvedValue({
      ok: false,
      error: 'rule-enable-failed',
      message: 'ルールの有効化に失敗',
    })
    vi.mocked(repository.deleteRule).mockResolvedValue({
      ok: false,
      error: 'rule-delete-failed',
      message: 'ルール削除に失敗',
    })
    renderRuleList(repository)

    const disabledRow = await screen.findByTestId('rule-item-902')
    // The action snackbar closes on a 5 second wall-clock timer. Read it under fake timers
    // instead of polling, so the assertion never races the host.
    vi.useFakeTimers()
    fireEvent.click(within(disabledRow).getByRole('button', { name: '有効化' }))
    expect(repository.enableRule).toHaveBeenCalledWith(902)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.getByText('ルールの有効化に失敗')).toBeVisible()
    vi.useRealTimers()
    expect(
      within(screen.getByTestId('rule-item-902')).getByRole('button', { name: '有効化' }),
    ).toBeVisible()

    fireEvent.click(
      within(screen.getByTestId('rule-item-901')).getByRole('button', { name: /ルールメニュー:/ }),
    )
    fireEvent.click(await screen.findByRole('menuitem', { name: 'delete' }))
    fireEvent.click(await screen.findByRole('button', { name: 'キャンセル' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    fireEvent.click(
      within(screen.getByTestId('rule-item-901')).getByRole('button', { name: /ルールメニュー:/ }),
    )
    fireEvent.click(await screen.findByRole('menuitem', { name: 'delete' }))
    const deleteButton = await screen.findByRole('button', { name: '削除' })
    vi.useFakeTimers()
    fireEvent.click(deleteButton)
    expect(repository.deleteRule).toHaveBeenCalledWith(901)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.getByText('Synthetic Rule Keyword を削除に失敗')).toBeVisible()
    vi.useRealTimers()
  })

  it('waits for the closing item menu animation before opening the delete confirmation dialog', async () => {
    // v2's `RuleItemMenu.vue` `openDeleteDialog()` closes the menu, then `await Util.sleep(300)`
    // before opening `RuleDeleteDialog` (76 行目). Measuring the actual MUI Menu close transition
    // confirmed it takes close to 300ms, and opening the confirmation dialog immediately (as a
    // 0ms delay does) visibly overlaps the closing menu with the newly opened dialog.
    window.history.replaceState(null, '', '/#/rule')
    renderRuleList()

    fireEvent.click(
      within(await screen.findByTestId('rule-item-901')).getByRole('button', {
        name: /ルールメニュー:/,
      }),
    )
    const deleteMenuItem = await screen.findByRole('menuitem', { name: 'delete' })

    vi.useFakeTimers()
    fireEvent.click(deleteMenuItem)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(299)
    })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(screen.getByRole('dialog')).toBeVisible()
    vi.useRealTimers()
  })

  it('cancels the pending delete-dialog open when the route changes before the 300ms delay elapses', async () => {
    // RuleListPage's route-change effect clears `deleteRuleOpenTimer` before resetting
    // interaction state (RuleListPage.tsx, 120-134 行目). Without that clear, a delete chosen
    // just before navigating away would still pop the confirmation dialog open on the new route.
    // `rulesLength` of 1 against the fixed 2-rule synthetic response gives a second page, so
    // clicking pagination is a real `location.search` change driven through a normal click
    // (unlike mutating `window.location.hash` directly, this stays inside RTL's `act()` wrapping
    // even while fake timers are active).
    window.history.replaceState(null, '', '/#/rule')
    renderRuleList(createSearchRuleRepository(), 1)

    fireEvent.click(
      within(await screen.findByTestId('rule-item-901')).getByRole('button', {
        name: /ルールメニュー:/,
      }),
    )
    const deleteMenuItem = await screen.findByRole('menuitem', { name: 'delete' })

    vi.useFakeTimers()
    fireEvent.click(deleteMenuItem)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(150)
    })

    fireEvent.click(screen.getByRole('button', { name: '次のページ' }))
    expect(window.location.hash).toContain('page=2')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
    })

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    vi.useRealTimers()
  })

  it('cancels the pending delete-dialog open on unmount before the 300ms delay elapses', async () => {
    // RuleListPage's unmount cleanup clears `deleteRuleOpenTimer` (RuleListPage.tsx, 135-145 行目)
    // so a delete chosen right before navigating away from the whole page never fires its
    // `setDeleteRule` after the component is gone. `vi.getTimerCount()` proves the timer is
    // actually removed from the queue by the cleanup, not merely left to fire into a void.
    window.history.replaceState(null, '', '/#/rule')
    const { unmount } = renderRuleList()

    fireEvent.click(
      within(await screen.findByTestId('rule-item-901')).getByRole('button', {
        name: /ルールメニュー:/,
      }),
    )
    const deleteMenuItem = await screen.findByRole('menuitem', { name: 'delete' })

    vi.useFakeTimers()
    fireEvent.click(deleteMenuItem)
    const timerCountWithPendingDelete = vi.getTimerCount()
    expect(timerCountWithPendingDelete).toBeGreaterThan(0)

    unmount()
    expect(vi.getTimerCount()).toBeLessThan(timerCountWithPendingDelete)

    // Advancing past the original delay must not throw or otherwise misbehave now that the timer
    // that would have run `setDeleteRule` on the unmounted tree has been cancelled.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
    })
    vi.useRealTimers()
  })

  it('opens the delete dialog for the second rule chosen when a delete is re-selected before the first dialog opens', async () => {
    // `openDeleteRuleAfterDelay` clears any still-pending timer before scheduling its own
    // (RuleListPage.tsx, 152-154 行目), so choosing delete on a second rule within the 300ms
    // window must show that second rule's confirmation, never the first's.
    window.history.replaceState(null, '', '/#/rule')
    renderRuleList()

    fireEvent.click(
      within(await screen.findByTestId('rule-item-901')).getByRole('button', {
        name: /ルールメニュー:/,
      }),
    )
    const firstDeleteMenuItem = await screen.findByRole('menuitem', { name: 'delete' })

    vi.useFakeTimers()
    fireEvent.click(firstDeleteMenuItem)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(150)
    })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    fireEvent.click(
      within(screen.getByTestId('rule-item-902')).getByRole('button', {
        name: /ルールメニュー:/,
      }),
    )
    const secondDeleteMenuItem = screen.getByRole('menuitem', { name: 'delete' })
    fireEvent.click(secondDeleteMenuItem)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
    })

    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent('- を削除しますか?')
    expect(dialog).not.toHaveTextContent('Synthetic Rule Keyword を削除しますか?')
    vi.useRealTimers()
  })

  it('[AC 3.7][AC 3.16] hides the enable/disable switch once a row is in edit mode', async () => {
    window.history.replaceState(null, '', '/#/rule')
    renderRuleList()

    const row = await screen.findByTestId('rule-item-901')
    expect(within(row).getByRole('button', { name: /^(有効化|無効化)$/ })).toBeVisible()

    fireEvent.click(screen.getByRole('button', { name: 'ルールを編集' }))
    expect(await screen.findByRole('heading', { name: '0 件選択' })).toBeVisible()
    expect(
      within(screen.getByTestId('rule-item-901')).queryByRole('button', {
        name: /^(有効化|無効化)$/,
      }),
    ).not.toBeInTheDocument()
  })

  it('[AC 3.16][AC 3.18][AC 3.19] toggles selections in edit mode, rejects empty bulk delete, and reports partial failures', async () => {
    window.history.replaceState(null, '', '/#/rule')
    const repository = createSearchRuleRepository()
    vi.mocked(repository.deleteRule).mockImplementation(async (ruleId: number) =>
      ruleId === 901
        ? { ok: true, value: undefined }
        : { ok: false, error: 'rule-delete-failed', message: 'x' },
    )
    renderRuleList(repository)

    const row = await screen.findByTestId('rule-item-901')
    fireEvent.click(within(row).getByText('Synthetic Rule Keyword'))
    expect(row).toHaveAttribute('data-selected', 'false')

    fireEvent.click(screen.getByRole('button', { name: 'ルールを編集' }))
    expect(await screen.findByRole('heading', { name: '0 件選択' })).toBeVisible()
    // The validation snackbar closes on a 5 second wall-clock timer. Read it under fake timers
    // instead of polling, so the assertion never races the host.
    vi.useFakeTimers()
    fireEvent.click(screen.getByRole('button', { name: '選択項目を削除' }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.getByText('ルールを選択してください。')).toBeVisible()
    vi.useRealTimers()

    fireEvent.click(within(screen.getByTestId('rule-item-901')).getByText('Synthetic Rule Keyword'))
    expect(await screen.findByRole('heading', { name: '1 件選択' })).toBeVisible()
    fireEvent.click(within(screen.getByTestId('rule-item-901')).getByText('Synthetic Rule Keyword'))
    expect(await screen.findByRole('heading', { name: '0 件選択' })).toBeVisible()

    fireEvent.click(screen.getByRole('button', { name: 'すべて選択' }))
    expect(await screen.findByRole('heading', { name: '2 件選択' })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'すべて選択' }))
    expect(await screen.findByRole('heading', { name: '0 件選択' })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'すべて選択' }))
    fireEvent.click(screen.getByRole('button', { name: '選択項目を削除' }))
    fireEvent.click(await screen.findByRole('button', { name: 'キャンセル' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    fireEvent.click(screen.getByRole('button', { name: '選択項目を削除' }))
    const bulkDeleteButton = await screen.findByRole('button', { name: '削除' })
    vi.useFakeTimers()
    fireEvent.click(bulkDeleteButton)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.getByText('一部ルールの削除に失敗しました。')).toBeVisible()
    vi.useRealTimers()

    fireEvent.click(screen.getByRole('button', { name: 'ルールを編集' }))
    expect(await screen.findByRole('heading', { name: '0 件選択' })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: '編集を終了' }))
    expect(await screen.findByRole('heading', { name: 'ルール' })).toBeVisible()
  })

  it('[AC 3.3][AC 3.22] shows the fetch failure text and pages through the list', async () => {
    window.history.replaceState(null, '', '/#/rule')
    const repository = createSearchRuleRepository()
    vi.mocked(repository.fetchRules).mockResolvedValueOnce({
      ok: false,
      error: 'rules-fetch-failed',
      message: 'ルールデータ取得に失敗',
    })
    renderRuleList(repository, 1)
    expect(await screen.findByText('ルールデータ取得に失敗')).toBeVisible()

    window.history.replaceState(null, '', '/#/rule?page=1')
    fireEvent.click(await screen.findByRole('button', { name: '追加' }))
    await waitFor(() => expect(window.location.hash).toMatch(/^#\/search(\?timestamp=\d+)?$/))
    window.history.back()
    expect(await screen.findByTestId('rule-item-901')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: '次のページ' }))
    await waitFor(() => expect(window.location.hash).toContain('page=2'))
  })

  it('[AC 3.3] reports the rule list fetch failure through the shared snackbar, not inline page text', async () => {
    window.history.replaceState(null, '', '/#/rule')
    const repository = createSearchRuleRepository()
    vi.mocked(repository.fetchRules).mockResolvedValueOnce({
      ok: false,
      error: 'rules-fetch-failed',
      message: 'ルールデータ取得に失敗',
    })
    renderRuleList(repository, 1)
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('ルールデータ取得に失敗')
  })

  it('[AC 3.25] drops a selected rule id once a non-route refetch removes it from the visible rows', async () => {
    window.history.replaceState(null, '', '/#/rule')
    const repository = createSearchRuleRepository()
    const connection = new SyntheticRealtimeConnection()
    renderRuleList(repository, 25, () => connection)

    expect(await screen.findByTestId('rule-item-902')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'ルールを編集' }))
    expect(await screen.findByRole('heading', { name: '0 件選択' })).toBeVisible()
    fireEvent.click(within(screen.getByTestId('rule-item-902')).getByRole('button'))
    expect(await screen.findByRole('heading', { name: '1 件選択' })).toBeVisible()

    // A Socket.IO driven refetch (no route change) now resolves without rule 902.
    vi.mocked(repository.fetchRules).mockResolvedValueOnce({
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

  it('[AC 3.25] keeps a selected rule id that is still visible after a non-route refetch drops a different id', async () => {
    // The companion case to the test above: when a background refetch's rule set changes but a
    // selected id is still among the visible rows, that id's entry must be copied into the new
    // selection set (RuleListPage.tsx 109-111 行目), not merely left out of the drop count.
    window.history.replaceState(null, '', '/#/rule')
    const repository = createSearchRuleRepository()
    const connection = new SyntheticRealtimeConnection()
    renderRuleList(repository, 25, () => connection)

    expect(await screen.findByTestId('rule-item-902')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'ルールを編集' }))
    expect(await screen.findByRole('heading', { name: '0 件選択' })).toBeVisible()
    fireEvent.click(within(screen.getByTestId('rule-item-901')).getByRole('button'))
    fireEvent.click(within(screen.getByTestId('rule-item-902')).getByRole('button'))
    expect(await screen.findByRole('heading', { name: '2 件選択' })).toBeVisible()

    // A Socket.IO driven refetch (no route change) now resolves with only rule 901, dropping 902.
    vi.mocked(repository.fetchRules).mockResolvedValueOnce({
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

    // Rule 901's selection survives the refetch: only the dropped id (902) is removed.
    expect(await screen.findByRole('heading', { name: '1 件選択' })).toBeVisible()
    expect(screen.getByTestId('rule-item-901')).toHaveAttribute('data-selected', 'true')

    // A further refetch that drops nothing (rule 901 stays the only visible row) must leave the
    // selection exactly as-is (the `didDropId` false side of RuleListPage.tsx 117 行目), not just
    // the case above where something was actually removed. `reservesCnt` differs from the
    // previous response so react-query's structural sharing does not keep the identical `data`
    // reference (which would skip re-running the `rules`-dependent effect entirely) - the rule id
    // set is unchanged, only an unrelated field differs.
    vi.mocked(repository.fetchRules).mockResolvedValueOnce({
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
            reservesCnt: 5,
          },
        ],
        total: 1,
      },
    })
    connection.emit('updateStatus')
    await waitFor(() =>
      expect(within(screen.getByTestId('rule-item-901')).getByText('5')).toBeInTheDocument(),
    )

    expect(await screen.findByRole('heading', { name: '1 件選択' })).toBeVisible()
    expect(screen.getByTestId('rule-item-901')).toHaveAttribute('data-selected', 'true')
  })
})
