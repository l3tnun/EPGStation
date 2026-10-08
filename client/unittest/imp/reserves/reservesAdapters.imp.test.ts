import { describe, expect, it, vi } from 'vitest'
import { createFetchReservesApiRepository } from '@/features/reserves/reservesApi'

describe('Reserves API adapter implementation edges', () => {
  const request = {
    type: 'normal' as const,
    isHalfWidth: true,
    limit: 24,
    offset: 0,
    page: 1,
    routeType: 'normal' as const,
  }

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1, 1.5])(
    'rejects invalid total value %s as GET /reserves failure',
    async (total) => {
      const fetcher = vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              reserves: [{ id: 101, name: 'Synthetic reserve' }],
              total,
            }),
          ),
      )
      const repository = createFetchReservesApiRepository({ fetcher })

      await expect(repository.fetchReserves(request)).resolves.toStrictEqual({
        ok: false,
        error: 'reserves-fetch-failed',
        message: '予約データ取得に失敗',
      })
    },
  )

  it.each([
    {},
    { id: '101', name: 'Synthetic reserve' },
    { id: 1.5, name: 'Synthetic reserve' },
    { id: Number.MAX_SAFE_INTEGER + 1, name: 'Synthetic reserve' },
    { reserveId: Number.NaN, name: 'Synthetic reserve' },
  ])('rejects malformed reserve item %o as whole-list failure', async (item) => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            reserves: [{ id: 101, name: 'Synthetic reserve' }, item],
            total: 2,
          }),
        ),
    )
    const repository = createFetchReservesApiRepository({ fetcher })

    await expect(repository.fetchReserves(request)).resolves.toStrictEqual({
      ok: false,
      error: 'reserves-fetch-failed',
      message: '予約データ取得に失敗',
    })
  })

  it('accepts reserveId fallback and optional names in valid reserve items', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            reserves: [{ reserveId: 101 }, { id: 102, name: 'Synthetic reserve' }],
            total: 2,
          }),
        ),
    )
    const repository = createFetchReservesApiRepository({ fetcher })

    await expect(repository.fetchReserves(request)).resolves.toStrictEqual({
      ok: true,
      value: {
        reserves: [{ id: 101 }, { id: 102, name: 'Synthetic reserve' }],
        total: 2,
      },
    })
  })

  it('adapts API-shape channel and genre fields without requiring display-only names', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            reserves: [
              {
                id: 101,
                name: 'Synthetic reserve',
                channelId: 301,
                startAt: Date.parse('2026-05-05T10:15:00+09:00'),
                endAt: Date.parse('2026-05-05T10:45:00+09:00'),
                genre1: 7,
                subGenre1: 3,
                genre2: 8,
              },
            ],
            total: 1,
          }),
        ),
    )
    const repository = createFetchReservesApiRepository({ fetcher })

    await expect(repository.fetchReserves(request)).resolves.toStrictEqual({
      ok: true,
      value: {
        reserves: [
          {
            id: 101,
            name: 'Synthetic reserve',
            channelId: 301,
            startAt: Date.parse('2026-05-05T10:15:00+09:00'),
            endAt: Date.parse('2026-05-05T10:45:00+09:00'),
            genre1: 7,
            subGenre1: 3,
            genre2: 8,
            genres: ['genre 7/3', 'genre 8'],
          },
        ],
        total: 1,
      },
    })
  })

  it('drops invalid optional numeric fields before UI route/date formatting can consume them', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            reserves: [
              {
                id: 101,
                name: 'Synthetic reserve',
                channelId: -1,
                ruleId: -2,
                startAt: Number.MAX_VALUE,
                endAt: Date.parse('2026-05-05T10:45:00+09:00'),
                genre1: Number.MAX_SAFE_INTEGER + 1,
                subGenre1: -2,
                genre2: 8,
                subGenre2: 1.5,
              },
              {
                id: 102,
                name: 'Synthetic invalid end',
                channelId: Number.NaN,
                ruleId: 1.5,
                startAt: Date.parse('2026-05-05T11:00:00+09:00'),
                endAt: Number.MAX_VALUE,
              },
            ],
            total: 2,
          }),
        ),
    )
    const repository = createFetchReservesApiRepository({ fetcher })

    await expect(repository.fetchReserves(request)).resolves.toStrictEqual({
      ok: true,
      value: {
        reserves: [
          {
            id: 101,
            name: 'Synthetic reserve',
            endAt: Date.parse('2026-05-05T10:45:00+09:00'),
            genre2: 8,
            genres: ['genre 8'],
          },
          {
            id: 102,
            name: 'Synthetic invalid end',
            startAt: Date.parse('2026-05-05T11:00:00+09:00'),
          },
        ],
        total: 2,
      },
    })
  })
})
