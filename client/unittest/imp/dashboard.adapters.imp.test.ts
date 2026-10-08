import { describe, expect, it, vi } from 'vitest'
import { createFetchDashboardApiRepository } from '@/features/dashboard/dashboardApi'
import {
  adaptRecordsResponse,
  adaptChannelIndex,
} from '@/features/dashboard/lib/dashboardRecordedAdapters'
import {
  adaptReserveCounts,
  adaptReservesResponse,
  hydrateReserveChannelNames,
} from '@/features/dashboard/lib/dashboardReserveAdapters'
import { buildDashboardSummaryRequests } from '@/features/dashboard/dashboardRequests'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body))
}

describe('Dashboard reserve adapters', () => {
  it('copies every typed reserve field and derives genre labels from genre codes', () => {
    const full = {
      id: 1,
      programId: 2,
      name: 'n',
      channelId: 3,
      channelName: 'c',
      channelType: 'BS',
      startAt: 4,
      endAt: 5,
      description: 'd',
      extended: 'e',
      ruleId: 6,
      genre1: 7,
      subGenre1: 8,
      genre2: 9,
      subGenre2: 10,
      genre3: 11,
      subGenre3: 12,
      isConflict: true,
      isSkip: false,
      isOverlap: true,
      isTimeSpecified: false,
      allowEndLack: true,
      parentDirectoryName: 'p',
      directory: 'dir',
      recordedFormat: 'f',
      encodeMode1: 'm1',
      encodeParentDirectoryName1: 'p1',
      encodeDirectory1: 'd1',
      encodeMode2: 'm2',
      encodeParentDirectoryName2: 'p2',
      encodeDirectory2: 'd2',
      encodeMode3: 'm3',
      encodeParentDirectoryName3: 'p3',
      encodeDirectory3: 'd3',
      isDeleteOriginalAfterEncode: true,
    }
    const adapted = adaptReservesResponse({ reserves: [full], total: 1 })
    expect(adapted?.reserves[0]).toStrictEqual({
      ...full,
      genres: ['genre 7/8', 'genre 9/10', 'genre 11/12'],
    })

    const mistyped = Object.fromEntries(Object.keys(full).map((key) => [key, { bad: true }]))
    expect(adaptReservesResponse({ reserves: [{ ...mistyped, id: 12 }], total: 1 })).toStrictEqual({
      reserves: [{ id: 12 }],
      total: 1,
    })
    expect(
      adaptReservesResponse({
        reserves: [{ id: 13, channelType: 'GR', genres: ['given', 4] }],
        total: 9,
      }),
    ).toStrictEqual({ reserves: [{ id: 13, channelType: 'GR', genres: ['given'] }], total: 9 })
    expect(
      adaptReservesResponse({ reserves: [{ id: 14, channelType: 'CS' }], total: 1 }),
    ).toStrictEqual({
      reserves: [{ id: 14, channelType: 'CS' }],
      total: 1,
    })
    expect(
      adaptReservesResponse({ reserves: [{ id: 15, channelType: 'SKY' }], total: 1 }),
    ).toStrictEqual({
      reserves: [{ id: 15, channelType: 'SKY' }],
      total: 1,
    })
    expect(
      adaptReservesResponse({ reserves: [{ id: 18, channelType: 'BS4K' }], total: 1 }),
    ).toStrictEqual({
      reserves: [{ id: 18, channelType: 'BS4K' }],
      total: 1,
    })
    expect(adaptReservesResponse({ reserves: [{ id: 16, genres: [] }], total: 1 })).toStrictEqual({
      reserves: [{ id: 16 }],
      total: 1,
    })
    expect(adaptReservesResponse({ reserves: [{ id: 17, genre1: 20 }], total: 1 })).toStrictEqual({
      reserves: [{ id: 17, genre1: 20, genres: ['genre 20'] }],
      total: 1,
    })
  })

  it('rejects malformed reserve lists and counts', () => {
    expect(adaptReservesResponse('text')).toBeNull()
    expect(adaptReservesResponse({ reserves: 'x', total: 1 })).toBeNull()
    expect(adaptReservesResponse({ reserves: [], total: 'x' })).toBeNull()
    expect(adaptReservesResponse({ reserves: ['bad'], total: 1 })).toBeNull()
    expect(adaptReservesResponse({ reserves: [{ id: 'x' }], total: 1 })).toBeNull()
    expect(adaptReserveCounts(null)).toBeNull()
    expect(adaptReserveCounts({ normal: 1, conflicts: 2, skips: 3 })).toBeNull()
    expect(adaptReserveCounts({ normal: 1, conflicts: 2, skips: 3, overlaps: 4 })).toStrictEqual({
      normal: 1,
      conflicts: 2,
      skips: 3,
      overlaps: 4,
    })
  })

  it('[AC dashboard.reserveAdapters] hydrates only reserves missing a channel name with a resolvable id', () => {
    const channelIndex = new Map([[9, 'Resolved channel']])
    const response = hydrateReserveChannelNames(
      {
        reserves: [
          { id: 1, channelId: 9 },
          { id: 2, channelName: 'Already named', channelId: 9 },
          { id: 3 },
        ],
        total: 3,
      },
      channelIndex,
    )

    expect(response).toStrictEqual({
      reserves: [
        { id: 1, channelId: 9, channelName: 'Resolved channel' },
        { id: 2, channelName: 'Already named', channelId: 9 },
        { id: 3 },
      ],
      total: 3,
    })
  })
})

