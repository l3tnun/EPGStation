import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { createScrollHistory } from '@/app/scrollHistory'
import { useManualReserveLoader } from '@/features/reserves/hooks/useManualReserveLoader'
import type { ReservesApiRepository } from '@/features/reserves/lib/reservesApiTypes'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'

function createDeferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve
  })

  return { promise, resolve }
}

const STABLE_WATCHED_FORM_STATE = {
  isTimeSpecification: false,
  timeSpecifiedOption: { name: null, channelId: null, startAt: null, endAt: null },
  reserveOption: { allowEndLack: true },
  encodeOption: { mode1: null, mode2: null, mode3: null, isDeleteOriginalAfterEncode: false },
}

// Every callback/ref passed to the hook must keep a stable identity across re-renders: the
// loader's data-fetch effect lists them all as dependencies, so a fresh literal per render would
// re-trigger the effect on every state update and defeat the cancellation being exercised here.
function createLoaderHarness(
  overrides: Partial<ReservesApiRepository> = {},
  scrollHistory = createScrollHistory({ shouldRestoreHistory: false }),
  initialMode: Parameters<typeof useManualReserveLoader>[0]['mode'] = { kind: 'add' },
) {
  const apiRepository = {
    fetchReserves: vi.fn(),
    fetchManualReserve: vi.fn(),
    fetchManualProgram: vi.fn(),
    addManualReserve: vi.fn(),
    updateManualReserve: vi.fn(),
    deleteReserve: vi.fn(),
    unlockSkipReserve: vi.fn(),
    unlockOverlapReserve: vi.fn(),
    updateReserves: vi.fn(),
    ...overrides,
  } as unknown as ReservesApiRepository

  const settings = new DefaultSettingsFactory().create()
  const replaceFormState = vi.fn()
  const onFetchFailure = vi.fn()
  const clearSuccessBackTimer = vi.fn()
  const setSubmitting = vi.fn()
  const submitInFlightRef = { current: false }
  const submitGenerationRef = { current: 0 }

  const hook = renderHook(
    (props: { mode: Parameters<typeof useManualReserveLoader>[0]['mode']; search: string }) =>
      useManualReserveLoader({
        mode: props.mode,
        search: props.search,
        apiRepository,
        settings,
        scrollHistory,
        onFetchFailure,
        replaceFormState,
        watchedFormState: STABLE_WATCHED_FORM_STATE,
        submitInFlightRef,
        submitGenerationRef,
        clearSuccessBackTimer,
        setSubmitting,
      }),
    { initialProps: { mode: initialMode, search: '' } },
  )

  return { hook, apiRepository, replaceFormState, onFetchFailure, scrollHistory }
}

