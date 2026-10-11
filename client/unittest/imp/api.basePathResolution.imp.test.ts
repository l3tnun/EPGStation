import { describe, expect, it, vi } from 'vitest'
import { createFetchGuideApiRepository } from '@/features/guide/guideApi'
import { createFetchOnAirApiRepository } from '@/features/onair/onairApi'
import { createFetchRecordedApiRepository } from '@/features/recorded/recordedApi'
import { createFetchReservesApiRepository } from '@/features/reserves/reservesApi'
import { createFetchSearchRuleApiRepository } from '@/features/search/rule/api/repository'
import { createFetchStoragesApiRepository } from '@/features/storages/storagesApi'

function recordRequests() {
  const urls: string[] = []
  const fetcher = async (input: RequestInfo | URL) => {
    urls.push(String(input))

    return new Response(JSON.stringify({ items: [] }))
  }

  return { urls, fetcher }
}

describe('API base path resolution', () => {
  it('uses ./api when no base path is given', async () => {
    const recorded = recordRequests()
    await createFetchRecordedApiRepository({ fetcher: recorded.fetcher }).fetchRule(1)
    const reserves = recordRequests()
    await createFetchReservesApiRepository({ fetcher: reserves.fetcher }).updateReserves()
    const onair = recordRequests()
    await createFetchOnAirApiRepository({ fetcher: onair.fetcher }).deleteReserve(1)
    const storages = recordRequests()
    await createFetchStoragesApiRepository({ fetcher: storages.fetcher }).fetchStorages()
    const search = recordRequests()
    await createFetchSearchRuleApiRepository({ fetcher: search.fetcher }).deleteRule(1)

    expect(recorded.urls).toStrictEqual(['./api/rules/1'])
    expect(reserves.urls).toStrictEqual(['./api/reserves/update'])
    expect(onair.urls).toStrictEqual(['./api/reserves/1'])
    expect(storages.urls).toStrictEqual(['./api/storages'])
    expect(search.urls).toStrictEqual(['./api/rules/1'])
  })

  it('uses the global fetch when no fetcher is given', async () => {
    const globalFetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 204 }))

    await createFetchGuideApiRepository().triggerReserveUpdate()

    expect(globalFetch).toHaveBeenCalledWith('./api/reserves/update', { method: 'POST' })
    globalFetch.mockRestore()
  })

  it('uses the given base path for the storages request and the rule keyword request', async () => {
    const storages = recordRequests()
    await createFetchStoragesApiRepository({
      fetcher: storages.fetcher,
      basePath: '/custom/',
    }).fetchStorages()
    const recorded = recordRequests()
    await createFetchRecordedApiRepository({
      fetcher: recorded.fetcher,
      basePath: '/custom/',
    }).fetchRuleKeywords('k w')

    expect(storages.urls).toStrictEqual(['/custom/storages'])
    expect(recorded.urls).toStrictEqual(['/custom/rules/keyword?limit=1000&keyword=k+w'])
  })
})
