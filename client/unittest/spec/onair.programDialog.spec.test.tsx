import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'
import { expectHashRoute } from './hashRouteAssertions'
import {
  NOW,
  createSchedule,
  createOnAirRepository,
  chooseMuiSelectOption,
  renderOnAir,
  navigateHashRoute,
} from './support/onairSpecHarness'

describe('On Air card and ProgramDialog actions', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.spyOn(Date, 'now').mockReturnValue(NOW)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  // Chaining eight sequential ProgramDialog interactions (encode select, checkbox, add, search,
  // edit, delete, rule navigate, exclude, unskip, unoverlap) across five synthetic programs sharing
  // one render in one `it` would take long enough in real-clock time (~3.5s unloaded) to sit close
  // to vitest's default 5000ms per-test timeout, so contention from other test files could tip it
  // over. Each action is independent of the others (they operate on different synthetic programs
  // and only share fixture shape), so the coverage below is split one action-group per `it` with
  // its own render; each AC tag maps onto the specific test that exercises it. AC 2.10 (returning
  // to /onair and continuing a ProgramDialog action after a route action) only tags the two tests
  // that perform that exact return-and-continue sequence.

  it('[AC 2.8] adds a reserve with encode options through the shared ProgramDialog contract', async () => {
    const repository = createOnAirRepository([createSchedule('GR', 110, 30)])

    renderOnAir({ repository })

    fireEvent.click(
      within(await screen.findByTestId('onair-card-110')).getByTestId('onair-card-header'),
    )
    await chooseMuiSelectOption('エンコード', 'H.264')
    fireEvent.click(screen.getByLabelText('元ファイル削除'))
    const fetchCountBeforeAdd = repository.fetchOnAir.mock.calls.length
    // The action snackbar closes on a 5 second wall-clock timer, and closing ProgramDialog after
    // the action runs its own exit transition (MUI default 195ms) that gates when ModalManager
    // restores aria-hidden on the rest of the shell, where the snackbar lives. Enable fake timers
    // before the click so both are driven deterministically instead of racing the host, and read
    // synchronously instead of polling with waitFor.
    vi.useFakeTimers()
    fireEvent.click(screen.getByRole('button', { name: '予約' }))
    expect(repository.addProgramReserve).toHaveBeenCalledWith({
      programId: 110,
      allowEndLack: true,
      encodeOption: {
        mode1: 'H.264',
        isDeleteOriginalAfterEncode: true,
      },
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200)
    })
    expect(repository.fetchOnAir.mock.calls.length).toBeGreaterThan(fetchCountBeforeAdd)
    expect(screen.getByRole('alert')).toHaveTextContent('Synthetic GR program 予約')
    vi.useRealTimers()
  })

  it('[AC 2.8] shows 検索 for a reserve-eligible program and generates a search route with channel id', async () => {
    const repository = createOnAirRepository([createSchedule('GR', 110, 30)])

    renderOnAir({
      repository,
      settings: {
        ...new DefaultSettingsFactory().create(),
        isIncludeChannelIdWhenSearching: true,
      },
    })

    fireEvent.click(
      within(await screen.findByTestId('onair-card-110')).getByTestId('onair-card-header'),
    )
    fireEvent.click(screen.getByRole('button', { name: '検索' }))
    await waitFor(() => {
      expectHashRoute('#/search?keyword=Synthetic+GR+program&channelId=110')
    })
  })

  it('[AC 2.8] [AC 2.10] edits a manual reserve, returns to /onair, and continues to cancel it', async () => {
    const repository = createOnAirRepository([createSchedule('GR', 111, 30)], {
      111: { type: 'reserve', item: { reserveId: 911, programId: 111 } },
    })

    renderOnAir({ repository })

    fireEvent.click(
      within(await screen.findByTestId('onair-card-111')).getByTestId('onair-card-header'),
    )
    fireEvent.click(screen.getByRole('button', { name: '編集' }))
    await waitFor(() => {
      expectHashRoute('#/reserves/manual?reserveId=911')
    })

    await navigateHashRoute('#/onair')
    fireEvent.click(
      within(await screen.findByTestId('onair-card-111')).getByTestId('onair-card-header'),
    )
    const fetchCountBeforeDelete = repository.fetchOnAir.mock.calls.length
    vi.useFakeTimers()
    fireEvent.click(screen.getByRole('button', { name: '削除' }))
    expect(repository.deleteReserve).toHaveBeenCalledWith(911)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200)
    })
    expect(repository.fetchOnAir.mock.calls.length).toBeGreaterThan(fetchCountBeforeDelete)
    expect(screen.getByRole('alert')).toHaveTextContent('Synthetic GR program キャンセル')
    vi.useRealTimers()
  })

  it('[AC 2.8] [AC 2.10] navigates to the rule, returns to /onair, and continues to exclude a conflicting rule reserve', async () => {
    const repository = createOnAirRepository([createSchedule('GR', 112, 30)], {
      112: { type: 'conflict', item: { reserveId: 912, programId: 112, ruleId: 501 } },
    })

    renderOnAir({ repository })

    fireEvent.click(
      within(await screen.findByTestId('onair-card-112')).getByTestId('onair-card-header'),
    )
    fireEvent.click(screen.getByRole('button', { name: 'ルール' }))
    await waitFor(() => {
      expectHashRoute('#/search?rule=501')
    })

    await navigateHashRoute('#/onair')
    fireEvent.click(
      within(await screen.findByTestId('onair-card-112')).getByTestId('onair-card-header'),
    )
    const fetchCountBeforeExclude = repository.fetchOnAir.mock.calls.length
    vi.useFakeTimers()
    fireEvent.click(screen.getByRole('button', { name: '除外' }))
    expect(repository.deleteReserve).toHaveBeenCalledWith(912)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200)
    })
    expect(repository.fetchOnAir.mock.calls.length).toBeGreaterThan(fetchCountBeforeExclude)
    expect(screen.getByRole('alert')).toHaveTextContent('Synthetic GR program キャンセル')
    vi.useRealTimers()
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Synthetic GR program' })).not.toBeInTheDocument()
    })
  })

  it('[AC 2.8] unlocks a skipped rule reserve from On Air', async () => {
    const repository = createOnAirRepository([createSchedule('GR', 113, 30)], {
      113: { type: 'skip', item: { reserveId: 913, programId: 113, ruleId: 501 } },
    })

    renderOnAir({ repository })

    fireEvent.click(
      within(await screen.findByTestId('onair-card-113')).getByTestId('onair-card-header'),
    )
    const fetchCountBeforeUnskip = repository.fetchOnAir.mock.calls.length
    fireEvent.click(screen.getByRole('button', { name: '除外解除' }))
    await waitFor(() => {
      expect(repository.unlockSkipReserve).toHaveBeenCalledWith(913)
    })
    await waitFor(() => {
      expect(repository.fetchOnAir.mock.calls.length).toBeGreaterThan(fetchCountBeforeUnskip)
    })
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Synthetic GR program' })).not.toBeInTheDocument()
    })
  })

  it('[AC 2.8] unlocks an overlapping rule reserve from On Air', async () => {
    const repository = createOnAirRepository([createSchedule('GR', 114, 30)], {
      114: { type: 'overlap', item: { reserveId: 914, programId: 114, ruleId: 501 } },
    })

    renderOnAir({ repository })

    fireEvent.click(
      within(await screen.findByTestId('onair-card-114')).getByTestId('onair-card-header'),
    )
    const fetchCountBeforeUnoverlap = repository.fetchOnAir.mock.calls.length
    fireEvent.click(screen.getByRole('button', { name: '重複解除' }))
    await waitFor(() => {
      expect(repository.unlockOverlapReserve).toHaveBeenCalledWith(914)
    })
    await waitFor(() => {
      expect(repository.fetchOnAir.mock.calls.length).toBeGreaterThan(fetchCountBeforeUnoverlap)
    })
  })

  it('[AC 2.8] shows the shared cancel failure snackbar when ProgramDialog delete fails', async () => {
    const repository = createOnAirRepository([createSchedule('GR', 120, 30)], {
      120: { type: 'reserve', item: { reserveId: 920, programId: 120 } },
    })
    repository.deleteReserve.mockResolvedValue({
      ok: false as const,
      error: 'onair-reserve-delete-failed' as const,
      message: 'キャンセル失敗',
    })

    renderOnAir({ repository })

    fireEvent.click(
      within(await screen.findByTestId('onair-card-120')).getByTestId('onair-card-header'),
    )
    fireEvent.click(screen.getByRole('button', { name: '削除' }))
    expect(repository.deleteReserve).toHaveBeenCalledWith(920)

    // The cancel failure snackbar closes on a 5 second wall-clock timer, and the dialog's own
    // exit transition also runs on a timer. Drive both under fake timers and read the alert
    // synchronously, so the assertion never races the host.
    vi.useFakeTimers()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200)
    })
    expect(screen.getByRole('alert')).toHaveTextContent('Synthetic GR program キャンセル失敗')
  })

  it('[AC 4.3] [AC 4.8] shows 編集/検索/重複解除 for a manual reserve in overlap state and edits it', async () => {
    const repository = createOnAirRepository([createSchedule('GR', 121, 30)], {
      121: { type: 'overlap', item: { reserveId: 921, programId: 121 } },
    })

    renderOnAir({ repository })

    fireEvent.click(
      within(await screen.findByTestId('onair-card-121')).getByTestId('onair-card-header'),
    )
    const dialog = await screen.findByRole('dialog', { name: 'Synthetic GR program' })
    expect(within(dialog).getByRole('button', { name: '編集' })).toBeVisible()
    expect(within(dialog).getByRole('button', { name: '検索' })).toBeVisible()
    expect(within(dialog).getByRole('button', { name: '重複解除' })).toBeVisible()

    fireEvent.click(within(dialog).getByRole('button', { name: '編集' }))
    await waitFor(() => {
      expectHashRoute('#/reserves/manual?reserveId=921')
    })
  })

  it('[AC 4.3] [AC 4.8] shows 編集/検索/除外解除 for a manual reserve in skip state and edits it', async () => {
    const repository = createOnAirRepository([createSchedule('GR', 122, 30)], {
      122: { type: 'skip', item: { reserveId: 922, programId: 122 } },
    })

    renderOnAir({ repository })

    fireEvent.click(
      within(await screen.findByTestId('onair-card-122')).getByTestId('onair-card-header'),
    )
    const dialog = await screen.findByRole('dialog', { name: 'Synthetic GR program' })
    expect(within(dialog).getByRole('button', { name: '編集' })).toBeVisible()
    expect(within(dialog).getByRole('button', { name: '検索' })).toBeVisible()
    expect(within(dialog).getByRole('button', { name: '除外解除' })).toBeVisible()

    fireEvent.click(within(dialog).getByRole('button', { name: '編集' }))
    await waitFor(() => {
      expectHashRoute('#/reserves/manual?reserveId=922')
    })
  })
})
