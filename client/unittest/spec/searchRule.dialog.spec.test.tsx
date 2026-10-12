import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'
import {
  createShellRepository,
  chooseMuiSelectOption,
  expectMuiSelectText,
  expectMuiSelectBlank,
  expectSearchScheduleCallsStable,
  advanceAnimationFrames,
  createSearchRuleRepository,
  warmUpSearchAppRender,
} from './searchRuleSupport'

describe('Search route lifecycle', () => {
  beforeAll(async () => {
    await warmUpSearchAppRender()
  })

  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    document.documentElement.classList.remove('fix-address-bar2')
  })

  // Chaining two independent workflows through one render of the full search route (a ProgramDialog
  // reserve action, then a separate Rule option form submission) in one `it` would pay for two full
  // interaction sequences (dialog open/reserve/close-wait, then directory select/submit/success-wait)
  // in a single test whose baseline render alone already costs several hundred milliseconds of real
  // clock time on this route (~2.9-3.3s unloaded combined), so contention from concurrent test files
  // could tip it over the per-test timeout. Neither workflow depends on the other's outcome or on
  // shared setup beyond the initial search render, so there is one `it` per workflow, each with its
  // own render. AC tags map onto whichever test exercises each contract: AC 2.2 and 2.15 describe
  // the no-reserve ProgramDialog action, AC 2.12 describes the new-rule save workflow.

  it('[AC 2.2][AC 2.15] uses shared ProgramDialog for a search result reserve action', async () => {
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
    await waitFor(() => {
      expect(searchRuleRepository.fetchReserveIndex).toHaveBeenCalledWith({
        startAt: 1_700_000_000_000,
        endAt: 1_700_003_600_000,
      })
    })

    fireEvent.click(screen.getByRole('button', { name: 'Synthetic Program One' }))
    const dialog = await screen.findByRole('dialog', { name: 'Synthetic Program One' })
    expect(within(dialog).getByRole('button', { name: '詳細' })).toBeVisible()
    fireEvent.click(within(dialog).getByRole('button', { name: '予約' }))

    await waitFor(() => {
      expect(searchRuleRepository.addProgramReserve).toHaveBeenCalledWith({
        programId: 1001,
        allowEndLack: true,
      })
    })
    await waitFor(() => {
      expect(searchRuleRepository.fetchReserveIndex).toHaveBeenCalledTimes(1)
    })
    await waitFor(() => {
      expect(
        screen.queryByRole('dialog', { name: 'Synthetic Program One' }),
      ).not.toBeInTheDocument()
    })
  })

  it('[AC 2.12] uses the rule option form to add a new rule from search', async () => {
    window.history.replaceState(null, '', '/#/search?keyword=Synthetic')
    const searchRuleRepository = createSearchRuleRepository()

    render(
      <App
        settings={{
          ...new DefaultSettingsFactory().create(),
          isEnableCopyKeywordToDirectory: true,
          isCheckAvoidDuplicate: true,
          isEnableEncodingSettingWhenCreateRule: true,
        }}
        apiRepository={createShellRepository()}
        searchRuleApiRepository={searchRuleRepository}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    expect(await screen.findByText('1 件ヒット')).toBeVisible()
    expectMuiSelectText('mode1', 'Synthetic Encode')
    expectMuiSelectBlank('directory')
    await chooseMuiSelectOption('directory', 'Synthetic Rule')

    fireEvent.click(screen.getByRole('button', { name: '追加' }))
    await waitFor(() => {
      expect(searchRuleRepository.addRule).toHaveBeenCalledWith(
        expect.objectContaining({
          isTimeSpecification: false,
          reserveOption: expect.objectContaining({
            allowEndLack: true,
            avoidDuplicate: true,
          }),
          saveOption: expect.objectContaining({
            parentDirectoryName: 'Synthetic Rule',
            directory: 'Synthetic',
          }),
          encodeOption: expect.objectContaining({
            mode1: 'Synthetic Encode',
          }),
        }),
      )
    })
    expect(await screen.findByText('ルール追加に成功')).toBeVisible()
  })

  // Chaining three independent proofs through one rule-edit preload in one `it` would cost each
  // later proof the two-fetch preload PLUS the earlier proofs' work (an explicit `rerender` and an
  // 8-iteration real-clock animation-frame stability loop, then a second search submission), close to
  // vitest's default 5000ms per-test timeout (~3.9-4.5s under moderate load, timing out under extreme
  // CPU contention). The proofs are: (1) the route's own `keyword=Ignored` query is ignored in favor
  // of the loaded rule's search option, (2) an unrelated re-render (a new-but-equal-content
  // `settings` reference from an ancestor, the same re-render shape [AC 2.9] elsewhere in this
  // feature guards against) does not trigger a duplicate search or wipe restored form state, and
  // (3) editing the loaded form and saving sends a PUT with the edited value merged with untouched
  // loaded fields. Each proof needs its own render to reach the "rule detail loaded" precondition
  // and none depends on the others, so there is one `it` per proof, each with its own render and
  // preload wait. AC tags map onto whichever test exercises each contract: AC 1.9 is the
  // route-query-ignored preload itself, AC 2.9 is the re-render stability/state-preservation
  // guard, AC 2.13 is the rule-edit save workflow.

  function mockLoadedRule(searchRuleRepository: ReturnType<typeof createSearchRuleRepository>) {
    vi.mocked(searchRuleRepository.fetchRule).mockResolvedValueOnce({
      ok: true as const,
      value: {
        id: 55,
        isTimeSpecification: false,
        searchOption: {
          keyword: 'Loaded Rule',
          name: true,
          channelIds: [33],
          channelNames: ['Synthetic Rule Channel'],
          GR: false,
          times: [{ week: 0x7f }],
        },
        reserveOption: {
          enable: true,
          allowEndLack: true,
          avoidDuplicate: true,
          periodToAvoidDuplicate: null,
        },
        saveOption: {
          parentDirectoryName: null,
          directory: 'Loaded Directory',
          recordedFormat: null,
        },
      },
    })
  }

  async function renderAndAwaitLoadedRulePreload(
    searchRuleRepository: ReturnType<typeof createSearchRuleRepository>,
    shellRepository: ReturnType<typeof createShellRepository>,
  ) {
    window.history.replaceState(null, '', '/#/search?rule=55&keyword=Ignored')
    mockLoadedRule(searchRuleRepository)

    const renderResult = render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={shellRepository}
        searchRuleApiRepository={searchRuleRepository}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    expect(await screen.findByRole('heading', { name: 'ルール編集' })).toBeVisible()
    await waitFor(() => {
      expect(searchRuleRepository.fetchRule).toHaveBeenCalledWith(55, true)
    })
    await waitFor(() => {
      expect(searchRuleRepository.searchSchedules).toHaveBeenCalledWith({
        option: {
          keyword: 'Loaded Rule',
          keyCS: false,
          keyRegExp: false,
          name: true,
          description: false,
          extended: false,
          channelIds: [33],
          times: [{ week: 0x7f }],
        },
        isHalfWidth: true,
        limit: 300,
      })
    })

    return renderResult
  }

  it('[AC 1.9] preloads normal rule edit state from rule detail instead of route search query', async () => {
    const searchRuleRepository = createSearchRuleRepository()
    const shellRepository = createShellRepository()

    // The preload wait above already proves the loaded rule's own keyword ('Loaded Rule') was
    // used for the search request instead of the route's `keyword=Ignored` query -- that is the
    // entirety of AC 1.9. No further interaction is needed to exercise this contract.
    await renderAndAwaitLoadedRulePreload(searchRuleRepository, shellRepository)
  })

  it('[AC 2.9] keeps the rule edit search stable and its restored form state intact across an unrelated re-render', async () => {
    const searchRuleRepository = createSearchRuleRepository()
    const shellRepository = createShellRepository()

    const { rerender } = await renderAndAwaitLoadedRulePreload(
      searchRuleRepository,
      shellRepository,
    )

    await advanceAnimationFrames(2)
    await expectSearchScheduleCallsStable(searchRuleRepository, 1)

    // Re-render with a new-but-equal-content `settings` object, the same reference-only-change
    // shape the ancestor tree can produce (see [AC 2.9] elsewhere in this feature), to prove this
    // does not trigger a duplicate search or wipe the state restored from the loaded rule.
    rerender(
      <App
        settings={{ ...new DefaultSettingsFactory().create() }}
        apiRepository={shellRepository}
        searchRuleApiRepository={searchRuleRepository}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )
    await waitFor(() => {
      expect(screen.getByText('1 件ヒット')).toBeVisible()
    })
    expect(searchRuleRepository.searchSchedules).toHaveBeenCalledTimes(1)
    expect(screen.getByLabelText('keyword')).toHaveValue('Loaded Rule')
    expectMuiSelectText('channelId', 'Synthetic Rule Channel')
    const conditionRegion = screen.getByRole('region', { name: '検索条件' })
    await waitFor(() => {
      expect(within(conditionRegion).getAllByLabelText('名前')[0]).toBeChecked()
      expect(within(conditionRegion).getByLabelText('GR')).not.toBeChecked()
    })
    expect(screen.getByLabelText('sub directory')).toHaveValue('Loaded Directory')
  })

  it('[AC 2.13] saves a rule edit update reflecting a resubmitted search', async () => {
    const searchRuleRepository = createSearchRuleRepository()
    const shellRepository = createShellRepository()

    await renderAndAwaitLoadedRulePreload(searchRuleRepository, shellRepository)
    expect(await screen.findByText('1 件ヒット')).toBeVisible()

    const conditionRegion = screen.getByRole('region', { name: '検索条件' })
    fireEvent.change(screen.getByLabelText('keyword'), { target: { value: 'Changed Rule' } })
    fireEvent.click(within(conditionRegion).getByRole('button', { name: '検索' }))
    await waitFor(() => {
      expect(searchRuleRepository.searchSchedules).toHaveBeenCalledTimes(2)
    })
    expect(await screen.findByLabelText('sub directory')).toHaveValue('Loaded Directory')

    fireEvent.click(await screen.findByRole('button', { name: '更新' }))
    await waitFor(() => {
      expect(searchRuleRepository.updateRule).toHaveBeenCalledWith(
        55,
        expect.objectContaining({
          searchOption: expect.objectContaining({
            keyword: 'Changed Rule',
            channelIds: [33],
          }),
          saveOption: expect.objectContaining({
            directory: 'Loaded Directory',
          }),
        }),
      )
    })
  })
})
