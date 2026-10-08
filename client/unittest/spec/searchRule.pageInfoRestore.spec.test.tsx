import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import { createScrollHistory } from '@/app/scrollHistory'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'
import { createShellRepository, createSearchRuleRepository } from './searchRuleSupport'

describe('Search page info route-leave/restore', () => {
  beforeEach(() => {
    localStorage.clear()
    window.history.replaceState(null, '', '/#/search')
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('[AC 1.18] saves the typed-but-unsearched keyword when leaving plain /search, without marking it as searched', () => {
    const scrollHistory = createScrollHistory({ shouldRestoreHistory: false })

    const { unmount } = render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        searchRuleApiRepository={createSearchRuleRepository()}
        scrollHistory={scrollHistory}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    const conditionRegion = screen.getByRole('region', { name: '検索条件' })
    fireEvent.change(within(conditionRegion).getByLabelText('keyword'), {
      target: { value: 'Unsaved before leaving' },
    })
    expect(within(conditionRegion).getByLabelText('keyword')).toHaveValue('Unsaved before leaving')

    unmount()

    const savedPageInfo = scrollHistory.getScrollData<{
      form: { keyword: string }
      isSearched: boolean
    }>()
    expect(savedPageInfo?.form.keyword).toBe('Unsaved before leaving')
    expect(savedPageInfo?.isSearched).toBe(false)
  })

  it('[AC 1.18] does not save page info when leaving a rule-edit route', () => {
    window.history.replaceState(null, '', '/#/search?rule=901')
    const scrollHistory = createScrollHistory({ shouldRestoreHistory: false })
    const searchRuleRepository = createSearchRuleRepository()

    const { unmount } = render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        searchRuleApiRepository={searchRuleRepository}
        scrollHistory={scrollHistory}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    unmount()

    expect(scrollHistory.getScrollData()).toBeNull()
  })

  it('[AC 1.18] restores a typed-but-unsearched keyword on history restore without auto-searching', async () => {
    // Round-trip the real save path (first render + unmount) into the real restore path (second
    // render with the captured snapshot as history) instead of hand-building the saved shape, so
    // this test breaks if the save/restore shapes ever drift apart.
    const leavingScrollHistory = createScrollHistory({ shouldRestoreHistory: false })
    const firstVisit = render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        searchRuleApiRepository={createSearchRuleRepository()}
        scrollHistory={leavingScrollHistory}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )
    const firstConditionRegion = screen.getByRole('region', { name: '検索条件' })
    fireEvent.change(within(firstConditionRegion).getByLabelText('keyword'), {
      target: { value: 'Restored keyword' },
    })
    firstVisit.unmount()
    const savedPageInfo = leavingScrollHistory.getScrollData()
    expect(savedPageInfo).not.toBeNull()

    const searchRuleRepository = createSearchRuleRepository()
    const restoringScrollHistory = createScrollHistory({
      shouldRestoreHistory: true,
      initialScrollPosition: savedPageInfo as never,
    })

    render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        searchRuleApiRepository={searchRuleRepository}
        scrollHistory={restoringScrollHistory}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    const conditionRegion = await screen.findByRole('region', { name: '検索条件' })
    await waitFor(() => {
      expect(within(conditionRegion).getByLabelText('keyword')).toHaveValue('Restored keyword')
    })
    expect(searchRuleRepository.searchSchedules).not.toHaveBeenCalled()
  })

  it('[AC 1.18] restores an already-searched query on history restore and re-executes the search', async () => {
    const leavingScrollHistory = createScrollHistory({ shouldRestoreHistory: false })
    const firstVisit = render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        searchRuleApiRepository={createSearchRuleRepository()}
        scrollHistory={leavingScrollHistory}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )
    const firstConditionRegion = screen.getByRole('region', { name: '検索条件' })
    fireEvent.change(within(firstConditionRegion).getByLabelText('keyword'), {
      target: { value: 'Already searched keyword' },
    })
    fireEvent.click(within(firstConditionRegion).getByRole('button', { name: '検索' }))
    await waitFor(() => {
      expect(screen.getByText('Synthetic Program One')).toBeVisible()
    })
    firstVisit.unmount()
    const savedPageInfo = leavingScrollHistory.getScrollData()

    const searchRuleRepository = createSearchRuleRepository()
    const restoringScrollHistory = createScrollHistory({
      shouldRestoreHistory: true,
      initialScrollPosition: savedPageInfo as never,
    })

    render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        searchRuleApiRepository={searchRuleRepository}
        scrollHistory={restoringScrollHistory}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    const conditionRegion = await screen.findByRole('region', { name: '検索条件' })
    await waitFor(() => {
      expect(within(conditionRegion).getByLabelText('keyword')).toHaveValue(
        'Already searched keyword',
      )
    })
    await waitFor(() => {
      expect(searchRuleRepository.searchSchedules).toHaveBeenCalledWith(
        expect.objectContaining({
          option: expect.objectContaining({ keyword: 'Already searched keyword' }),
        }),
      )
    })
    expect(await screen.findByText('Synthetic Program One')).toBeVisible()
  })

  it('[AC 1.3][AC 1.5][AC 1.18] ignores stale saved page info on a fresh (non-history-restore) visit', async () => {
    const scrollHistory = createScrollHistory({ shouldRestoreHistory: false })
    scrollHistory.saveScrollData({
      form: { keyword: 'Stale leftover keyword' },
      isTimeSpecification: false,
      timeReserveForm: {},
      optionDraft: {},
      isSearched: true,
    })
    const searchRuleRepository = createSearchRuleRepository()

    render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        searchRuleApiRepository={searchRuleRepository}
        scrollHistory={scrollHistory}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    const conditionRegion = await screen.findByRole('region', { name: '検索条件' })
    expect(within(conditionRegion).getByLabelText('keyword')).toHaveValue('')
    expect(searchRuleRepository.searchSchedules).not.toHaveBeenCalled()
  })
})
