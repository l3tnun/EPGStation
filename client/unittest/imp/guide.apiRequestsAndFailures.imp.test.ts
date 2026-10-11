import { describe, expect, it } from 'vitest'
import { createFetchGuideApiRepository } from '@/features/guide/guideApi'
import { GUIDE_FETCH_FAILURE_MESSAGE } from '@/features/guide/guideRequests'

interface RecordedCall {
  url: string
  init?: RequestInit
}

function createRecordingFetcher(respond: (call: RecordedCall) => Response | Promise<Response>) {
  const calls: RecordedCall[] = []
  const fetcher = async (url: RequestInfo | URL, init?: RequestInit) => {
    const call = { url: String(url), init }
    calls.push(call)

    return respond(call)
  }

  return { calls, fetcher }
}

const emptyJson = () => new Response(JSON.stringify([]))

describe('Guide API request URLs', () => {
  it('requests the schedule of every broadcast wave with the selected filters', async () => {
    const { calls, fetcher } = createRecordingFetcher(emptyJson)
    const repository = createFetchGuideApiRepository({ fetcher, basePath: '/api/' })

    await repository.fetchSchedule({
      mode: 'normal',
      startAt: 1_000,
      endAt: 2_000,
      isHalfWidth: false,
      isFree: true,
      GR: true,
      BS: false,
      CS: true,
      SKY: false,
      BS4K: true,
    })

    expect(calls.map((call) => call.url)).toStrictEqual([
      '/api/schedules?startAt=1000&endAt=2000&isHalfWidth=false&isFree=true&GR=true&BS=false&CS=true&SKY=false&BS4K=true',
    ])
  })

  it('requests a single channel for the given number of days', async () => {
    const { calls, fetcher } = createRecordingFetcher(emptyJson)
    const repository = createFetchGuideApiRepository({ fetcher, basePath: '/api' })

    await repository.fetchSchedule({
      mode: 'singleChannel',
      channelId: 7,
      startAt: 1_000,
      days: 3,
      isHalfWidth: true,
      isFree: false,
    })

    expect(calls.map((call) => call.url)).toStrictEqual([
      '/api/schedules/7?startAt=1000&days=3&isHalfWidth=true',
    ])
  })

  it('requests the reserve index for the given period', async () => {
    const lists = () =>
      new Response(JSON.stringify({ normal: [], conflicts: [], skips: [], overlaps: [] }))
    const { calls, fetcher } = createRecordingFetcher(lists)
    const repository = createFetchGuideApiRepository({ fetcher, basePath: '/api/' })

    await repository.fetchReserveIndex({ startAt: 1_000, endAt: 2_000 })
    await repository.fetchReserveIndex({
      mode: 'normal',
      startAt: 5_000,
      endAt: 6_000,
      isHalfWidth: true,
      isFree: false,
      GR: true,
      BS: true,
      CS: true,
      SKY: true,
      BS4K: true,
    } as never)
    await repository.fetchReserveIndex({
      mode: 'singleChannel',
      channelId: 3,
      startAt: 1_000,
      days: 2,
      isHalfWidth: true,
      isFree: false,
    } as never)

    expect(calls.map((call) => call.url)).toStrictEqual([
      '/api/reserves/lists?startAt=1000&endAt=2000',
      '/api/reserves/lists?startAt=5000&endAt=6000',
      `/api/reserves/lists?startAt=1000&endAt=${1_000 + 2 * 24 * 60 * 60 * 1000}`,
    ])
  })
})

