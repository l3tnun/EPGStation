import { describe, expect, it, vi } from 'vitest'
import { createFetchReservesApiRepository } from '@/features/reserves/reservesApi'
import {
  RESERVES_FAILURE_MESSAGE,
  buildReservesListRequest,
  buildReservesListRequestUrl,
  buildReservesPageSearch,
  createReservesQueryKey,
  resolveReservesTitle,
} from '@/features/reserves/reservesRequests'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'

describe('Reserves list request implementation edges', () => {
  const request = {
    type: 'normal' as const,
    isHalfWidth: true,
    limit: 24,
    offset: 0,
    page: 1,
    routeType: 'normal' as const,
  }

  it('maps route type query to API type and title', () => {
    const settings = {
      ...new DefaultSettingsFactory().create(),
      isHalfWidthDisplayed: false,
      reservesLength: 30,
    }

    expect(buildReservesListRequest({ settings, search: '' })).toStrictEqual({
      type: 'all',
      isHalfWidth: false,
      limit: 30,
      offset: 0,
      page: 1,
      routeType: undefined,
    })
    expect(buildReservesListRequest({ settings, search: '?type=conflict' })).toStrictEqual({
      type: 'conflict',
      isHalfWidth: false,
      limit: 30,
      offset: 0,
      page: 1,
      routeType: 'conflict',
    })
    expect(buildReservesListRequest({ settings, search: '?type=all' })).toStrictEqual({
      type: 'normal',
      isHalfWidth: false,
      limit: 30,
      offset: 0,
      page: 1,
      routeType: 'normal',
    })

    expect(resolveReservesTitle(undefined)).toBe('予約')
    expect(resolveReservesTitle('normal')).toBe('予約')
    expect(resolveReservesTitle('conflict')).toBe('競合')
    expect(resolveReservesTitle('overlap')).toBe('重複')
    expect(resolveReservesTitle('skip')).toBe('除外')
  })

  it('normalizes page query and builds GET /reserves parameters from settings', () => {
    const settings = {
      ...new DefaultSettingsFactory().create(),
      isHalfWidthDisplayed: true,
      reservesLength: 12,
    }

    expect(
      buildReservesListRequest({
        settings,
        search: '?type=skip&page=4&timestamp=999',
      }),
    ).toStrictEqual({
      type: 'skip',
      isHalfWidth: true,
      limit: 12,
      offset: 36,
      page: 4,
      routeType: 'skip',
    })
    expect(
      buildReservesListRequest({
        settings,
        search: '?type=overlap&page=-1',
      }),
    ).toStrictEqual({
      type: 'overlap',
      isHalfWidth: true,
      limit: 12,
      offset: 0,
      page: 1,
      routeType: 'overlap',
    })
    // AC1.13: a non-numeric page value clamps to page=1/offset=0 instead of
    // throwing like v2's Util.getPageNum did for NaN.
    expect(
      buildReservesListRequest({
        settings,
        search: '?type=overlap&page=abc',
      }),
    ).toStrictEqual({
      type: 'overlap',
      isHalfWidth: true,
      limit: 12,
      offset: 0,
      page: 1,
      routeType: 'overlap',
    })
    expect(
      buildReservesListRequestUrl({
        settings,
        search: '?type=normal&page=2&timestamp=999',
        basePath: '/api',
      }),
    ).toBe('/api/reserves?type=normal&isHalfWidth=true&limit=12&offset=12')
  })

  it('preserves type on page changes, omits timestamp, and exposes stable query keys', () => {
    const settings = new DefaultSettingsFactory().create()

    expect(
      buildReservesPageSearch({
        search: '?type=conflict&page=2&timestamp=999',
        page: 3,
      }),
    ).toBe('?type=conflict&page=3')
    expect(createReservesQueryKey({ settings, search: '?type=skip&page=2' })).toStrictEqual([
      'reserves',
      'list',
      '?type=skip&page=2',
      {
        type: 'skip',
        isHalfWidth: true,
        limit: 24,
        offset: 24,
        page: 2,
        routeType: 'skip',
      },
    ])
    expect(RESERVES_FAILURE_MESSAGE).toBe('予約データ取得に失敗')
  })

  it('adapts invalid GET /reserves payloads to typed fetch failure without throwing', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({})))
    const repository = createFetchReservesApiRepository({ fetcher })

    await expect(repository.fetchReserves(request)).resolves.toStrictEqual({
      ok: false,
      error: 'reserves-fetch-failed',
      message: '予約データ取得に失敗',
    })
  })

  it('executes GET /reserves with the normalized request URL and no mutation options', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            reserves: [{ id: 101, name: 'Synthetic reserve' }],
            total: 1,
          }),
        ),
    )
    const repository = createFetchReservesApiRepository({ fetcher, basePath: '/api/' })

    await expect(repository.fetchReserves(request)).resolves.toStrictEqual({
      ok: true,
      value: {
        reserves: [{ id: 101, name: 'Synthetic reserve' }],
        total: 1,
      },
    })
    expect(fetcher).toHaveBeenCalledWith(
      '/api/reserves?type=normal&isHalfWidth=true&limit=24&offset=0',
    )
  })

  it('hydrates reserve channel labels from the shared channel index', async () => {
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      const path = String(url)

      if (path === '/api/channels') {
        return new Response(JSON.stringify([{ id: 10, halfWidthName: 'Synthetic channel' }]))
      }

      return new Response(
        JSON.stringify({
          reserves: [{ id: 101, name: 'Synthetic reserve', channelId: 10 }],
          total: 1,
        }),
      )
    })
    const repository = createFetchReservesApiRepository({ fetcher, basePath: '/api' })

    await expect(repository.fetchReserves(request)).resolves.toStrictEqual({
      ok: true,
      value: {
        reserves: [
          {
            id: 101,
            name: 'Synthetic reserve',
            channelId: 10,
            channelName: 'Synthetic channel',
          },
        ],
        total: 1,
      },
    })
    expect(fetcher).toHaveBeenNthCalledWith(2, '/api/channels')
  })
})