describe('useManualReserveLoader cancellation and history restore edges', () => {
  it('[AC 1.5] skips applying an existing-reserve fetch result once the effect is cancelled by a mode change', async () => {
    const deferred =
      createDeferred<Awaited<ReturnType<ReservesApiRepository['fetchManualReserve']>>>()
    const { hook, replaceFormState, apiRepository } = createLoaderHarness({
      fetchManualReserve: vi.fn(() => deferred.promise),
    })

    hook.rerender({ mode: { kind: 'edit', reserveId: 701 }, search: '?reserveId=701' })
    await waitFor(() => expect(apiRepository.fetchManualReserve).toHaveBeenCalled())

    hook.rerender({ mode: { kind: 'add' }, search: '' })
    const callsAfterModeSwitch = replaceFormState.mock.calls.length
    deferred.resolve({ ok: true, value: { id: 701 } })

    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(replaceFormState.mock.calls.length).toBe(callsAfterModeSwitch)
  })

  it('[AC 1.5] skips applying a manual-program fetch result once the effect is cancelled by a mode change', async () => {
    const deferred =
      createDeferred<Awaited<ReturnType<ReservesApiRepository['fetchManualProgram']>>>()
    const { hook, replaceFormState, apiRepository } = createLoaderHarness({
      fetchManualProgram: vi.fn(() => deferred.promise),
    })

    hook.rerender({ mode: { kind: 'program', programId: 801 }, search: '?programId=801' })
    await waitFor(() => expect(apiRepository.fetchManualProgram).toHaveBeenCalled())

    hook.rerender({ mode: { kind: 'add' }, search: '' })
    const callsAfterModeSwitch = replaceFormState.mock.calls.length
    deferred.resolve({
      ok: true,
      value: { id: 801, name: 'Program', channelId: 1, startAt: 1_000, endAt: 2_000 },
    })

    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(replaceFormState.mock.calls.length).toBe(callsAfterModeSwitch)
  })

  it('[AC 4.19] skips the supplemental program-detail failure snackbar once cancelled by a mode change', async () => {
    const deferred =
      createDeferred<Awaited<ReturnType<ReservesApiRepository['fetchManualProgram']>>>()
    const { hook, onFetchFailure, apiRepository } = createLoaderHarness({
      fetchManualReserve: vi.fn(async () => ({
        ok: true as const,
        value: { id: 701, programId: 801 },
      })),
      fetchManualProgram: vi.fn(() => deferred.promise),
    })

    hook.rerender({ mode: { kind: 'edit', reserveId: 701 }, search: '?reserveId=701' })
    await waitFor(() => expect(apiRepository.fetchManualProgram).toHaveBeenCalled())

    hook.rerender({ mode: { kind: 'add' }, search: '' })
    deferred.resolve({
      ok: false,
      error: 'manual-program-fetch-failed',
      message: '番組情報取得に失敗',
    })

    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(onFetchFailure).not.toHaveBeenCalled()
  })

  it('[AC 4.4] completes the edit-mode load without a supplemental program fetch when the reserve has no programId', async () => {
    const { hook, replaceFormState, apiRepository } = createLoaderHarness(
      {
        fetchManualReserve: vi.fn(async () => ({
          ok: true as const,
          value: { id: 701, name: 'No-program reserve' },
        })),
      },
      createScrollHistory({ shouldRestoreHistory: false }),
      { kind: 'edit', reserveId: 701 },
    )

    await waitFor(() => {
      expect(replaceFormState).toHaveBeenCalledWith(
        expect.objectContaining({
          timeSpecifiedOption: expect.objectContaining({ name: 'No-program reserve' }),
        }),
      )
    })
    // The hook itself does not signal scroll-restoration "done" (see the doc comment on
    // `useManualReserveLoader`) -- `ManualReservePage` owns that, gated on this `isLoading`
    // turning false together with its own server-option fetch. This asserts the piece this hook
    // still owns: the load settles without a redundant program fetch.
    await waitFor(() => expect(hook.result.current.isLoading).toBe(false))

    expect(apiRepository.fetchManualProgram).not.toHaveBeenCalled()
  })

  it('[AC 4.18] restores form state from saved history pageInfo for a programId add-mode route', async () => {
    const pageInfo = {
      isTimeSpecification: true,
      timeSpecifiedOption: {
        name: 'Restored program',
        channelId: 5,
        startAt: 1_000,
        endAt: 2_000,
      },
      reserveOption: { allowEndLack: false },
      encodeOption: { mode1: null, mode2: null, mode3: null, isDeleteOriginalAfterEncode: false },
    }
    const scrollHistory = createScrollHistory({
      shouldRestoreHistory: true,
      initialScrollPosition: pageInfo as never,
    })
    const { replaceFormState } = createLoaderHarness(
      {
        fetchManualProgram: vi.fn(async () => ({
          ok: true as const,
          value: { id: 801, name: 'Program', channelId: 5, startAt: 1_000, endAt: 2_000 },
        })),
      },
      scrollHistory,
      { kind: 'program', programId: 801 },
    )

    await waitFor(() => {
      expect(replaceFormState).toHaveBeenCalledWith(pageInfo)
    })
  })
})
