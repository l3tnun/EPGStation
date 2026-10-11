import { describe, expect, it } from 'vitest'
import { createFetchDashboardApiRepository } from '@/features/dashboard/dashboardApi'
import { DASHBOARD_FAILURE_MESSAGES } from '@/features/dashboard/dashboardRequests'

const countsBody = { normal: 1, conflicts: 2, skips: 3, overlaps: 4 }
const recordsBody = { records: [{ id: 1, channelId: 7 }], total: 1 }
const reservesBody = { reserves: [{ id: 2, channelId: 7 }], total: 1 }
const listRequest = { isHalfWidth: true, offset: 0, limit: 24 }
const reservesRequest = { ...listRequest, type: 'normal' as const }

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

describe('Dashboard API request URLs', () => {
  it('drops one trailing slash of the base path before every endpoint', async () => {
    const urls: string[] = []
    const repository = createFetchDashboardApiRepository({
      basePath: '/api/',
      fetcher: async (input) => {
        urls.push(String(input))
        const url = String(input)
        if (url.startsWith('/api/channels')) return json([])
        if (url.startsWith('/api/reserves/cnts')) return json(countsBody)
        if (url.startsWith('/api/reserves')) return json(reservesBody)
        return json(recordsBody)
      },
    })

    await repository.fetchReserveCounts()
    await repository.fetchRecording(listRequest)
    await repository.fetchReserves(reservesRequest)

    expect(urls).toStrictEqual([
      '/api/reserves/cnts',
      '/api/recording?isHalfWidth=true&offset=0&limit=24',
      '/api/channels',
      '/api/reserves?isHalfWidth=true&offset=0&limit=24&type=normal',
    ])
  })
})

describe('Dashboard API failures', () => {
  it('reports a failure for a non-success status even when the body looks valid', async () => {
    const repository = createFetchDashboardApiRepository({
      fetcher: async (input) => {
        const url = String(input)
        if (url.includes('/reserves/cnts')) return json(countsBody, 500)
        if (url.includes('/reserves')) return json(reservesBody, 500)
        return json(recordsBody, 500)
      },
    })

    await expect(repository.fetchReserveCounts()).resolves.toStrictEqual({
      ok: false,
      error: 'reserve-counts-fetch-failed',
      message: DASHBOARD_FAILURE_MESSAGES.reserveCounts,
    })
    await expect(repository.fetchRecording(listRequest)).resolves.toMatchObject({
      ok: false,
      error: 'recording-fetch-failed',
    })
    await expect(repository.fetchRecorded(listRequest)).resolves.toMatchObject({
      ok: false,
      error: 'recorded-fetch-failed',
    })
    await expect(repository.fetchReserves(reservesRequest)).resolves.toStrictEqual({
      ok: false,
      error: 'reserves-fetch-failed',
      message: DASHBOARD_FAILURE_MESSAGES.reserves,
    })
  })

  it('reports a failure instead of rejecting when the network request throws', async () => {
    const repository = createFetchDashboardApiRepository({
      fetcher: async () => {
        throw new Error('network')
      },
    })

    await expect(repository.fetchReserveCounts()).resolves.toMatchObject({
      ok: false,
      error: 'reserve-counts-fetch-failed',
    })
  })

  it('returns the reserve counts as received', async () => {
    const repository = createFetchDashboardApiRepository({ fetcher: async () => json(countsBody) })

    await expect(repository.fetchReserveCounts()).resolves.toStrictEqual({
      ok: true,
      value: countsBody,
    })
  })
})

describe('Dashboard channel index priming', () => {
  it('uses the primed channel list and never requests the channels endpoint', async () => {
    const urls: string[] = []
    const repository = createFetchDashboardApiRepository({
      fetcher: async (input) => {
        urls.push(String(input))

        return String(input).includes('/reserves') ? json(reservesBody) : json(recordsBody)
      },
    })

    repository.primeChannelIndex?.(Promise.resolve([{ id: 7, name: 'Primed channel' }]))
    const recorded = await repository.fetchRecorded(listRequest)
    const reserves = await repository.fetchReserves(reservesRequest)

    expect(urls.some((url) => url.includes('/channels'))).toBe(false)
    expect(recorded).toMatchObject({
      ok: true,
      value: { records: [{ id: 1, channelId: 7, channelName: 'Primed channel' }] },
    })
    expect(reserves).toMatchObject({
      ok: true,
      value: { reserves: [{ id: 2, channelId: 7, channelName: 'Primed channel' }] },
    })
  })
})
