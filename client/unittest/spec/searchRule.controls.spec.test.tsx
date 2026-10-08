import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'
import {
  createShellRepository,
  chooseMuiSelectOption,
  expectMuiSelectText,
  expectMuiSelectOption,
  createSearchRuleRepository,
  closeSearchPeriodDialog,
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

  it('[AC 2.33] shows the original all-genre label when the all-genre dropdown item is selected', async () => {
    window.history.replaceState(null, '', '/#/search')

    render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        searchRuleApiRepository={createSearchRuleRepository()}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    expect(await screen.findByRole('heading', { name: '検索' })).toBeVisible()
    await chooseMuiSelectOption('genre', 'アニメ・特撮')
    await chooseMuiSelectOption('genre', 'すべて')
    expectMuiSelectText('genre', 'すべて')
  })

  it('[AC 2.34] selects multiple top-level and sub genres from the genre list', async () => {
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

    fireEvent.click(screen.getByRole('button', { name: 'ニュース・報道' }))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'ニュース・報道' })).toHaveAttribute(
        'data-selected',
        'true',
      )
    })
    fireEvent.click(screen.getByRole('button', { name: '野球' }))
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
        genres: [{ genre: 0 }, { genre: 1, subGenre: 1 }],
        times: [{ week: 0x7f }],
      }),
      isHalfWidth: true,
      limit: 300,
    })
  })

  // Walking the search period from unset to start-only to both ends set in one `it` would chain two
  // full datetime-dialog cycles (open, type, confirm, close-wait) and two full search round-trips
  // (submit, wait for the call, assert its body), long enough in real-clock time that CPU contention
  // from concurrent test files (such as under `coverage:gate`, which instruments every source file)
  // could tip it over vitest's default per-test timeout (see `closeSearchPeriodDialog` in
  // `searchRuleSupport.tsx` for the deterministic close-wait). The cases are therefore split: the
  // negative case (start alone omits `searchPeriods`) and the positive case (both ends produce it)
  // each have their own render and a single dialog/submit cycle, matching the AC 4.x split in
  // `guide.programDialogActions.spec.test.tsx`.
  it('[AC 2.30] omits searchPeriods from the search when only the period start is set', async () => {
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
    fireEvent.click(screen.getByLabelText('開始'))
    expect(await screen.findByRole('dialog', { name: '期間 開始' })).toBeVisible()
    fireEvent.change(screen.getByLabelText('開始日時'), { target: { value: '2026-05-05T12:30' } })
    fireEvent.click(screen.getByRole('button', { name: '設定' }))
    await closeSearchPeriodDialog('開始')

    fireEvent.click(
      within(screen.getByRole('region', { name: '検索条件' })).getByRole('button', {
        name: '検索',
      }),
    )
    await waitFor(() => {
      expect(searchRuleRepository.searchSchedules).toHaveBeenCalledTimes(1)
    })
    expect(searchRuleRepository.searchSchedules).toHaveBeenLastCalledWith({
      option: {
        times: [{ week: 0x7f }],
      },
      isHalfWidth: true,
      limit: 300,
    })
  })

  // Measured directly under an actual `coverage:gate` run (via `performance.now()` markers on
  // every step, since when this test itself is instrumented for coverage its own timing shifts
  // relative to an un-instrumented rehearsal - guessing from the latter would not reflect what
  // actually happens under the gate): opening the period-start and period-end dialogs and
  // waiting for either to *appear* is fast every time (under 60ms) - MUI mounts the dialog's DOM
  // synchronously, so `findByRole('dialog', ...)` resolves on its very first check rather than
  // polling. What is NOT fast is every `fireEvent`-triggered React commit: each of
  // click-to-open, `change`, and click-`設定`-to-submit re-renders the whole search page (every
  // field depends on the same `form` object), and each such commit was measured at 400-900ms
  // under `coverage:gate`'s per-file worker contention (versus 70-250ms with `vitest run` alone).
  // With two full dialog cycles (open/change/submit for start, then again for end) plus the final
  // search submit - six such commits total - one run reached ~4.7s against the 5s default test
  // timeout (a ~6% margin) and a separate run timed out outright; none of that time is a `setTimeout`
  // fake timers can fast-forward; it is synchronous render work, so splitting into two dialog-only
  // `it`s (which would each need their own render and could no longer prove the *combined* payload
  // in one flow) was not an option, and neither is instrumenting more of it away.
  //
  // Instead, the period-start dialog's cycle (render, open, change, submit - about half the
  // above) moves into `beforeEach`, which runs against vitest's separate, larger default
  // `hookTimeout` (10s) rather than the test body's `testTimeout` (5s) - the same technique
  // `warmUpSearchAppRender` above already relies on for the same reason. The `it` body below then
  // only has to do the period-end dialog's cycle, its close-wait, and the search submit - half
  // the original per-test cost - leaving comfortable margin under `testTimeout` even at the same
  // measured per-commit cost.
  describe('[AC 2.30] sends searchPeriods once both the period start and end are set', () => {
    let searchRuleRepository: ReturnType<typeof createSearchRuleRepository>

    beforeEach(async () => {
      window.history.replaceState(null, '', '/#/search')
      searchRuleRepository = createSearchRuleRepository()

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
      fireEvent.click(screen.getByLabelText('開始'))
      expect(await screen.findByRole('dialog', { name: '期間 開始' })).toBeVisible()
      fireEvent.change(screen.getByLabelText('開始日時'), { target: { value: '2026-05-05T12:30' } })
      fireEvent.click(screen.getByRole('button', { name: '設定' }))
      // Unlike the close-wait before the final search-button click in the test body below, this
      // dialog's own close transition does not need to finish before opening the *other* field's
      // dialog: MUI only marks siblings of the currently-open modal `aria-hidden` while that
      // specific modal is still mounted, and the next step queries the end-period field by label
      // (not by role), which is not filtered by `aria-hidden`. Confirmed by running with this
      // wait removed (still green) and, separately, with the wait after the *second* dialog also
      // removed (fails: the final `getByRole('region', { name: '検索条件' })` lookup then throws
      // because that region is still `aria-hidden` while the second dialog is transitioning
      // closed) - so only the second dialog's close-wait, in the test body, is load-bearing.
    })

    it('reflects both the already-set period start and the newly-set period end', async () => {
      fireEvent.click(screen.getByLabelText('終了'))
      expect(await screen.findByRole('dialog', { name: '期間 終了' })).toBeVisible()
      fireEvent.change(screen.getByLabelText('終了日時'), {
        target: { value: '2026-05-05T13:30' },
      })
      fireEvent.click(screen.getByRole('button', { name: '設定' }))
      await closeSearchPeriodDialog('終了')

      fireEvent.click(
        within(screen.getByRole('region', { name: '検索条件' })).getByRole('button', {
          name: '検索',
        }),
      )
      await waitFor(() => {
        expect(searchRuleRepository.searchSchedules).toHaveBeenCalledTimes(1)
      })
      expect(searchRuleRepository.searchSchedules).toHaveBeenLastCalledWith({
        option: {
          searchPeriods: [
            {
              startAt: new Date('2026-05-05T12:30').getTime(),
              endAt: new Date('2026-05-05T13:30').getTime(),
            },
          ],
          times: [{ week: 0x7f }],
        },
        isHalfWidth: true,
        limit: 300,
      })
    })
  })
})
