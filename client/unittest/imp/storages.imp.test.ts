import { describe, expect, it, vi } from 'vitest'
import { createFetchStoragesApiRepository } from '@/features/storages/storagesApi'
import {
  STORAGES_FAILURE_MESSAGE,
  buildStoragesRequestUrl,
  createStoragesQueryKey,
  formatStorageSize,
  toStorageUsageView,
} from '@/features/storages/storagesRequests'
import * as storagesRequests from '@/features/storages/storagesRequests'

describe('Storages implementation edges', () => {
  it('formats sizes with 1024 base and advances units while the value is at least 1000', () => {
    expect(formatStorageSize(0)).toBe('0.0B')
    expect(formatStorageSize(999)).toBe('999.0B')
    expect(formatStorageSize(1_000)).toBe('1.0KB')
    expect(formatStorageSize(1_024)).toBe('1.0KB')
    expect(formatStorageSize(1_024 * 1_024)).toBe('1.0MB')
    expect(formatStorageSize(1_024 ** 5)).toBe('1.0PB')
  })

  it('caps the unit at PB past 1024**5 instead of indexing past the unit table like v2', () => {
    // Source: v2 5cf2ea383 client/src/util/Util.ts:121-137 — fileSizeUnits has 6
    // entries (B..PB) but getFileSizeStr's loop condition `cnt <= fileSizeUnits.length` lets
    // cnt reach 6, so a value past PB reads fileSizeUnits[6] (undefined) and returns
    // `${size.toFixed(1)}undefined`. v3 intentionally stops advancing at PB instead.
    expect(formatStorageSize(1_024 ** 6)).toBe('1024.0PB')
    expect(formatStorageSize(1_024 ** 6)).not.toContain('undefined')
  })

  it('guards negative and non-finite sizes to 0.0B instead of propagating invalid values', () => {
    expect(formatStorageSize(-1)).toBe('0.0B')
    expect(formatStorageSize(Number.NaN)).toBe('0.0B')
    expect(formatStorageSize(Number.POSITIVE_INFINITY)).toBe('0.0B')
  })

  it('adapts usage display values with floor use rate and total zero guard', () => {
    expect(
      toStorageUsageView({
        name: 'Synthetic total storage',
        available: 1_024,
        used: 1_572_864,
        total: 2_097_152,
      }),
    ).toStrictEqual({
      name: 'Synthetic total storage',
      available: '1.0KB',
      used: '1.5MB',
      total: '2.0MB',
      useRate: 75,
    })
    expect(
      toStorageUsageView({
        name: 'Synthetic zero storage',
        available: 0,
        used: 512,
        total: 0,
      }),
    ).toStrictEqual({
      name: 'Synthetic zero storage',
      available: '0.0B',
      used: '512.0B',
      total: '0.0B',
      useRate: 0,
    })
  })

  it('exposes stable query keys and the fetch failure message', () => {
    expect(createStoragesQueryKey()).toStrictEqual(['storages'])
    expect(STORAGES_FAILURE_MESSAGE).toBe('ストレージ情報取得に失敗')
  })

  it('[A-6] no longer exports a viewport-width-driven storage layout, matching v2 Storages.vue having no such branch', () => {
    // v2 reference: client/src/views/Storages.vue has no viewport-width branch at all, and the
    // v3 640px breakpoint's only visual effect (`@media (max-width: 640px) { padding: 12px }`)
    // restated the same padding as the non-media-query default, i.e. it was a no-op.
    expect('resolveStorageLayout' in storagesRequests).toBe(false)
  })

  it('builds GET /storages with a single base path join and no query', () => {
    expect(buildStoragesRequestUrl()).toBe('./api/storages')
    expect(buildStoragesRequestUrl('/api/')).toBe('/api/storages')
  })

  it('executes GET /storages without query or body and validates typed payloads', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            items: [
              {
                name: 'Synthetic storage',
                available: 100,
                used: 200,
                total: 300,
              },
            ],
          }),
        ),
    )
    const repository = createFetchStoragesApiRepository({ fetcher, basePath: './api/' })

    await expect(repository.fetchStorages()).resolves.toStrictEqual({
      ok: true,
      value: {
        items: [
          {
            name: 'Synthetic storage',
            available: 100,
            used: 200,
            total: 300,
          },
        ],
      },
    })
    expect(fetcher).toHaveBeenCalledWith('./api/storages')
  })

  it('returns typed failure for invalid GET /storages payloads without throwing', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ items: [{ name: 'broken' }] })))
    const repository = createFetchStoragesApiRepository({ fetcher })

    await expect(repository.fetchStorages()).resolves.toStrictEqual({
      ok: false,
      error: 'storages-fetch-failed',
      message: 'ストレージ情報取得に失敗',
    })
  })

  it('returns typed failure for a non-object payload without throwing', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(null)))
    const repository = createFetchStoragesApiRepository({ fetcher })

    await expect(repository.fetchStorages()).resolves.toStrictEqual({
      ok: false,
      error: 'storages-fetch-failed',
      message: 'ストレージ情報取得に失敗',
    })
  })

  it('returns typed failure for a non-ok HTTP response with a well-formed payload', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(JSON.stringify({ items: [] }), {
          status: 500,
        }),
    )
    const repository = createFetchStoragesApiRepository({ fetcher })

    await expect(repository.fetchStorages()).resolves.toStrictEqual({
      ok: false,
      error: 'storages-fetch-failed',
      message: 'ストレージ情報取得に失敗',
    })
  })

  it('returns typed failure without throwing when the fetcher rejects', async () => {
    const fetcher = vi.fn(async () => {
      throw new Error('synthetic network failure')
    })
    const repository = createFetchStoragesApiRepository({ fetcher })

    await expect(repository.fetchStorages()).resolves.toStrictEqual({
      ok: false,
      error: 'storages-fetch-failed',
      message: 'ストレージ情報取得に失敗',
    })
  })

  it('uses the global fetch bound to globalThis when no fetcher option is provided', async () => {
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ items: [] })))
    vi.stubGlobal('fetch', fetchSpy)

    const repository = createFetchStoragesApiRepository()

    await expect(repository.fetchStorages()).resolves.toStrictEqual({
      ok: true,
      value: { items: [] },
    })
    expect(fetchSpy).toHaveBeenCalledWith('./api/storages')

    vi.unstubAllGlobals()
  })
})
