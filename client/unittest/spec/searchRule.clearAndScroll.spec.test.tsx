import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'
import {
  createShellRepository,
  createSearchRuleRepository,
  chooseMuiSelectOption,
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

  it('[AC 2.12] clears the search form and hides prior results when クリア is pressed', async () => {
    window.history.replaceState(null, '', '/#/search?keyword=Synthetic')
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

    expect(await screen.findByText('1 件ヒット')).toBeVisible()
    const conditionRegion = screen.getByRole('region', { name: '検索条件' })
    const searchButton = within(conditionRegion).getByRole('button', { name: '検索' })
    const actionsContainer = searchButton.parentElement as HTMLElement
    fireEvent.click(within(actionsContainer).getByRole('button', { name: 'クリア' }))

    await waitFor(() => {
      expect(screen.getByLabelText('keyword')).toHaveValue('')
    })
    expect(screen.queryByText('1 件ヒット')).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: '検索結果' })).not.toBeInTheDocument()
  })

  it('[AC 2.7] reports rule add failure without navigating away when addRule rejects', async () => {
    window.history.replaceState(null, '', '/#/search?keyword=Synthetic')
    const searchRuleRepository = createSearchRuleRepository()
    vi.mocked(searchRuleRepository.addRule).mockRejectedValueOnce(
      new Error('synthetic add rule failure'),
    )

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

    expect(await screen.findByText('1 件ヒット')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: '追加' }))

    expect(await screen.findByText('ルール追加に失敗')).toBeVisible()
    expect(screen.getByRole('heading', { name: '検索' })).toBeVisible()
  })

  it('[AC 2.7] reports rule update failure when updateRule rejects during rule edit', async () => {
    window.history.replaceState(null, '', '/#/search?rule=55')
    const searchRuleRepository = createSearchRuleRepository()
    vi.mocked(searchRuleRepository.updateRule).mockRejectedValueOnce(
      new Error('synthetic update rule failure'),
    )

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

    // The 更新 button renders after the rule fetch and the form reset that follows it. Two chained
    // async turns do not fit `findByRole`'s 1s default on a loaded host, so the deadline is stated
    // here instead of left implicit.
    fireEvent.click(await screen.findByRole('button', { name: '更新' }, { timeout: 15_000 }))
    expect(await screen.findByText('ルール更新に失敗')).toBeVisible()
  })

  it('[AC 2.7] reports rule update failure when updateRule resolves without throwing', async () => {
    window.history.replaceState(null, '', '/#/search?rule=55')
    const searchRuleRepository = createSearchRuleRepository()
    vi.mocked(searchRuleRepository.updateRule).mockResolvedValueOnce({
      ok: false,
      error: 'rule-update-failed',
      message: 'ルール更新に失敗',
    })

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

    // The 更新 button renders after the rule fetch and the form reset that follows it. Two chained
    // async turns do not fit `findByRole`'s 1s default on a loaded host, so the deadline is stated
    // here instead of left implicit.
    fireEvent.click(await screen.findByRole('button', { name: '更新' }, { timeout: 15_000 }))
    expect(await screen.findByText('ルール更新に失敗')).toBeVisible()
  })

  it('[AC 2.4] submits a new time-specified rule with the time-specified search option', async () => {
    window.history.replaceState(null, '', '/#/search')
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

    expect(await screen.findByRole('heading', { name: '検索' })).toBeVisible()
    fireEvent.click(screen.getByRole('switch'))
    const timeSpecifiedSection = await screen.findByRole('region', { name: '時刻指定予約設定' })
    await chooseMuiSelectOption('時刻指定 channel', 'Synthetic Channel')
    fireEvent.change(screen.getByLabelText('番組名 keyword'), {
      target: { value: 'Time Specified Keyword' },
    })
    fireEvent.change(screen.getByLabelText('開始'), { target: { value: '09:00' } })
    fireEvent.change(screen.getByLabelText('終了'), { target: { value: '10:00' } })
    fireEvent.click(within(timeSpecifiedSection).getByRole('button', { name: '追加' }))

    await waitFor(() => {
      expect(searchRuleRepository.addRule).toHaveBeenCalledWith(
        expect.objectContaining({ isTimeSpecification: true }),
      )
    })
    expect(await screen.findByText('ルール追加に成功')).toBeVisible()
  })

  it('[AC 2.4] reports failure when a new time-specified rule is submitted with incomplete fields', async () => {
    window.history.replaceState(null, '', '/#/search')
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

    expect(await screen.findByRole('heading', { name: '検索' })).toBeVisible()
    fireEvent.click(screen.getByRole('switch'))
    const timeSpecifiedSection = await screen.findByRole('region', { name: '時刻指定予約設定' })
    fireEvent.click(within(timeSpecifiedSection).getByRole('button', { name: '追加' }))

    expect(await screen.findByText('ルール追加に失敗')).toBeVisible()
    expect(searchRuleRepository.addRule).not.toHaveBeenCalled()
  })

  it('[AC 2.7] navigates back after a successful rule update once the success delay elapses', async () => {
    window.history.replaceState(null, '', '/#/')
    window.history.pushState(null, '', '/#/search?rule=55')
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

    expect(await screen.findByRole('heading', { name: 'ルール編集' })).toBeVisible()
    // Same deadline as above: the button lands after the rule fetch and the form reset.
    const updateButton = await screen.findByRole('button', { name: '更新' }, { timeout: 15_000 })

    // `shouldAdvanceTime` would tie the virtual clock back to the wall clock, which is what this
    // observation must not depend on. Drive the update under a clock that only this test advances.
    vi.useFakeTimers()
    fireEvent.click(updateButton)
    // Advance by zero: the success snackbar and the route change land after several promise turns,
    // and the 1 second back navigation below must not come due before they are observed.
    for (let step = 0; step < 200 && screen.queryAllByRole('alert').length === 0; step += 1) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
    }

    expect(searchRuleRepository.updateRule).toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('ルール更新に成功')
    expect(window.location.hash).toContain('#/search?rule=55')

    // `useSearchRuleActions` defers the back navigation with `setTimeout(..., 1000)` after the
    // success snackbar. Step until it comes due rather than assuming it is already armed.
    for (let step = 0; step < 20 && window.location.hash !== '#/'; step += 1) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000)
      })
    }

    expect(window.location.hash).toBe('#/')
  })
})
