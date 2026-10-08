import { useState } from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import { SearchRulePage } from '@/features/search/rule'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'
import {
  createShellRepository,
  chooseMuiSelectOption,
  expectMuiSelectText,
  expectMuiSelectOption,
  createSearchRuleRepository,
  closeSelectMenu,
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

  it('[AC 2.36] submits keyword search on Enter with legacy default name and description targets', async () => {
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

    await expectMuiSelectOption('channelId', 'Synthetic Channel')
    const keyword = screen.getByLabelText('keyword')
    fireEvent.change(keyword, { target: { value: 'Enter Keyword' } })
    await waitFor(() => {
      expect(keyword).toHaveValue('Enter Keyword')
    })
    fireEvent.keyDown(keyword, { key: 'Enter' })

    expect(await screen.findByText('1 件ヒット')).toBeVisible()
    expect(searchRuleRepository.searchSchedules).toHaveBeenCalledWith(
      expect.objectContaining({
        option: expect.objectContaining({
          keyword: 'Enter Keyword',
          name: true,
          description: true,
          extended: false,
        }),
      }),
    )
  })

  it('[AC 2.36] submits ignore keyword search on Enter with legacy default target normalization', async () => {
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

    await expectMuiSelectOption('channelId', 'Synthetic Channel')
    const ignoreKeyword = screen.getByLabelText('ignore keyword')
    fireEvent.change(ignoreKeyword, { target: { value: 'Ignore Enter Keyword' } })
    await waitFor(() => {
      expect(ignoreKeyword).toHaveValue('Ignore Enter Keyword')
    })
    fireEvent.keyDown(ignoreKeyword, { key: 'Enter' })

    expect(await screen.findByText('1 件ヒット')).toBeVisible()
    expect(searchRuleRepository.searchSchedules).toHaveBeenCalledWith(
      expect.objectContaining({
        option: expect.objectContaining({
          ignoreKeyword: 'Ignore Enter Keyword',
          ignoreName: true,
          ignoreDescription: true,
          ignoreExtended: false,
        }),
      }),
    )
  })

  it('[AC 2.33] uses select controls for channel, genre filtering, start, and range search options', async () => {
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
    await expectMuiSelectOption('channelId', 'Synthetic Channel')

    await chooseMuiSelectOption('channelId', 'Synthetic Channel')
    await chooseMuiSelectOption('genre', 'アニメ・特撮')
    expect(screen.getByText('国内アニメ')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'ニュース・報道' })).not.toBeInTheDocument()
    await chooseMuiSelectOption('start', '21時')
    await chooseMuiSelectOption('range', '3時間')
    fireEvent.click(
      within(screen.getByRole('region', { name: '検索条件' })).getByRole('button', {
        name: '検索',
      }),
    )

    await waitFor(() => {
      expect(searchRuleRepository.searchSchedules).toHaveBeenCalledTimes(1)
    })
    expect(searchRuleRepository.searchSchedules).toHaveBeenLastCalledWith({
      option: expect.objectContaining({
        channelIds: [12],
        times: [{ week: 0x7f, start: 21, range: 3 }],
      }),
      isHalfWidth: true,
      limit: 300,
    })
  })

  it('[AC 1.21] keeps a typed keyword and exclude keyword when channel/start/range operations coincide with an unrelated re-render', async () => {
    // frontend-search-rule 要求 1.21: typing keyword/exclude keyword and then
    // touching channel/time/period fields emptied the keyword. Root cause: the 'search' mode
    // branch of useSearchRuleRouteEffects reset the form whenever its effect re-ran, instead of
    // only when `didRouteSearchChange` (routeSearch actually changing) - see
    // useSearchRuleRouteEffects.ts. The effect re-runs whenever `enabledBroadcastWaves`/`settings`
    // receive a new-but-equal-content reference from an unrelated ancestor re-render, which is
    // exactly what `managementRoutes` produces on every App-level re-render (it calls
    // `getEnabledBroadcastWaves(activeServerConfig)` inline, unmemoized). The existing
    // `searchRule.routeEffectsReplay.spec.test.tsx` "[AC 2.9]" test already covers a typed
    // keyword + channel selection surviving one such re-render, but never touches start/range;
    // the [AC 2.33] test above drives channel/start/range but never types a keyword. This
    // combines both: keyword/ignoreKeyword typed, then channel/start/range each operated via
    // chooseMuiSelectOption with an unrelated re-render (a fresh-but-equal-content
    // enabledBroadcastWaves array, the same mechanism `routeEffectsReplay`'s Harness uses)
    // interleaved after each operation. Verified to fail against the earlier code that reset
    // the fields unconditionally and pass against the fix.
    //
    // The broadcast wave checkboxes (GR/BS/CS) are also asserted at every step, not just
    // keyword/ignoreKeyword: requirement 1.21 (requirements.md:125-130) names "放送波チェック"
    // explicitly, and the outgoing request alone cannot tell resetting-to-default apart from
    // correct behavior once a channel is selected. `restoreVisibleBroadcastWaves`
    // (searchRequest.ts) only normalizes the *form's* broadcastWaves values (forcing them all to
    // false once a channel is selected); it is `appendBroadcastWaveOption` (searchRequest.ts,
    // called from `buildSearchRequestBody`) that then omits the broadcast-wave keys from the
    // request entirely whenever `channelIds` is non-empty. Either way, a form-level regression
    // that resets `broadcastWaves` back to its default (all-enabled) on every unrelated re-render
    // would be invisible to a request-only assertion once a channel is selected. The expected
    // checked/unchecked sequence below was read off the actual DOM against the fix
    // (not assumed): the boxes stay checked through channel/start/range selection (only
    // `submitSearch` calls `restoreVisibleBroadcastWaves`, not selecting a channel by itself),
    // then submit flips them unchecked (channel selected + all visible waves still enabled), and
    // a further unrelated re-render after submit must not flip them back to checked.
    window.history.replaceState(null, '', '/#/search')
    const searchRuleRepository = createSearchRuleRepository()

    function Harness() {
      const [, setReplayTick] = useState(0)
      // A plain array literal re-evaluated on every render of this component: its *content*
      // never changes, but clicking "replay-unrelated-rerender" forces this component to
      // re-render, which creates a brand new array *reference* here - matching
      // `managementRoutes`'s unmemoized `getEnabledBroadcastWaves(activeServerConfig)` call,
      // the actual real-app source of the reference churn this test reproduces.
      const enabledBroadcastWaves: readonly ('GR' | 'BS' | 'CS')[] = ['GR', 'BS', 'CS']

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
            enabledBroadcastWaves={enabledBroadcastWaves}
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

    await expectMuiSelectOption('channelId', 'Synthetic Channel')
    const keyword = screen.getByLabelText('keyword')
    const ignoreKeyword = screen.getByLabelText('ignore keyword')
    const grCheckbox = screen.getByRole('checkbox', { name: 'GR' })
    const bsCheckbox = screen.getByRole('checkbox', { name: 'BS' })
    const csCheckbox = screen.getByRole('checkbox', { name: 'CS' })
    expect(grCheckbox).toBeChecked()
    expect(bsCheckbox).toBeChecked()
    expect(csCheckbox).toBeChecked()
    fireEvent.change(keyword, { target: { value: 'Owner Typed Keyword' } })
    fireEvent.change(ignoreKeyword, { target: { value: 'Owner Typed Ignore Keyword' } })
    await waitFor(() => {
      expect(keyword).toHaveValue('Owner Typed Keyword')
    })
    expect(ignoreKeyword).toHaveValue('Owner Typed Ignore Keyword')

    await chooseMuiSelectOption('channelId', 'Synthetic Channel')
    fireEvent.click(screen.getByText('replay-unrelated-rerender'))
    expect(grCheckbox).toBeChecked()
    expect(bsCheckbox).toBeChecked()
    expect(csCheckbox).toBeChecked()
    expect(keyword).toHaveValue('Owner Typed Keyword')
    expect(ignoreKeyword).toHaveValue('Owner Typed Ignore Keyword')
    expect(screen.getByRole('combobox', { name: 'channelId' })).toHaveTextContent(
      'Synthetic Channel',
    )

    await chooseMuiSelectOption('start', '21時')
    fireEvent.click(screen.getByText('replay-unrelated-rerender'))
    expect(grCheckbox).toBeChecked()
    expect(bsCheckbox).toBeChecked()
    expect(csCheckbox).toBeChecked()
    expect(keyword).toHaveValue('Owner Typed Keyword')
    expect(ignoreKeyword).toHaveValue('Owner Typed Ignore Keyword')

    await chooseMuiSelectOption('range', '3時間')
    fireEvent.click(screen.getByText('replay-unrelated-rerender'))
    expect(grCheckbox).toBeChecked()
    expect(bsCheckbox).toBeChecked()
    expect(csCheckbox).toBeChecked()
    expect(keyword).toHaveValue('Owner Typed Keyword')
    expect(ignoreKeyword).toHaveValue('Owner Typed Ignore Keyword')

    fireEvent.click(
      within(screen.getByRole('region', { name: '検索条件' })).getByRole('button', {
        name: '検索',
      }),
    )

    await waitFor(() => {
      expect(searchRuleRepository.searchSchedules).toHaveBeenCalledTimes(1)
    })
    expect(grCheckbox).not.toBeChecked()
    expect(bsCheckbox).not.toBeChecked()
    expect(csCheckbox).not.toBeChecked()
    expect(searchRuleRepository.searchSchedules).toHaveBeenLastCalledWith({
      option: expect.objectContaining({
        keyword: 'Owner Typed Keyword',
        ignoreKeyword: 'Owner Typed Ignore Keyword',
        channelIds: [12],
        times: [{ week: 0x7f, start: 21, range: 3 }],
      }),
      isHalfWidth: true,
      limit: 300,
    })
    expect(keyword).toHaveValue('Owner Typed Keyword')
    expect(ignoreKeyword).toHaveValue('Owner Typed Ignore Keyword')

    fireEvent.click(screen.getByText('replay-unrelated-rerender'))
    expect(grCheckbox).not.toBeChecked()
    expect(bsCheckbox).not.toBeChecked()
    expect(csCheckbox).not.toBeChecked()
    expect(keyword).toHaveValue('Owner Typed Keyword')
    expect(ignoreKeyword).toHaveValue('Owner Typed Ignore Keyword')
  })

  // Chaining a placeholder check, two full channelId multi-select rounds (one with per-option
  // checkbox assertions, one to re-establish state after the clear button), a start/range select
  // pair, another clear, and a final submit in one `it` would drive many real Select-menu
  // open/close cycles and a full search round-trip, long enough in real-clock time that CPU
  // contention from concurrent test files (such as under `coverage:gate`, which instruments every
  // source file) could tip it over vitest's default per-test timeout (see `closeSelectMenu` in
  // `searchRuleSupport.tsx` for the deterministic close-wait). The two independent concerns -- the
  // placeholder/clear-button affordances, and the final submitted option shape -- are therefore
  // split across two renders, matching the AC 4.x split in
  // `guide.programDialogActions.spec.test.tsx`.
  it('[AC 2.33][AC 2.37] matches the original search select affordances for placeholders and the channelId clear button', async () => {
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
    expectMuiSelectText('channelId', 'channel')
    expectMuiSelectText('genre', 'すべて')
    expectMuiSelectText('start', 'start')
    expectMuiSelectText('range', 'range')

    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'channelId' }))
    const syntheticChannelOption = await screen.findByRole('option', { name: 'Synthetic Channel' })
    fireEvent.click(syntheticChannelOption)
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    expect(syntheticChannelOption).toHaveAttribute('aria-selected', 'true')
    expect(within(syntheticChannelOption).getByRole('checkbox')).toBeChecked()
    const syntheticRuleChannelOption = await screen.findByRole('option', {
      name: 'Synthetic Rule Channel',
    })
    fireEvent.click(syntheticRuleChannelOption)
    expect(syntheticRuleChannelOption).toHaveAttribute('aria-selected', 'true')
    expect(within(syntheticRuleChannelOption).getByRole('checkbox')).toBeChecked()
    await closeSelectMenu()

    expectMuiSelectText('channelId', 'Synthetic Channel, Synthetic Rule Channel')
    fireEvent.click(screen.getByRole('button', { name: 'channelIdをクリア' }))
    expectMuiSelectText('channelId', 'channel')
  })

  it('[AC 2.33][AC 2.37] submits multiple selected channels while an unrelated cleared field is left out', async () => {
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
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'channelId' }))
    fireEvent.click(await screen.findByRole('option', { name: 'Synthetic Channel' }))
    fireEvent.click(await screen.findByRole('option', { name: 'Synthetic Rule Channel' }))
    await closeSelectMenu()

    await chooseMuiSelectOption('start', '21時')
    await chooseMuiSelectOption('range', '3時間')
    fireEvent.click(screen.getByRole('button', { name: 'startをクリア' }))
    expectMuiSelectText('start', 'start')

    fireEvent.click(
      within(screen.getByRole('region', { name: '検索条件' })).getByRole('button', {
        name: '検索',
      }),
    )

    await waitFor(() => {
      expect(searchRuleRepository.searchSchedules).toHaveBeenCalledTimes(1)
    })
    expect(searchRuleRepository.searchSchedules).toHaveBeenLastCalledWith({
      option: expect.objectContaining({
        channelIds: [12, 33],
      }),
      isHalfWidth: true,
      limit: 300,
    })
  })

  it('[AC 2.36] re-checks every broadcast wave checkbox on submit when all were unchecked', async () => {
    // v2's equivalent (client/src/model/state/search/SearchState.ts `prepSearchOption()`, called
    // from `search()` on every submit) sets `broadcastWave.{GR,BS,CS,SKY}.isEnable = true` when
    // no channel is selected and no visible wave is enabled - and that field is the same reactive
    // state the checkboxes are bound to, so the checkboxes visibly flip back to checked. v3's
    // `restoreVisibleBroadcastWaves` (searchRequest.ts) already reimplements the "search as if
    // all are enabled" half of this for the outgoing request body, but was never fed back into
    // the visible form, so the checkboxes stayed unchecked (unchecking every
    // broadcast wave and searching does not re-check them).
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

    await expectMuiSelectOption('channelId', 'Synthetic Channel')
    const grCheckbox = screen.getByRole('checkbox', { name: 'GR' })
    const bsCheckbox = screen.getByRole('checkbox', { name: 'BS' })
    const csCheckbox = screen.getByRole('checkbox', { name: 'CS' })
    expect(grCheckbox).toBeChecked()
    expect(bsCheckbox).toBeChecked()
    expect(csCheckbox).toBeChecked()

    fireEvent.click(grCheckbox)
    fireEvent.click(bsCheckbox)
    fireEvent.click(csCheckbox)
    expect(grCheckbox).not.toBeChecked()
    expect(bsCheckbox).not.toBeChecked()
    expect(csCheckbox).not.toBeChecked()

    fireEvent.click(
      within(screen.getByRole('region', { name: '検索条件' })).getByRole('button', {
        name: '検索',
      }),
    )

    expect(await screen.findByText('1 件ヒット')).toBeVisible()
    expect(grCheckbox).toBeChecked()
    expect(bsCheckbox).toBeChecked()
    expect(csCheckbox).toBeChecked()
    expect(searchRuleRepository.searchSchedules).toHaveBeenCalledWith(
      expect.objectContaining({
        option: expect.not.objectContaining({ GR: expect.anything() }),
      }),
    )
  })

  it('[AC 1.11] keeps the duration minimum and maximum labels on screen after values are entered', async () => {
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

    const min = await screen.findByRole('textbox', { name: '最小(分)' })
    const max = screen.getByRole('textbox', { name: '最大(分)' })

    expect(screen.getByText('最小(分)')).toBeVisible()
    expect(screen.getByText('最大(分)')).toBeVisible()

    fireEvent.change(min, { target: { value: '30' } })
    fireEvent.change(max, { target: { value: '90' } })
    await waitFor(() => {
      expect(min).toHaveValue('30')
    })
    expect(max).toHaveValue('90')

    // The two boxes sit side by side inside one 長さ row with nothing else between them, so the
    // labels have to stay on screen for the values to read as a minimum and a maximum.
    expect(screen.getByText('最小(分)')).toBeVisible()
    expect(screen.getByText('最大(分)')).toBeVisible()
  })
})