describe('Guide API failure results', () => {
  const normalRequest = {
    mode: 'normal' as const,
    startAt: 1_000,
    endAt: 2_000,
    isHalfWidth: true,
    isFree: false,
    GR: true,
    BS: true,
    CS: true,
    SKY: true,
    BS4K: true,
  }
  const singleChannelRequest = {
    mode: 'singleChannel' as const,
    channelId: 9,
    startAt: 1_000,
    days: 1,
    isHalfWidth: true,
    isFree: false,
  }

  it('reports a missing channel only for a single channel request answered with 404', async () => {
    const notFound = createRecordingFetcher(() => new Response(null, { status: 404 }))
    const serverError = createRecordingFetcher(() => new Response(null, { status: 500 }))

    await expect(
      createFetchGuideApiRepository({ fetcher: notFound.fetcher }).fetchSchedule(
        singleChannelRequest,
      ),
    ).resolves.toStrictEqual({
      ok: false,
      error: 'guide-channel-not-found',
      message: GUIDE_FETCH_FAILURE_MESSAGE,
    })
    await expect(
      createFetchGuideApiRepository({ fetcher: notFound.fetcher }).fetchSchedule(normalRequest),
    ).resolves.toStrictEqual({
      ok: false,
      error: 'guide-schedule-fetch-failed',
      message: GUIDE_FETCH_FAILURE_MESSAGE,
    })
    await expect(
      createFetchGuideApiRepository({ fetcher: serverError.fetcher }).fetchSchedule(
        singleChannelRequest,
      ),
    ).resolves.toStrictEqual({
      ok: false,
      error: 'guide-schedule-fetch-failed',
      message: GUIDE_FETCH_FAILURE_MESSAGE,
    })
  })

  it('returns typed failures instead of throwing when the network request rejects', async () => {
    const { fetcher } = createRecordingFetcher(() => {
      throw new Error('network')
    })
    const repository = createFetchGuideApiRepository({ fetcher })

    await expect(repository.fetchSchedule(normalRequest)).resolves.toStrictEqual({
      ok: false,
      error: 'guide-schedule-fetch-failed',
      message: GUIDE_FETCH_FAILURE_MESSAGE,
    })
    await expect(repository.fetchSchedule(singleChannelRequest)).resolves.toStrictEqual({
      ok: false,
      error: 'guide-schedule-fetch-failed',
      message: GUIDE_FETCH_FAILURE_MESSAGE,
    })
    await expect(
      repository.fetchReserveIndex({ startAt: 1_000, endAt: 2_000 }),
    ).resolves.toStrictEqual({
      ok: false,
      error: 'guide-reserve-index-fetch-failed',
      message: GUIDE_FETCH_FAILURE_MESSAGE,
    })
    await expect(
      repository.addProgramReserve({ programId: 1, allowEndLack: true }),
    ).resolves.toStrictEqual({
      ok: false,
      error: 'guide-program-reserve-add-failed',
      message: '予約失敗',
    })
  })

  it('reports each failed action with its own message', async () => {
    const { fetcher } = createRecordingFetcher(() => new Response(null, { status: 500 }))
    const repository = createFetchGuideApiRepository({ fetcher })

    await expect(repository.triggerReserveUpdate()).resolves.toStrictEqual({
      ok: false,
      error: 'guide-reserve-update-failed',
      message: '予約情報の更新を開始できませんでした。',
    })
    await expect(repository.deleteReserve(1)).resolves.toStrictEqual({
      ok: false,
      error: 'guide-reserve-delete-failed',
      message: 'キャンセル失敗',
    })
    await expect(repository.unlockSkipReserve(1)).resolves.toStrictEqual({
      ok: false,
      error: 'guide-reserve-unskip-failed',
      message: '除外解除失敗',
    })
    await expect(repository.unlockOverlapReserve(1)).resolves.toStrictEqual({
      ok: false,
      error: 'guide-reserve-unoverlap-failed',
      message: '重複解除失敗',
    })
  })
})

describe('Guide API action requests', () => {
  it('sends the reserve update and add requests to the reserve endpoints without a doubled slash', async () => {
    const { calls, fetcher } = createRecordingFetcher(
      () => new Response(JSON.stringify({ reserveId: 4 })),
    )
    const repository = createFetchGuideApiRepository({ fetcher, basePath: '/api/' })

    await expect(repository.triggerReserveUpdate()).resolves.toStrictEqual({ ok: true, value: {} })
    await expect(
      repository.addProgramReserve({ programId: 2, allowEndLack: true }),
    ).resolves.toStrictEqual({ ok: true, value: { reserveId: 4 } })
    await expect(repository.deleteReserve(5)).resolves.toStrictEqual({
      ok: true,
      value: undefined,
    })

    expect(calls.map((call) => [call.url, call.init?.method])).toStrictEqual([
      ['/api/reserves/update', 'POST'],
      ['/api/reserves', 'POST'],
      ['/api/reserves/5', 'DELETE'],
    ])
    expect(calls[1]?.init?.headers).toStrictEqual({ 'Content-Type': 'application/json' })
  })

  it('uses ./api as the default base path', async () => {
    const { calls, fetcher } = createRecordingFetcher(() => new Response(null, { status: 204 }))
    const repository = createFetchGuideApiRepository({ fetcher })

    await repository.triggerReserveUpdate()

    expect(calls.map((call) => call.url)).toStrictEqual(['./api/reserves/update'])
  })
})