describe('Dashboard recorded adapters', () => {
  it('copies typed recorded fields and drops mistyped ones', () => {
    const adapted = adaptRecordsResponse({
      total: 3,
      records: [
        {
          id: 1,
          name: 'n',
          channelId: 2,
          channelName: 'c',
          startAt: 3,
          endAt: 4,
          description: 'd',
          extended: 'e',
          ruleId: 5,
          isProtected: true,
          isRecording: false,
          isEncoding: true,
          thumbnails: [1, 'x'],
          dropLogFile: { dropCnt: 1, errorCnt: 2, scramblingCnt: 3 },
          videoFiles: [
            { id: 6, name: 'v', filename: 'v.ts', size: 7, type: 'ts', isOriginal: false },
            { id: 'x', name: 1, filename: 2, size: '7', type: 3, isOriginal: 'no' },
            'bad',
          ],
        },
        {
          id: 'x',
          name: 1,
          channelId: 'c',
          channelName: 2,
          startAt: 's',
          endAt: 'e',
          description: 3,
          extended: 4,
          ruleId: 'r',
          isProtected: 'p',
          isRecording: 'r',
          isEncoding: 'e',
          thumbnails: 'none',
          dropLogFile: { dropCnt: 1, errorCnt: 2, id: 9 },
          videoFiles: 'none',
        },
        'bad',
      ],
    })
    expect(adapted).toStrictEqual({
      total: 3,
      records: [
        {
          id: 1,
          name: 'n',
          channelId: 2,
          channelName: 'c',
          startAt: 3,
          endAt: 4,
          description: 'd',
          extended: 'e',
          ruleId: 5,
          isProtected: true,
          isRecording: false,
          isEncoding: true,
          thumbnails: [1],
          dropLogFile: { id: undefined, dropCnt: 1, errorCnt: 2, scramblingCnt: 3 },
          videoFiles: [
            { id: 6, name: 'v', filename: 'v.ts', size: 7, type: 'ts', isOriginal: false },
            {},
            {},
          ],
        },
        {},
        {},
      ],
    })
    expect(
      adaptRecordsResponse({
        total: 1,
        records: [{ dropLogFile: { id: 9, dropCnt: 1, errorCnt: 2, scramblingCnt: 3 } }],
      })?.records[0]?.dropLogFile,
    ).toStrictEqual({ id: 9, dropCnt: 1, errorCnt: 2, scramblingCnt: 3 })
    expect(adaptRecordsResponse('text')).toBeNull()
    expect(adaptRecordsResponse({ records: 'x', total: 1 })).toBeNull()
    expect(adaptRecordsResponse({ records: [], total: 'x' })).toBeNull()
  })

  it('indexes channels by half-width name first and skips malformed entries', () => {
    expect(adaptChannelIndex('text').size).toBe(0)
    const index = adaptChannelIndex([
      { id: 1, name: 'Full', halfWidthName: 'Half' },
      { id: 2, name: 'OnlyFull' },
      { id: 3 },
      { id: 'x', name: 'bad' },
      'bad',
    ])
    expect([...index.entries()]).toStrictEqual([
      [1, 'Half'],
      [2, 'OnlyFull'],
    ])
  })

  it('treats non-ok and throwing transports as fetch failures and falls back to global fetch', async () => {
    const fetcher = vi.fn<(url: RequestInfo | URL) => Promise<Response>>()
    const repository = createFetchDashboardApiRepository({ fetcher, basePath: '/api' })
    fetcher.mockResolvedValueOnce(new Response(null, { status: 500 }))
    await expect(repository.fetchReserveCounts()).resolves.toMatchObject({ ok: false })
    fetcher.mockRejectedValueOnce(new Error('network'))
    await expect(repository.fetchReserveCounts()).resolves.toMatchObject({ ok: false })

    const globalFetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ normal: 0, conflicts: 0, skips: 0, overlaps: 0 }))
    await expect(createFetchDashboardApiRepository().fetchReserveCounts()).resolves.toStrictEqual({
      ok: true,
      value: { normal: 0, conflicts: 0, skips: 0, overlaps: 0 },
    })
    expect(globalFetch).toHaveBeenCalledWith('./api/reserves/cnts')
    globalFetch.mockRestore()
  })
})

describe('Dashboard request filters', () => {
  it('drops non-integer and empty recorded filters', () => {
    const settings = new DefaultSettingsFactory().create()
    expect(
      buildDashboardSummaryRequests({
        settings,
        search: '?ruleId=1.5&channelId=7&genre=&keyword=k',
        basePath: '/api',
      }).recorded,
    ).toBe('/api/recorded?isHalfWidth=true&offset=0&limit=24&keyword=k&channelId=7')
  })
})
