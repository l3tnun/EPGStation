import { describe, expect, it } from 'vitest'
import { createFetchDashboardApiRepository } from '@/features/dashboard/dashboardApi'
import {
  DASHBOARD_FAILURE_MESSAGES,
  buildDashboardSummaryRequests,
  formatDashboardSectionTitle,
} from '@/features/dashboard/dashboardRequests'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'

describe('Dashboard request builder implementation edges', () => {
  it('uses saved summary settings and never mixes dashboard page query into offsets', () => {
    const settings = {
      ...new DefaultSettingsFactory().create(),
      isHalfWidthDisplayed: false,
      recordingLength: 3,
      recordedLength: 5,
      reservesLength: 7,
    }

    expect(
      buildDashboardSummaryRequests({
        settings,
        search: '?page=9&keyword=alpha&ruleId=12&channelId=34&genre=5&hasOriginalFile=true',
      }),
    ).toStrictEqual({
      reserveCounts: './api/reserves/cnts',
      recording: './api/recording?isHalfWidth=false&offset=0&limit=3',
      recorded:
        './api/recorded?isHalfWidth=false&offset=0&limit=5&keyword=alpha&ruleId=12&channelId=34&genre=5&hasOriginalFile=true',
      reserves: './api/reserves?type=normal&isHalfWidth=false&offset=0&limit=7',
    })
  })

  it('ignores malformed recorded filters while preserving false hasOriginalFile', () => {
    const settings = new DefaultSettingsFactory().create()

    expect(
      buildDashboardSummaryRequests({
        settings,
        search: '?ruleId=abc&channelId=&genre=NaN&hasOriginalFile=false',
        basePath: '/api',
      }).recorded,
    ).toBe('/api/recorded?isHalfWidth=true&offset=0&limit=24&hasOriginalFile=false')
  })

  it('formats section titles and keeps exact failure snackbar messages', () => {
    expect(formatDashboardSectionTitle('録画中', 0, 0)).toBe('録画中 0/0')
    expect(formatDashboardSectionTitle('予約', 2, 10)).toBe('予約 2/10')
    expect(DASHBOARD_FAILURE_MESSAGES).toStrictEqual({
      reserveCounts: '予約情報取得に失敗',
      recording: '録画中データ取得に失敗',
      recorded: '録画済みデータ取得に失敗',
      reserves: '予約データ取得に失敗',
    })
  })

  it('preserves delegated menu and summary rendering fields from dashboard fetch adapters', async () => {
    const responses = new Map<string, unknown>([
      [
        './api/reserves/cnts',
        {
          normal: 1,
          conflicts: 1,
          skips: 0,
          overlaps: 0,
        },
      ],
      [
        './api/recording?isHalfWidth=true&offset=0&limit=24',
        {
          records: [
            {
              id: 10,
              name: 'Recording',
              channelId: 1,
              channelName: 'Channel',
              startAt: 1_700_000_000_000,
              endAt: 1_700_003_600_000,
              description: 'Description',
              ruleId: 2,
              isProtected: true,
              isRecording: true,
              isEncoding: true,
              thumbnails: [100],
              dropLogFile: { id: 20, dropCnt: 1, errorCnt: 2, scramblingCnt: 3 },
              videoFiles: [{ id: 30, name: 'file.ts', size: 1024, type: 'ts', isOriginal: true }],
            },
          ],
          total: 1,
        },
      ],
      [
        './api/reserves?type=normal&isHalfWidth=true&offset=0&limit=24',
        {
          reserves: [
            {
              id: 40,
              name: 'Reserve',
              channelId: 4,
              channelType: 'BS',
              channelName: 'Reserve channel',
              startAt: 1_700_000_000_000,
              endAt: 1_700_003_600_000,
              description: 'Reserve description',
              extended: 'https://example.invalid',
              ruleId: 5,
              isSkip: true,
              genre1: 6,
              subGenre1: 7,
            },
          ],
          total: 1,
        },
      ],
    ])
    const repository = createFetchDashboardApiRepository({
      fetcher: async (input) =>
        new Response(JSON.stringify(responses.get(String(input)) ?? { records: [], total: 0 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    })
    const settings = new DefaultSettingsFactory().create()

    await expect(
      repository.fetchRecording({ isHalfWidth: true, offset: 0, limit: 24 }),
    ).resolves.toStrictEqual({
      ok: true,
      value: {
        records: [
          {
            id: 10,
            name: 'Recording',
            channelId: 1,
            channelName: 'Channel',
            startAt: 1_700_000_000_000,
            endAt: 1_700_003_600_000,
            description: 'Description',
            ruleId: 2,
            isProtected: true,
            isRecording: true,
            isEncoding: true,
            thumbnails: [100],
            dropLogFile: { id: 20, dropCnt: 1, errorCnt: 2, scramblingCnt: 3 },
            videoFiles: [{ id: 30, name: 'file.ts', size: 1024, type: 'ts', isOriginal: true }],
          },
        ],
        total: 1,
      },
    })
    await expect(
      repository.fetchReserves({ type: 'normal', isHalfWidth: true, offset: 0, limit: 24 }),
    ).resolves.toStrictEqual({
      ok: true,
      value: {
        reserves: [
          {
            id: 40,
            name: 'Reserve',
            channelId: 4,
            channelType: 'BS',
            channelName: 'Reserve channel',
            startAt: 1_700_000_000_000,
            endAt: 1_700_003_600_000,
            description: 'Reserve description',
            extended: 'https://example.invalid',
            ruleId: 5,
            genre1: 6,
            subGenre1: 7,
            isSkip: true,
            genres: ['genre 6/7'],
          },
        ],
        total: 1,
      },
    })
    expect(settings.isShowDropInfoInsteadOfDescription).toBe(false)
  })

  it('hydrates dashboard recording, recorded, and reserve channel labels from the shared channel index', async () => {
    const responses = new Map<string, unknown>([
      [
        './api/channels',
        [
          { id: 10, name: 'Full Width Channel', halfWidthName: 'Half Width Channel' },
          { id: 20, name: 'Reserve Channel' },
          { id: 30, name: 'Recording Channel' },
        ],
      ],
      [
        './api/recording?isHalfWidth=true&offset=0&limit=24',
        {
          records: [{ id: 3, name: 'Recording', channelId: 30 }],
          total: 1,
        },
      ],
      [
        './api/recorded?isHalfWidth=true&offset=0&limit=24',
        {
          records: [{ id: 1, name: 'Recorded', channelId: 10 }],
          total: 1,
        },
      ],
      [
        './api/reserves?type=normal&isHalfWidth=true&offset=0&limit=24',
        {
          reserves: [{ id: 2, name: 'Reserve', channelId: 20 }],
          total: 1,
        },
      ],
    ])
    const repository = createFetchDashboardApiRepository({
      fetcher: async (input) =>
        new Response(JSON.stringify(responses.get(String(input)) ?? { records: [], total: 0 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    })

    await expect(
      repository.fetchRecording({ isHalfWidth: true, offset: 0, limit: 24 }),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        records: [{ channelName: 'Recording Channel' }],
      },
    })
    await expect(
      repository.fetchRecorded({ isHalfWidth: true, offset: 0, limit: 24 }),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        records: [{ channelName: 'Half Width Channel' }],
      },
    })
    await expect(
      repository.fetchReserves({ type: 'normal', isHalfWidth: true, offset: 0, limit: 24 }),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        reserves: [{ channelName: 'Reserve Channel' }],
      },
    })
  })

  it('treats malformed reserve summary items as fetch failure', async () => {
    const repository = createFetchDashboardApiRepository({
      fetcher: async () =>
        new Response(JSON.stringify({ reserves: [{ name: 'Missing id' }], total: 1 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    })

    await expect(
      repository.fetchReserves({ type: 'normal', isHalfWidth: true, offset: 0, limit: 24 }),
    ).resolves.toStrictEqual({
      ok: false,
      error: 'reserves-fetch-failed',
      message: DASHBOARD_FAILURE_MESSAGES.reserves,
    })
  })
})
