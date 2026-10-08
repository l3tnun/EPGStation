import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useManualReserveSubmit } from '@/features/reserves/hooks/useManualReserveSubmit'
import type { ManualReserveFormState } from '@/features/reserves/lib/manualReserveForm'
import type { ReservesApiRepository } from '@/features/reserves/lib/reservesApiTypes'

const validFormState: ManualReserveFormState = {
  isTimeSpecification: false,
  timeSpecifiedOption: { name: null, channelId: null, startAt: null, endAt: null },
  reserveOption: { allowEndLack: true },
  encodeOption: { mode1: null, mode2: null, mode3: null, isDeleteOriginalAfterEncode: false },
}

function createApiRepositoryStub(overrides: Partial<ReservesApiRepository> = {}) {
  return {
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
}

describe('useManualReserveSubmit success/failure message and stale-timer edges', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('[AC 4.9] reports the update failure message and does not schedule the return-navigation timer', async () => {
    const apiRepository = createApiRepositoryStub({
      updateManualReserve: vi.fn(async () => ({
        ok: false as const,
        error: 'manual-reserve-update-failed' as const,
        message: '予約の更新に失敗しました。',
      })),
    })
    const onFetchFailure = vi.fn()
    const goBack = vi.fn()

    const { result } = renderHook(() =>
      useManualReserveSubmit({
        mode: { kind: 'edit', reserveId: 701 },
        apiRepository,
        onFetchFailure,
        setError: vi.fn(),
        goBack,
      }),
    )

    await act(async () => {
      await result.current.submitForm(validFormState, undefined as never)
    })

    expect(onFetchFailure).toHaveBeenCalledWith({
      text: '予約の更新に失敗しました。',
      severity: 'error',
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000)
    })
    expect(goBack).not.toHaveBeenCalled()
  })

  it('[AC 4.8] reports the add failure message when the API call itself rejects the payload', async () => {
    const apiRepository = createApiRepositoryStub({
      addManualReserve: vi.fn(async () => ({
        ok: false as const,
        error: 'manual-reserve-add-failed' as const,
        message: '予約の追加に失敗しました。',
      })),
    })
    const onFetchFailure = vi.fn()

    const { result } = renderHook(() =>
      useManualReserveSubmit({
        mode: { kind: 'program', programId: 801 },
        apiRepository,
        onFetchFailure,
        setError: vi.fn(),
        goBack: vi.fn(),
      }),
    )

    await act(async () => {
      await result.current.submitForm(validFormState, undefined as never)
    })

    expect(onFetchFailure).toHaveBeenCalledWith({
      text: '予約の追加に失敗しました。',
      severity: 'error',
    })
  })

  it('[AC 4.9] reports the update success message and navigates back after the delay', async () => {
    const apiRepository = createApiRepositoryStub({
      updateManualReserve: vi.fn(async () => ({ ok: true as const, value: undefined })),
    })
    const onFetchFailure = vi.fn()
    const goBack = vi.fn()

    const { result } = renderHook(() =>
      useManualReserveSubmit({
        mode: { kind: 'edit', reserveId: 701 },
        apiRepository,
        onFetchFailure,
        setError: vi.fn(),
        goBack,
      }),
    )

    await act(async () => {
      await result.current.submitForm(validFormState, undefined as never)
    })

    expect(onFetchFailure).toHaveBeenCalledWith({
      text: '予約を更新しました。',
      severity: 'success',
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000)
    })
    expect(goBack).toHaveBeenCalledTimes(1)
  })

  it('skips the scheduled return navigation when the submit generation advances before the timer fires', async () => {
    const apiRepository = createApiRepositoryStub({
      addManualReserve: vi.fn(async () => ({ ok: true as const, value: { reserveId: 100 } })),
    })
    const goBack = vi.fn()

    const { result } = renderHook(() =>
      useManualReserveSubmit({
        mode: { kind: 'program', programId: 801 },
        apiRepository,
        onFetchFailure: vi.fn(),
        setError: vi.fn(),
        goBack,
      }),
    )

    await act(async () => {
      await result.current.submitForm(validFormState, undefined as never)
    })

    // Simulate an external generation bump (as useManualReserveLoader performs on route changes)
    // without also clearing the pending timer, to exercise the hook's own staleness guard.
    result.current.submitGenerationRef.current += 1

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000)
    })

    expect(goBack).not.toHaveBeenCalled()
  })
})
