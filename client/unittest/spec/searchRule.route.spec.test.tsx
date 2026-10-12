import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'
import {
  SyntheticRealtimeConnection,
  createShellRepository,
  expectMuiSelectText,
  createSearchRuleRepository,
} from './searchRuleSupport'

describe('Search route lifecycle', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    document.documentElement.classList.remove('fix-address-bar2')
  })

  it('[AC 2.38] lets a plain /search navigation switch to the time-specified rule form', async () => {
    window.history.replaceState(null, '', '/#/search')
    const searchRuleRepository = createSearchRuleRepository()

    render(
      <App
        settings={{
          ...new DefaultSettingsFactory().create(),
          isEnableCopyKeywordToDirectory: true,
        }}
        apiRepository={createShellRepository()}
        searchRuleApiRepository={searchRuleRepository}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    expect(await screen.findByRole('heading', { name: '検索' })).toBeVisible()
    const conditionRegion = screen.getByRole('region', { name: '検索条件' })
    expect(within(conditionRegion).getByLabelText('keyword')).toBeVisible()
    const timeSwitch = within(conditionRegion).getByRole('switch', { name: '時刻指定' })
    expect(timeSwitch).toHaveAttribute('aria-checked', 'false')

    fireEvent.click(timeSwitch)

    await waitFor(() => {
      expect(timeSwitch).toHaveAttribute('aria-checked', 'true')
    })
    expect(within(conditionRegion).getByLabelText('番組名 keyword')).toBeVisible()
    expect(
      within(conditionRegion).getByRole('combobox', { name: '時刻指定 channel' }),
    ).toBeVisible()
    expect(within(conditionRegion).getByLabelText('開始')).toBeVisible()
    expect(within(conditionRegion).getByLabelText('終了')).toBeVisible()
    expect(screen.getByRole('region', { name: '時刻指定予約設定' })).toBeVisible()
    expect(
      within(conditionRegion).queryByRole('textbox', { name: /^keyword$/ }),
    ).not.toBeInTheDocument()
    expect(searchRuleRepository.searchSchedules).not.toHaveBeenCalled()
  })

  it('[AC 1.3][AC 1.5] renders plain /search without firing a default search or Socket.IO refetch before user action', async () => {
    window.history.replaceState(null, '', '/#/search')
    const connection = new SyntheticRealtimeConnection()
    const searchRuleRepository = createSearchRuleRepository()
    vi.mocked(searchRuleRepository.searchSchedules).mockResolvedValueOnce({
      ok: true as const,
      value: [
        {
          id: 1001,
          name: 'Synthetic Program One',
          channelId: 12,
          channelName: 'Synthetic Channel',
          startAt: 1_700_000_000_000,
          endAt: 1_700_003_600_000,
          description: 'Synthetic description',
          isFree: true,
        },
      ],
    })
    vi.mocked(searchRuleRepository.searchSchedules).mockResolvedValueOnce({
      ok: true as const,
      value: [
        {
          id: 1002,
          name: 'Synthetic Program Two',
          channelId: 13,
          channelName: 'Synthetic Channel',
        },
      ],
    })
    vi.mocked(searchRuleRepository.searchSchedules).mockResolvedValueOnce({
      ok: false as const,
      error: 'search-failed' as const,
      message: '検索に失敗',
    })

    render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        searchRuleApiRepository={searchRuleRepository}
        realtimeConnectionFactory={() => connection}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    expect(await screen.findByRole('heading', { name: '検索' })).toBeVisible()
    expect(screen.queryByText('検索条件を入力してください')).not.toBeInTheDocument()
    await waitFor(() => {
      expect(searchRuleRepository.searchSchedules).not.toHaveBeenCalled()
    })

    await act(async () => {
      connection.emit('updateStatus')
    })
    expect(searchRuleRepository.searchSchedules).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText('keyword'), { target: { value: 'Synthetic' } })
    fireEvent.click(
      within(screen.getByRole('region', { name: '検索条件' })).getByRole('button', {
        name: '検索',
      }),
    )

    expect(await screen.findByText('1 件ヒット')).toBeVisible()
    expect(searchRuleRepository.searchSchedules).toHaveBeenCalledTimes(1)
    expect(searchRuleRepository.searchSchedules).toHaveBeenLastCalledWith(
      expect.objectContaining({
        option: expect.objectContaining({
          keyword: 'Synthetic',
          name: true,
          description: true,
          extended: false,
        }),
      }),
    )

    fireEvent.change(screen.getByLabelText('keyword'), { target: { value: 'Changed' } })
    await waitFor(() => {
      expect(searchRuleRepository.searchSchedules).toHaveBeenCalledTimes(1)
    })
    fireEvent.click(
      within(screen.getByRole('region', { name: '検索条件' })).getByRole('button', {
        name: '検索',
      }),
    )
    await waitFor(() => {
      expect(searchRuleRepository.searchSchedules).toHaveBeenCalledTimes(2)
    })
    expect(searchRuleRepository.searchSchedules).toHaveBeenLastCalledWith(
      expect.objectContaining({
        option: expect.objectContaining({
          keyword: 'Changed',
          name: true,
          description: true,
          extended: false,
        }),
      }),
    )
    expect(await screen.findByText('Synthetic Program Two')).toBeVisible()
  })

  it('[AC 2.10] reports a Socket.IO refetch failure after a successful search', async () => {
    window.history.replaceState(null, '', '/#/search')
    const connection = new SyntheticRealtimeConnection()
    const searchRuleRepository = createSearchRuleRepository()
    vi.mocked(searchRuleRepository.searchSchedules).mockResolvedValueOnce({
      ok: true as const,
      value: [
        {
          id: 1001,
          name: 'Synthetic Program One',
          channelId: 12,
          channelName: 'Synthetic Channel',
          startAt: 1_700_000_000_000,
          endAt: 1_700_003_600_000,
          description: 'Synthetic description',
          isFree: true,
        },
      ],
    })
    vi.mocked(searchRuleRepository.searchSchedules).mockResolvedValueOnce({
      ok: false as const,
      error: 'search-failed' as const,
      message: '検索に失敗',
    })

    render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        searchRuleApiRepository={searchRuleRepository}
        realtimeConnectionFactory={() => connection}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    expect(await screen.findByRole('heading', { name: '検索' })).toBeVisible()
    fireEvent.change(screen.getByLabelText('keyword'), { target: { value: 'Synthetic' } })
    fireEvent.click(
      within(screen.getByRole('region', { name: '検索条件' })).getByRole('button', {
        name: '検索',
      }),
    )
    expect(await screen.findByText('1 件ヒット')).toBeVisible()

    // The successful search defers a scroll attempt through two nested animation frames, and its
    // failure in jsdom opens its own snackbar. The host shows one snackbar at a time, so drain that
    // deferred attempt before driving the refetch. Fake timers then keep the 5 second auto-hide
    // from closing the snackbar this test observes.
    vi.useFakeTimers()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50)
    })

    act(() => {
      connection.emit('updateStatus')
    })

    const hasRefreshFailure = (): boolean =>
      screen
        .queryAllByRole('alert')
        .some((node) => node.textContent?.includes('検索情報更新に失敗') === true)
    // Advance by zero: the auto-hide never comes due while each iteration still yields a real turn
    // for the refetch and the effect that opens the snackbar.
    for (let step = 0; step < 200 && !hasRefreshFailure(); step += 1) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
    }

    expect(hasRefreshFailure()).toBe(true)
    expect(searchRuleRepository.searchSchedules).toHaveBeenCalledTimes(2)
  })

  it('[AC 1.4][AC 1.10] auto-searches query-backed /search and sends settings-backed request body', async () => {
    window.history.replaceState(null, '', '/#/search?keyword=Synthetic&channelId=12&genre=7')
    const settings = {
      ...new DefaultSettingsFactory().create(),
      isHalfWidthDisplayed: false,
      searchLength: 125,
    }
    const searchRuleRepository = createSearchRuleRepository()

    render(
      <App
        settings={settings}
        apiRepository={createShellRepository()}
        searchRuleApiRepository={searchRuleRepository}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    expect(await screen.findByText('1 件ヒット')).toBeVisible()
    expect(screen.getByLabelText('keyword')).toHaveValue('Synthetic')
    const conditionRegion = screen.getByRole('region', { name: '検索条件' })
    expect(within(conditionRegion).getAllByLabelText('名前')[0]).toBeChecked()
    expect(within(conditionRegion).getAllByLabelText('概要')[0]).toBeChecked()
    expectMuiSelectText('channelId', 'Synthetic Channel')
    expectMuiSelectText('genre', 'すべて')
    expect(searchRuleRepository.searchSchedules).toHaveBeenCalledWith({
      option: {
        keyword: 'Synthetic',
        keyCS: false,
        keyRegExp: false,
        name: true,
        description: true,
        extended: false,
        channelIds: [12],
        genres: [{ genre: 7 }],
        times: [{ week: 0x7f }],
      },
      isHalfWidth: false,
      limit: 125,
    })
    expect(screen.getByText('Synthetic Program One')).toBeVisible()
  })
})
