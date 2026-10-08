import { describe, expect, it, vi } from 'vitest'
import { createFetchSearchRuleApiRepository } from '@/features/search/rule/api'
import { buildSearchRequestBody, createDefaultSearchFormState } from '@/features/search/rule/query'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'

describe('SearchRule API repository', () => {
  it('posts search body and adapts schedule search results', async () => {
    const fetcher = vi.fn(async () => {
      return new Response(
        JSON.stringify([
          {
            id: 1001,
            name: 'Synthetic Program',
            channelId: 12,
            channelName: 'Synthetic Channel',
            startAt: 1_700_000_000_000,
            endAt: 1_700_003_600_000,
            genre1: 7,
            subGenre1: 2,
            isFree: true,
          },
        ]),
        { status: 200 },
      )
    })
    const repository = createFetchSearchRuleApiRepository({ fetcher, basePath: '/api/' })
    const body = buildSearchRequestBody({
      form: {
        ...createDefaultSearchFormState(['GR']),
        keyword: 'Synthetic Program',
      },
      settings: new DefaultSettingsFactory().create(),
    })

    await expect(repository.searchSchedules(body)).resolves.toEqual({
      ok: true,
      value: [
        {
          id: 1001,
          name: 'Synthetic Program',
          channelId: 12,
          channelName: 'Synthetic Channel',
          startAt: 1_700_000_000_000,
          endAt: 1_700_003_600_000,
          genre1: 7,
          subGenre1: 2,
          isFree: true,
        },
      ],
    })
    expect(fetcher).toHaveBeenCalledWith('/api/schedules/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  })

  it('omits display-only channelNames from schedule search request bodies', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      void _init
      if (String(input) === '/api/schedules/search') {
        return new Response(JSON.stringify([]), { status: 200 })
      }

      return new Response(null, { status: 404 })
    })
    const repository = createFetchSearchRuleApiRepository({ fetcher, basePath: '/api' })

    await repository.searchSchedules({
      option: {
        keyword: 'Synthetic Rule Keyword',
        channelIds: [101],
        channelNames: ['Synthetic Rule Channel'],
        times: [{ week: 0x7f }],
      },
      isHalfWidth: true,
      limit: 300,
    })

    const searchBody = JSON.parse(
      String((fetcher.mock.calls[0]?.[1] as RequestInit | undefined)?.body),
    ) as { option: Record<string, unknown> }
    expect(searchBody.option).not.toHaveProperty('channelNames')
  })

  it('fetches reserve index and runs ProgramDialog reserve actions', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.startsWith('/api/reserves/lists')) {
        // Real shape of api.yml's `ReserveListItem`: the reserve id field is `reserveId`, never
        // `id` (`ReserveApiModel.toReserveListItem`, src/model/api/reserve/ReserveApiModel.ts).
        // A fixture keyed by `id` would let an adapter that also (incorrectly) required `id` pass:
        // matching fixture and implementation bugs would mask each other.
        return new Response(
          JSON.stringify({
            normal: [{ reserveId: 301, programId: 1001 }],
            conflicts: [],
            skips: [],
            overlaps: [],
          }),
          { status: 200 },
        )
      }
      if (url === '/api/reserves' && init?.method === 'POST') {
        return new Response(JSON.stringify({ reserveId: 401 }), { status: 200 })
      }
      if (url === '/api/reserves/301' && init?.method === 'DELETE') {
        return new Response(null, { status: 204 })
      }
      if (url === '/api/reserves/301/skip' && init?.method === 'DELETE') {
        return new Response(null, { status: 204 })
      }
      if (url === '/api/reserves/301/overlap' && init?.method === 'DELETE') {
        return new Response(null, { status: 204 })
      }

      return new Response(null, { status: 404 })
    })
    const repository = createFetchSearchRuleApiRepository({ fetcher, basePath: '/api' })

    await expect(repository.fetchReserveIndex({ startAt: 10, endAt: 20 })).resolves.toEqual({
      ok: true,
      value: {
        1001: {
          type: 'reserve',
          item: { id: 301, programId: 1001 },
        },
      },
    })
    await expect(
      repository.addProgramReserve({ programId: 1001, allowEndLack: true }),
    ).resolves.toEqual({
      ok: true,
      value: { reserveId: 401 },
    })
    await expect(repository.deleteReserve(301)).resolves.toEqual({
      ok: true,
      value: undefined,
    })
    await expect(repository.unlockSkipReserve(301)).resolves.toEqual({
      ok: true,
      value: undefined,
    })
    await expect(repository.unlockOverlapReserve(301)).resolves.toEqual({
      ok: true,
      value: undefined,
    })
  })
})
