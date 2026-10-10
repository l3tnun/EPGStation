import { describe, expect, it, vi } from 'vitest'
import { createFetchReservesApiRepository } from '@/features/reserves/reservesApi'
import {
  buildReserveEditPath,
  buildReserveGuidePath,
  buildReserveRecordedSearchPath,
  executeReserveBulkDeleteAction,
  linkifyReserveExtendedText,
  resolveReserveDeleteLabel,
  resolveReservesLayout,
  resolveReserveVisualState,
  toggleVisibleReserveSelection,
} from '@/features/reserves/reservesRequests'

describe('Reserve route and action helper implementation edges', () => {
  it('[AC 2.5] resolves reserve state priority before decoration visibility', () => {
    expect(
      resolveReserveVisualState({
        isSkip: true,
        isConflict: true,
        isOverlap: true,
      }),
    ).toStrictEqual({
      state: 'skip',
      className: 'skip',
    })
    expect(
      resolveReserveVisualState({
        isConflict: true,
        isOverlap: true,
      }),
    ).toStrictEqual({
      state: 'conflict',
      className: 'conflict',
    })
    expect(resolveReserveVisualState({ isOverlap: true })).toStrictEqual({
      state: 'overlap',
      className: 'overlap',
    })
    expect(resolveReserveVisualState({})).toStrictEqual({
      state: 'reserve',
      className: 'reserve',
    })
  })

  it('builds ReserveMenu routes from rule and manual reserve identity', () => {
    expect(buildReserveRecordedSearchPath({ ruleId: 501 })).toBe('/recorded?ruleId=501')
    expect(buildReserveRecordedSearchPath({})).toBe('/recorded')
    expect(buildReserveEditPath({ reserveId: 101 })).toBe('/reserves/manual?reserveId=101')
    expect(buildReserveEditPath({ reserveId: 101, ruleId: 501 })).toBe('/search?rule=501')
  })

  it('builds Guide route for reserve start hour with optional broadcast wave only when provided', () => {
    expect(
      buildReserveGuidePath({
        startAt: Date.parse('2026-05-05T10:15:00+09:00'),
      }),
    ).toBe('/guide?time=26050510')
    expect(
      buildReserveGuidePath({
        startAt: Date.parse('2026-05-05T10:15:00+09:00'),
        broadcastWave: 'BS',
      }),
    ).toBe('/guide?time=26050510&type=BS')
  })

  it('linkifies only safe http URLs in reserve extended text', () => {
    expect(
      linkifyReserveExtendedText(
        'alpha https://example.invalid/reserve-info beta javascript:alert(1)',
      ),
    ).toStrictEqual([
      { type: 'text', text: 'alpha ' },
      {
        type: 'link',
        text: 'https://example.invalid/reserve-info',
        href: 'https://example.invalid/reserve-info',
      },
      { type: 'text', text: ' beta javascript:alert(1)' },
    ])
  })

  it('toggles visible selection and preserves ids that still exist after refetch', () => {
    const selected = toggleVisibleReserveSelection({
      currentSelectedIds: new Set([101]),
      visibleReserveIds: [101, 102],
      action: 'select-all',
    })
    expect([...selected].sort()).toStrictEqual([101, 102])

    const cleared = toggleVisibleReserveSelection({
      currentSelectedIds: selected,
      visibleReserveIds: [101, 102],
      action: 'select-all',
    })
    expect([...cleared]).toStrictEqual([])

    const preserved = toggleVisibleReserveSelection({
      currentSelectedIds: new Set([101, 999]),
      visibleReserveIds: [101, 103],
      action: 'preserve-visible',
    })
    expect([...preserved]).toStrictEqual([101])
  })

  it('resolves delete fallback labels and responsive layout contracts', () => {
    expect(resolveReserveDeleteLabel({ id: 101, name: 'Synthetic reserve' })).toBe(
      'Synthetic reserve',
    )
    expect(resolveReserveDeleteLabel({ id: 102 })).toBe('予約id: 102')
    expect(resolveReservesLayout(915)).toBe('card')
    expect(resolveReservesLayout(916)).toBe('table')
    expect(resolveReservesLayout(916)).toBe('table')
  })

  it('executes bulk delete sequentially and reports zero, success, and partial failure statuses', async () => {
    const successfulRepository = {
      deleteReserve: vi.fn(async () => ({ ok: true as const, value: undefined })),
    }

    await expect(
      executeReserveBulkDeleteAction({
        apiRepository: successfulRepository,
        reserveIds: [],
      }),
    ).resolves.toStrictEqual({ status: 'zero-selection' })

    await expect(
      executeReserveBulkDeleteAction({
        apiRepository: successfulRepository,
        reserveIds: [101, 102],
      }),
    ).resolves.toStrictEqual({ status: 'success' })
    expect(successfulRepository.deleteReserve).toHaveBeenNthCalledWith(1, 101)
    expect(successfulRepository.deleteReserve).toHaveBeenNthCalledWith(2, 102)

    const failingRepository = {
      deleteReserve: vi
        .fn()
        .mockResolvedValueOnce({ ok: true as const, value: undefined })
        .mockResolvedValueOnce({
          ok: false as const,
          error: 'reserve-delete-failed' as const,
          message: '予約削除に失敗',
        }),
    }

    await expect(
      executeReserveBulkDeleteAction({
        apiRepository: failingRepository,
        reserveIds: [201, 202],
      }),
    ).resolves.toStrictEqual({ status: 'failure' })
    expect(failingRepository.deleteReserve).toHaveBeenCalledTimes(2)
  })

  it('executes delete, unlock, and update actions with the required methods and endpoints', async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 204 }))
    const repository = createFetchReservesApiRepository({ fetcher, basePath: '/api' })

    await expect(repository.deleteReserve(100)).resolves.toStrictEqual({
      ok: true,
      value: undefined,
    })
    await expect(repository.unlockSkipReserve(101)).resolves.toStrictEqual({
      ok: true,
      value: undefined,
    })
    await expect(repository.unlockOverlapReserve(102)).resolves.toStrictEqual({
      ok: true,
      value: undefined,
    })
    await expect(repository.updateReserves()).resolves.toStrictEqual({
      ok: true,
      value: undefined,
    })
    expect(fetcher).toHaveBeenNthCalledWith(1, '/api/reserves/100', { method: 'DELETE' })
    expect(fetcher).toHaveBeenNthCalledWith(2, '/api/reserves/101/skip', { method: 'DELETE' })
    expect(fetcher).toHaveBeenNthCalledWith(3, '/api/reserves/102/overlap', {
      method: 'DELETE',
    })
    expect(fetcher).toHaveBeenNthCalledWith(4, '/api/reserves/update', { method: 'POST' })
  })
})
