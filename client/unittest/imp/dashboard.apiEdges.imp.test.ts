import { describe, expect, it } from 'vitest'
import { createFetchDashboardApiRepository } from '@/features/dashboard/dashboardApi'
import { DASHBOARD_FAILURE_MESSAGES } from '@/features/dashboard/dashboardRequests'

describe('Dashboard fetch adapter edge branches', () => {
  it('[AC dashboard.api] drops query params with values other than string, number, or boolean', async () => {
    const requestedUrls: string[] = []
    const repository = createFetchDashboardApiRepository({
      fetcher: async (input) => {
        requestedUrls.push(String(input))

        return new Response(JSON.stringify({ records: [], total: 0 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      },
    })

    await repository.fetchRecorded({
      isHalfWidth: true,
      offset: 0,
      limit: 24,
      keyword: undefined,
    })

    expect(requestedUrls[0]).toBe('./api/recorded?isHalfWidth=true&offset=0&limit=24')
  })

  it('[AC dashboard.api] reports recording-fetch-failed when the recording response is malformed', async () => {
    const repository = createFetchDashboardApiRepository({
      fetcher: async () =>
        new Response(JSON.stringify({ records: 'not-an-array', total: 1 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    })

    await expect(
      repository.fetchRecording({ isHalfWidth: true, offset: 0, limit: 24 }),
    ).resolves.toStrictEqual({
      ok: false,
      error: 'recording-fetch-failed',
      message: DASHBOARD_FAILURE_MESSAGES.recording,
    })
  })

  it('[AC dashboard.api] reports recorded-fetch-failed when the recorded response is malformed', async () => {
    const repository = createFetchDashboardApiRepository({
      fetcher: async () =>
        new Response(JSON.stringify({ records: 'not-an-array', total: 1 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    })

    await expect(
      repository.fetchRecorded({ isHalfWidth: true, offset: 0, limit: 24 }),
    ).resolves.toStrictEqual({
      ok: false,
      error: 'recorded-fetch-failed',
      message: DASHBOARD_FAILURE_MESSAGES.recorded,
    })
  })

  it('[AC dashboard.api] caches the channel index promise across concurrent fetches', async () => {
    let channelFetchCount = 0
    const responses = new Map<string, unknown>([
      ['./api/channels', [{ id: 1, name: 'Channel' }]],
      ['./api/recording?isHalfWidth=true&offset=0&limit=24', { records: [], total: 0 }],
      ['./api/recorded?isHalfWidth=true&offset=0&limit=24', { records: [], total: 0 }],
    ])
    const repository = createFetchDashboardApiRepository({
      fetcher: async (input) => {
        const url = String(input)

        if (url === './api/channels') {
          channelFetchCount += 1
        }

        return new Response(JSON.stringify(responses.get(url) ?? { records: [], total: 0 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      },
    })

    await Promise.all([
      repository.fetchRecording({ isHalfWidth: true, offset: 0, limit: 24 }),
      repository.fetchRecorded({ isHalfWidth: true, offset: 0, limit: 24 }),
    ])

    expect(channelFetchCount).toBe(1)
  })
})
