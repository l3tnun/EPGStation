import { useState } from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import { SearchRulePage } from '@/features/search/rule'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'
import {
  chooseMuiSelectOption,
  createShellRepository,
  createSearchRuleRepository,
  expectMuiSelectOption,
  expectMuiSelectText,
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

  // [Fix #35] The scrollbar-driven viewport shrink that triggers this unrelated re-render is not
  // specific to any one starting width: a scrollbar appearing narrows `document.documentElement`
  // by its own fixed width regardless of how wide the window was to begin with, and the shell's
  // `activeDashboardSettings` reference must not be recreated on every such re-render no matter
  // what the resulting width was (see useShellSettings.ts). This runs the same scenario across a
  // spread of window widths - desktop, the `APP_SHELL_DESKTOP_BREAKPOINT` (1264px) neighborhood,
  // and narrow/mobile - to pin that the fix holds at any resolution, not only at the original
  // 1280 -> 1265 pair.
  it.each([1920, 1600, 1440, 1280, 1024, 768, 600])(
    '[AC 2.9] keeps the result list when a scrollbar appearing narrows the viewport after a search (viewport %ipx)',
    async (startWidth) => {
      // Pressing 検索 on a window taller than roughly 1190px triggers a scrollbar-driven viewport
      // width change: the search form's own content is 1198px tall (measured against the running
      // app), so on a taller window there is no vertical scrollbar before the search. Rendering the
      // results makes the page overflow, the classic scrollbar appears, and `window.innerWidth`
      // drops by the scrollbar width. That width change is an unrelated re-render of the shell;
      // without the [AC 2.9] guard the search-mode branch of useSearchRuleRouteEffects resets the
      // search form and results on such a re-render, so the scroll target would be gone by the time
      // the scroll ran.
      //
      // Citation note: this fixture drives the search via a `?keyword=...` query-driven auto-search
      // (`routeState.shouldAutoSearch`). Removing the 要求 1.21 guard still re-sends that exact same
      // auto-search request on the unrelated re-render, so the result reappears with identical
      // content and this test cannot detect the guard being absent - it only pins down that a
      // query-driven auto-search survives an unrelated ancestor re-render, not that a "results
      // disappear" symptom is prevented. That symptom, reproduced with a real user-submitted
      // (non-query) search where there is no query to auto-resend after a reset, is covered
      // separately below by [AC 1.20].
      const keyword = `Owner Scrollbar Keyword ${startWidth}`
      window.history.replaceState(null, '', `/#/search?keyword=${encodeURIComponent(keyword)}`)
      const searchRuleRepository = createSearchRuleRepository()
      // A typical browser scrollbar is 15-17px wide; the exact figure does not matter here (the
      // guard is a route-string comparison, not a pixel threshold - see useSearchRuleRouteEffects.ts)
      // as long as the width actually changes.
      const shrunkWidth = startWidth - 15

      function Harness() {
        const [viewportWidth, setViewportWidth] = useState(startWidth)

        return (
          <App
            settings={new DefaultSettingsFactory().create()}
            apiRepository={createShellRepository()}
            searchRuleApiRepository={searchRuleRepository}
            osPrefersDark={false}
            viewportWidth={viewportWidth}
            initialDrawerState="none"
          >
            <button type="button" onClick={() => setViewportWidth(shrunkWidth)}>
              shrink-for-scrollbar
            </button>
            <SearchRulePage
              apiRepository={searchRuleRepository}
              encodeModes={['Synthetic Encode']}
              enabledBroadcastWaves={['GR', 'BS', 'CS']}
              isNavigationOpen={false}
              onSnackbar={vi.fn()}
              onNavigationClick={vi.fn()}
              recordedDirectories={['Synthetic Rule']}
              settings={new DefaultSettingsFactory().create()}
            />
          </App>
        )
      }

      render(<Harness />)

      expect(await screen.findByText('1 件ヒット')).toBeVisible()

      fireEvent.click(screen.getByText('shrink-for-scrollbar'))

      expect(screen.getByText('1 件ヒット')).toBeVisible()
      expect(screen.getByLabelText('keyword')).toHaveValue(keyword)
    },
  )

  it('[AC 1.20] keeps a user-submitted search result and does not report a scroll failure when an unrelated re-render follows it', async () => {
    // This pins 要求 1.20: once a user-submitted (plain `/search`, no query) search has succeeded,
    // an unrelated ancestor re-render (here, the shell reacting to a viewport width change) must
    // not clear the result list or report `スクロールに失敗`. The `keeps the result list when a
    // scrollbar appearing narrows the viewport after a search` fixture above exercises the same
    // re-render mechanism but drives the search from a `?keyword=...` route query - there, removing
    // the 要求 1.21 guard just re-sends an identical auto-search request and the symptom is not
    // observable. This test's plain `/search` submission has no query to auto-resend, so the guard
    // being absent leaves `activeRequest` (and so the result list) cleared instead of re-populated.
    window.history.replaceState(null, '', '/#/search')
    const searchRuleRepository = createSearchRuleRepository()
    const onSnackbar = vi.fn()

    function Harness() {
      const [viewportWidth, setViewportWidth] = useState(1280)

      return (
        <App
          settings={new DefaultSettingsFactory().create()}
          apiRepository={createShellRepository()}
          searchRuleApiRepository={searchRuleRepository}
          osPrefersDark={false}
          viewportWidth={viewportWidth}
          initialDrawerState="none"
        >
          <button type="button" onClick={() => setViewportWidth(1265)}>
            shrink-for-scrollbar
          </button>
          <SearchRulePage
            apiRepository={searchRuleRepository}
            encodeModes={['Synthetic Encode']}
            enabledBroadcastWaves={['GR', 'BS', 'CS']}
            isNavigationOpen={false}
            onSnackbar={onSnackbar}
            onNavigationClick={vi.fn()}
            recordedDirectories={['Synthetic Rule']}
            settings={new DefaultSettingsFactory().create()}
          />
        </App>
      )
    }

    render(<Harness />)

    // `scrollToElementHead` (lib/pageScroll.ts) calls `window.scrollTo` on its success path, so
    // spying on it observes a real scroll attempt without depending on any implementation detail of
    // how or when the caller schedules it.
    const scrollToSpy = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})

    await expectMuiSelectOption('channelId', 'Synthetic Channel')
    const keyword = screen.getByLabelText('keyword')
    fireEvent.change(keyword, { target: { value: 'Owner Submitted Keyword' } })
    await waitFor(() => {
      expect(keyword).toHaveValue('Owner Submitted Keyword')
    })
    fireEvent.click(
      within(screen.getByRole('region', { name: '検索条件' })).getByRole('button', {
        name: '検索',
      }),
    )

    expect(await screen.findByText('1 件ヒット')).toBeVisible()

    // The scroll this search triggers (`useSearchResultEffects.ts`) is scheduled via a real
    // `requestAnimationFrame` chain that starts once the result renders, and is still pending here
    // (confirmed empirically: unlike the DOM update itself, it has not fired yet the moment
    // `findByText` resolves). Waiting for it now, in real time, with a message-carrying assertion
    // settles it before the unrelated re-render below - and gives a clear failure, instead of an
    // opaque timeout, if the scroll is never attempted at all.
    await waitFor(() => {
      expect(
        scrollToSpy,
        'expected the search result scroll to have been attempted',
      ).toHaveBeenCalled()
    })

    // From here on, take over `requestAnimationFrame`/`setTimeout` so that whatever the unrelated
    // re-render below schedules - however many frames, or however long a timeout, it is deferred by
    // - is forced to run to completion before the assertions, instead of assuming a fixed number of
    // frames the implementation happens to use today. `findBy`/`waitFor` cannot be used from here on
    // (steering testing.md: `@testing-library/dom`'s polling only advances in real time in this
    // suite), so everything below the drain is a synchronous assertion instead.
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame'],
    })
    try {
      fireEvent.click(screen.getByText('shrink-for-scrollbar'))
      await vi.runAllTimersAsync()
    } finally {
      vi.useRealTimers()
    }

    expect(screen.getByText('1 件ヒット')).toBeVisible()
    expect(screen.getByLabelText('keyword')).toHaveValue('Owner Submitted Keyword')
    expect(onSnackbar).not.toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringContaining('スクロールに失敗') }),
    )
  })

  it('[AC 2.9] skips a repeat rule-edit preload when an unrelated re-render replays an unchanged rule', async () => {
    window.history.replaceState(null, '', '/#/search?rule=77')
    const searchRuleRepository = createSearchRuleRepository()
    vi.mocked(searchRuleRepository.fetchRule).mockResolvedValue({
      ok: true,
      value: {
        id: 77,
        isTimeSpecification: false,
        searchOption: {
          keyword: 'Synthetic',
          times: [{ week: 0x7f }],
        },
        reserveOption: {
          enable: true,
          allowEndLack: true,
          avoidDuplicate: false,
          periodToAvoidDuplicate: null,
        },
        saveOption: {
          parentDirectoryName: null,
          directory: null,
          recordedFormat: null,
        },
      },
    })

    function Harness() {
      // Re-rendering with a fresh array literal of identical content changes the prop
      // reference (and so the route-effect's dependency array) without changing anything the
      // rule-edit initialization key is derived from.
      const [replayTick, setReplayTick] = useState(0)

      return (
        <App
          settings={new DefaultSettingsFactory().create()}
          apiRepository={createShellRepository()}
          searchRuleApiRepository={searchRuleRepository}
          osPrefersDark={false}
          viewportWidth={1440}
          initialDrawerState="none"
        >
          <button type="button" onClick={() => setReplayTick((tick) => tick + 1)}>
            replay-unrelated-rerender
          </button>
          <SearchRulePage
            apiRepository={searchRuleRepository}
            encodeModes={['Synthetic Encode', 'Encode 2', 'Encode 3']}
            enabledBroadcastWaves={replayTick === 0 ? ['GR', 'BS', 'CS'] : ['GR', 'BS', 'CS']}
            isNavigationOpen={false}
            onSnackbar={vi.fn()}
            onNavigationClick={vi.fn()}
            recordedDirectories={['Recorded']}
            settings={new DefaultSettingsFactory().create()}
          />
        </App>
      )
    }

    render(<Harness />)

    expect(await screen.findByText('1 件ヒット')).toBeVisible()
    expect(searchRuleRepository.searchSchedules).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByText('replay-unrelated-rerender'))

    // The re-render carries a new (but content-equal) enabledBroadcastWaves array, so the
    // preload guard must skip re-running the search side effect a second time.
    expect(searchRuleRepository.searchSchedules).toHaveBeenCalledTimes(1)
  })

  it('[AC 2.9] keeps a typed keyword and a selected channel when an unrelated re-render replays plain search mode', async () => {
    // Typing a keyword/exclude keyword and then touching a channel/time/period field exercises
    // the plain 'search' mode branch of useSearchRuleRouteEffects: without its guard against an
    // unrelated re-render replaying the same route, it calls setForm()/setActiveRequest()
    // unconditionally instead of only when routeSearch actually changes, emptying the keyword and
    // making channel selection appear to have no effect - the same failure mode as [AC 2.9]
    // above, but for this branch instead of the rule-edit branch. This drives that scenario
    // through real form/channel-select DOM interactions instead of the hook directly (see
    // searchRule.routeEffectsSearchModeChurn.imp.test.ts for the hook-level coverage).
    window.history.replaceState(null, '', '/#/search')
    const searchRuleRepository = createSearchRuleRepository()

    function Harness() {
      const [replayTick, setReplayTick] = useState(0)

      return (
        <App
          settings={new DefaultSettingsFactory().create()}
          apiRepository={createShellRepository()}
          searchRuleApiRepository={searchRuleRepository}
          osPrefersDark={false}
          viewportWidth={1440}
          initialDrawerState="none"
        >
          <button type="button" onClick={() => setReplayTick((tick) => tick + 1)}>
            replay-unrelated-rerender
          </button>
          <SearchRulePage
            apiRepository={searchRuleRepository}
            encodeModes={['Synthetic Encode', 'Encode 2', 'Encode 3']}
            enabledBroadcastWaves={replayTick === 0 ? ['GR', 'BS', 'CS'] : ['GR', 'BS', 'CS']}
            isNavigationOpen={false}
            onSnackbar={vi.fn()}
            onNavigationClick={vi.fn()}
            recordedDirectories={['Recorded']}
            settings={new DefaultSettingsFactory().create()}
          />
        </App>
      )
    }

    render(<Harness />)

    await waitFor(() => {
      expect(screen.getByRole('combobox', { name: 'channelId' })).toBeInTheDocument()
    })
    const keyword = screen.getByLabelText('keyword')
    fireEvent.change(keyword, { target: { value: 'Owner Typed Keyword' } })
    await waitFor(() => {
      expect(keyword).toHaveValue('Owner Typed Keyword')
    })

    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'channelId' }))
    fireEvent.click(await screen.findByRole('option', { name: 'Synthetic Channel' }))
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' })
    await waitFor(() => {
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    })
    expect(screen.getByRole('combobox', { name: 'channelId' })).toHaveTextContent(
      'Synthetic Channel',
    )

    fireEvent.click(screen.getByText('replay-unrelated-rerender'))

    expect(keyword).toHaveValue('Owner Typed Keyword')
    expect(screen.getByRole('combobox', { name: 'channelId' })).toHaveTextContent(
      'Synthetic Channel',
    )
  })

  it('[AC 2.9] keeps search results, the encode option card, and keyword after touching a directory pulldown then an unrelated re-render', async () => {
    // Touching a directory pulldown in the encode option card exercises
    // useSearchRuleRouteEffects's search-mode branch, not RuleOptionForm.tsx: selecting a
    // RuleOptionField value only ever updates local `optionDraft` state, so it cannot itself
    // explain the search results and keyword disappearing - only the search-mode branch's
    // re-render handling can clear those. This drives that sequence (search, then touch a
    // directory pulldown, then an unrelated re-render) end to end and confirms the [AC 2.9]
    // guard covers it.
    //
    // Citation notes: (1) this fixture drives the search via a `?keyword=...` query-driven
    // auto-search, so removing the 要求 1.21 guard just re-sends the identical auto-search request
    // on the unrelated re-render and a "results/encode card disappear" symptom is not observable
    // here - see the note on the `keeps the result list when a scrollbar appearing narrows the
    // viewport after a search` fixture above. (2) the pulldown exercised here is the `directory`
    // RuleOptionField (a representative pulldown-only, `optionDraft`-only control), not the
    // `encodeOption.mode1` field; that field, together with a user-submitted (non-query) search
    // that can observably lose the result/encode card, is covered separately below by [AC 1.21].
    window.history.replaceState(null, '', '/#/search?keyword=Owner+Directory+Keyword')
    const searchRuleRepository = createSearchRuleRepository()

    function Harness() {
      const [replayTick, setReplayTick] = useState(0)

      return (
        <App
          settings={new DefaultSettingsFactory().create()}
          apiRepository={createShellRepository()}
          searchRuleApiRepository={searchRuleRepository}
          osPrefersDark={false}
          viewportWidth={1440}
          initialDrawerState="none"
        >
          <button type="button" onClick={() => setReplayTick((tick) => tick + 1)}>
            replay-unrelated-rerender
          </button>
          <SearchRulePage
            apiRepository={searchRuleRepository}
            encodeModes={['Synthetic Encode', 'Encode 2', 'Encode 3']}
            enabledBroadcastWaves={replayTick === 0 ? ['GR', 'BS', 'CS'] : ['GR', 'BS', 'CS']}
            isNavigationOpen={false}
            onSnackbar={vi.fn()}
            onNavigationClick={vi.fn()}
            recordedDirectories={['Synthetic Rule', 'Archive']}
            settings={new DefaultSettingsFactory().create()}
          />
        </App>
      )
    }

    render(<Harness />)

    expect(await screen.findByText('1 件ヒット')).toBeVisible()
    expect(screen.getByLabelText('keyword')).toHaveValue('Owner Directory Keyword')

    await chooseMuiSelectOption('directory', 'Archive')

    fireEvent.click(screen.getByText('replay-unrelated-rerender'))

    expect(screen.getByText('1 件ヒット')).toBeVisible()
    expect(screen.getByLabelText('keyword')).toHaveValue('Owner Directory Keyword')
    expect(screen.getByRole('combobox', { name: 'directory' })).toHaveTextContent('Archive')
  })

  it('[AC 1.21] keeps search results, the encode option card, and the selected encode mode after choosing an encode mode then an unrelated re-render', async () => {
    // This pins 要求 1.21: choosing an encode mode in the option card (the `encodeOption.mode1`
    // pulldown) exercises the same [AC 2.9] guard as the `directory` field, for the case where
    // removing it can actually be observed. The `keeps search results, the encode option card,
    // and keyword after touching a directory pulldown then an unrelated re-render` fixture above
    // exercises the same guard through the `directory` field instead, but drives the search via a
    // `?keyword=...` query, so a symptom is not observable there for the same reason as [AC 1.20]
    // above. This exercises the `mode1` field with a real, user-submitted (plain `/search`, no
    // query) search, where removing the guard leaves `activeRequest` cleared instead of
    // re-populated - so the result list and the encode option card (which only renders while a
    // result exists) both actually unmount.
    window.history.replaceState(null, '', '/#/search')
    const searchRuleRepository = createSearchRuleRepository()

    function Harness() {
      const [replayTick, setReplayTick] = useState(0)

      return (
        <App
          settings={new DefaultSettingsFactory().create()}
          apiRepository={createShellRepository()}
          searchRuleApiRepository={searchRuleRepository}
          osPrefersDark={false}
          viewportWidth={1440}
          initialDrawerState="none"
        >
          <button type="button" onClick={() => setReplayTick((tick) => tick + 1)}>
            replay-unrelated-rerender
          </button>
          <SearchRulePage
            apiRepository={searchRuleRepository}
            encodeModes={['Synthetic Encode', 'Encode 2', 'Encode 3']}
            enabledBroadcastWaves={replayTick === 0 ? ['GR', 'BS', 'CS'] : ['GR', 'BS', 'CS']}
            isNavigationOpen={false}
            onSnackbar={vi.fn()}
            onNavigationClick={vi.fn()}
            recordedDirectories={['Synthetic Rule', 'Archive']}
            settings={new DefaultSettingsFactory().create()}
          />
        </App>
      )
    }

    render(<Harness />)

    await expectMuiSelectOption('channelId', 'Synthetic Channel')
    const keyword = screen.getByLabelText('keyword')
    fireEvent.change(keyword, { target: { value: 'Owner Encode Keyword' } })
    await waitFor(() => {
      expect(keyword).toHaveValue('Owner Encode Keyword')
    })
    fireEvent.click(
      within(screen.getByRole('region', { name: '検索条件' })).getByRole('button', {
        name: '検索',
      }),
    )

    expect(await screen.findByText('1 件ヒット')).toBeVisible()

    await chooseMuiSelectOption('mode1', 'Encode 2')
    expectMuiSelectText('mode1', 'Encode 2')

    fireEvent.click(screen.getByText('replay-unrelated-rerender'))

    expect(screen.getByText('1 件ヒット')).toBeVisible()
    // RuleOptionForm.tsx's `EncodePanel` always renders `mode1` inside a `<details>`, but a closed
    // `<details>` hides everything except its `<summary>` label - so asserting the combobox itself
    // is visible (rather than the always-visible `エンコード1` summary text) actually confirms the
    // card stayed open.
    expect(screen.getByRole('combobox', { name: 'mode1' })).toBeVisible()
    expect(screen.getByLabelText('keyword')).toHaveValue('Owner Encode Keyword')
    expectMuiSelectText('mode1', 'Encode 2')
  })
})
