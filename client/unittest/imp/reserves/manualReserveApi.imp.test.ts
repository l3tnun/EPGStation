import { describe, expect, it, vi } from 'vitest'
import { createFetchReservesApiRepository } from '@/features/reserves/reservesApi'

describe('Manual reserve API implementation edges', () => {
  it('accepts current manual add response shape with reserveId', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ reserveId: 100 })))
    const repository = createFetchReservesApiRepository({
      fetcher,
      basePath: '/api',
    })

    await expect(
      repository.addManualReserve({ allowEndLack: true, programId: 100 }),
    ).resolves.toStrictEqual({
      ok: true,
      value: { reserveId: 100 },
    })
  })

  it('sends manual add and update payloads as JSON to the required endpoints', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ reserveId: 100 })))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ code: 201, message: 'ok' }), { status: 201 }),
      )
    const repository = createFetchReservesApiRepository({
      fetcher,
      basePath: '/api',
    })
    const addPayload = {
      allowEndLack: false,
      timeSpecifiedOption: {
        name: 'Synthetic manual reserve',
        channelId: 301,
        startAt: Date.parse('2026-05-05T10:15:00+09:00'),
        endAt: Date.parse('2026-05-05T10:45:00+09:00'),
      },
      saveOption: {},
    }
    const updatePayload = {
      allowEndLack: true,
      encodeOption: {
        mode1: 'h264',
        directory1: 'encoded',
        isDeleteOriginalAfterEncode: true,
      },
    }

    await repository.addManualReserve(addPayload)
    await repository.updateManualReserve(100, updatePayload)

    expect(fetcher).toHaveBeenNthCalledWith(1, '/api/reserves', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(addPayload),
    })
    expect(fetcher).toHaveBeenNthCalledWith(2, '/api/reserves/100', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(updatePayload),
    })
  })

  it('treats malformed manual add responses as failure', async () => {
    const malformedJsonFetcher = vi.fn(async () => new Response('{'))
    const malformedJsonRepository = createFetchReservesApiRepository({
      fetcher: malformedJsonFetcher,
      basePath: '/api',
    })

    await expect(
      malformedJsonRepository.addManualReserve({ allowEndLack: true, programId: 100 }),
    ).resolves.toStrictEqual({
      ok: false,
      error: 'manual-reserve-add-failed',
      message: '予約の追加に失敗しました。',
    })

    const malformedShapeFetcher = vi.fn(
      async () => new Response(JSON.stringify({ reserveId: '100' })),
    )
    const malformedShapeRepository = createFetchReservesApiRepository({
      fetcher: malformedShapeFetcher,
      basePath: '/api',
    })

    await expect(
      malformedShapeRepository.addManualReserve({ allowEndLack: true, programId: 100 }),
    ).resolves.toStrictEqual({
      ok: false,
      error: 'manual-reserve-add-failed',
      message: '予約の追加に失敗しました。',
    })

    const negativeIdFetcher = vi.fn(async () => new Response(JSON.stringify({ reserveId: -1 })))
    const negativeIdRepository = createFetchReservesApiRepository({
      fetcher: negativeIdFetcher,
      basePath: '/api',
    })

    await expect(
      negativeIdRepository.addManualReserve({ allowEndLack: true, programId: 100 }),
    ).resolves.toStrictEqual({
      ok: false,
      error: 'manual-reserve-add-failed',
      message: '予約の追加に失敗しました。',
    })
  })

  it('accepts current manual update response shape and 204 responses', async () => {
    const currentShapeFetcher = vi.fn(
      async () => new Response(JSON.stringify({ code: 201, message: 'ok' }), { status: 201 }),
    )
    const currentShapeRepository = createFetchReservesApiRepository({
      fetcher: currentShapeFetcher,
      basePath: '/api',
    })

    await expect(
      currentShapeRepository.updateManualReserve(100, { allowEndLack: true }),
    ).resolves.toStrictEqual({
      ok: true,
      value: undefined,
    })

    const noContentFetcher = vi.fn(async () => new Response(null, { status: 204 }))
    const noContentRepository = createFetchReservesApiRepository({
      fetcher: noContentFetcher,
      basePath: '/api',
    })

    await expect(
      noContentRepository.updateManualReserve(100, { allowEndLack: true }),
    ).resolves.toStrictEqual({
      ok: true,
      value: undefined,
    })
  })

  it('rejects invalid JSON and unsupported manual update response bodies', async () => {
    const okBodyWithWrongStatusFetcher = vi.fn(
      async () => new Response(JSON.stringify({ code: 201, message: 'ok' }), { status: 200 }),
    )
    const okBodyWithWrongStatusRepository = createFetchReservesApiRepository({
      fetcher: okBodyWithWrongStatusFetcher,
      basePath: '/api',
    })

    await expect(
      okBodyWithWrongStatusRepository.updateManualReserve(100, { allowEndLack: true }),
    ).resolves.toStrictEqual({
      ok: false,
      error: 'manual-reserve-update-failed',
      message: '予約の更新に失敗しました。',
    })

    const emptyObjectFetcher = vi.fn(async () => new Response(JSON.stringify({}), { status: 201 }))
    const emptyObjectRepository = createFetchReservesApiRepository({
      fetcher: emptyObjectFetcher,
      basePath: '/api',
    })

    await expect(
      emptyObjectRepository.updateManualReserve(100, { allowEndLack: true }),
    ).resolves.toStrictEqual({
      ok: false,
      error: 'manual-reserve-update-failed',
      message: '予約の更新に失敗しました。',
    })

    const unsupportedBodyFetcher = vi.fn(
      async () => new Response(JSON.stringify({ code: 201, message: 'ng' }), { status: 201 }),
    )
    const unsupportedBodyRepository = createFetchReservesApiRepository({
      fetcher: unsupportedBodyFetcher,
      basePath: '/api',
    })

    await expect(
      unsupportedBodyRepository.updateManualReserve(100, { allowEndLack: true }),
    ).resolves.toStrictEqual({
      ok: false,
      error: 'manual-reserve-update-failed',
      message: '予約の更新に失敗しました。',
    })

    const invalidJsonFetcher = vi.fn(async () => new Response('{'))
    const invalidJsonRepository = createFetchReservesApiRepository({
      fetcher: invalidJsonFetcher,
      basePath: '/api',
    })

    await expect(
      invalidJsonRepository.updateManualReserve(100, { allowEndLack: true }),
    ).resolves.toStrictEqual({
      ok: false,
      error: 'manual-reserve-update-failed',
      message: '予約の更新に失敗しました。',
    })
  })
})
