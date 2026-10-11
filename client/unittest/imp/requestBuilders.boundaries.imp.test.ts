import { describe, expect, it } from 'vitest'
import {
  buildDashboardSummaryRequestSet,
  buildDashboardSummaryRequests,
} from '@/features/dashboard/dashboardRequests'
import {
  buildEncodeListRequestUrl,
  createEncodeSectionItems,
  ENCODE_FAILURE_MESSAGE,
  type EncodeProgramItem,
} from '@/features/encode/encodeRequests'
import { parseOptionalNumber } from '@/features/recorded/lib/recordedRoute'
import {
  buildRecordedDetailRequestUrl,
  buildRecordedListRequest,
  buildRecordedListRequestUrl,
  buildRuleKeywordRequestUrl,
} from '@/features/recorded/requests/listRequest'
import {
  buildRecordingListRequestUrl,
  buildRecordingListRequestUrlFromRequest,
  RECORDING_FAILURE_MESSAGE,
} from '@/features/recording/recordingRequests'
import {
  buildReservesListRequestUrl,
  buildReservesListRequestUrlFromRequest,
  RESERVES_FAILURE_MESSAGE,
  RESERVES_UPDATE_FAILURE_MESSAGE,
  RESERVES_UPDATE_STARTED_MESSAGE,
  resolveReservesTitle,
} from '@/features/reserves/lib/reservesListRequests'
import { STORAGES_FAILURE_MESSAGE } from '@/features/storages/storagesRequests'
import { DefaultSettingsFactory } from '@/shared/settings'
import type { RecordedListItem } from '@/features/recorded/recordedApi'

const settings = new DefaultSettingsFactory().create()

describe('list request URLs: base path handling', () => {
  it('uses ./api when no base path is given', () => {
    expect(buildRecordedDetailRequestUrl({ recordedId: 5, isHalfWidth: true })).toBe(
      './api/recorded/5?isHalfWidth=true',
    )
    expect(buildRecordedListRequestUrl({ settings, search: '' })).toMatch(/^\.\/api\/recorded\?/)
    expect(buildRuleKeywordRequestUrl({ keyword: 'k' })).toBe(
      './api/rules/keyword?limit=1000&keyword=k',
    )
    expect(buildRecordingListRequestUrl({ settings, search: '' })).toMatch(/^\.\/api\/recording\?/)
    expect(
      buildRecordingListRequestUrlFromRequest({
        request: { isHalfWidth: false, limit: 3, offset: 6, page: 3 },
      }),
    ).toBe('./api/recording?isHalfWidth=false&limit=3&offset=6')
    expect(buildReservesListRequestUrl({ settings, search: '' })).toMatch(/^\.\/api\/reserves\?/)
    expect(
      buildReservesListRequestUrlFromRequest({
        request: {
          type: 'all',
          isHalfWidth: true,
          limit: 1,
          offset: 0,
          page: 1,
          routeType: undefined,
        },
      }),
    ).toBe('./api/reserves?type=all&isHalfWidth=true&limit=1&offset=0')
    expect(buildEncodeListRequestUrl({ request: { isHalfWidth: true } })).toBe(
      './api/encode?isHalfWidth=true',
    )
  })

  it('drops one trailing slash from the base path', () => {
    expect(buildRuleKeywordRequestUrl({ keyword: 'k', basePath: '/x/' })).toBe(
      '/x/rules/keyword?limit=1000&keyword=k',
    )
    expect(
      buildRecordingListRequestUrlFromRequest({
        request: { isHalfWidth: false, limit: 3, offset: 6, page: 3 },
        basePath: '/x/',
      }),
    ).toBe('/x/recording?isHalfWidth=false&limit=3&offset=6')
    expect(buildRecordingListRequestUrl({ settings, search: '', basePath: '/x/' })).toMatch(
      /^\/x\/recording\?/,
    )
    expect(buildDashboardSummaryRequests({ settings, search: '', basePath: '/x/' })).toMatchObject({
      reserveCounts: '/x/reserves/cnts',
    })
  })
})

describe('recorded list request: optional filters', () => {
  it('omits every filter that is not in the search', () => {
    expect(buildRecordedListRequest({ settings, search: '' })).toStrictEqual({
      isHalfWidth: settings.isHalfWidthDisplayed,
      limit: settings.recordedLength,
      offset: 0,
      page: 1,
    })
  })
})

describe('dashboard recorded request: optional filters', () => {
  it('omits keyword and numeric filters that are absent, empty or not integers', () => {
    const expected = {
      isHalfWidth: settings.isHalfWidthDisplayed,
      offset: 0,
      limit: settings.recordedLength,
    }
    for (const search of ['', '?ruleId=&channelId=&genre=', '?ruleId=abc&channelId=1.5&genre=x']) {
      expect(buildDashboardSummaryRequestSet({ settings, search }).recorded).toStrictEqual(expected)
    }
  })

  it('builds the recorded URL with only the parameters that are present', () => {
    const plain = buildDashboardSummaryRequests({ settings, search: '' }).recorded
    expect(plain).toBe(
      `./api/recorded?isHalfWidth=${settings.isHalfWidthDisplayed}&offset=0&limit=${settings.recordedLength}`,
    )

    const noisy = buildDashboardSummaryRequests({
      settings,
      search: '?ruleId=&channelId=abc&genre=7',
    }).recorded
    expect(noisy).toBe(`${plain}&genre=7`)
  })
})

describe('list failure messages and reserve titles', () => {
  it('keeps the user-facing texts', () => {
    expect(RESERVES_FAILURE_MESSAGE).toBe('予約データ取得に失敗')
    expect(RESERVES_UPDATE_STARTED_MESSAGE).toBe('予約情報の更新開始')
    expect(RESERVES_UPDATE_FAILURE_MESSAGE).toBe('予約情報の更新を開始できませんでした。')
    expect(RECORDING_FAILURE_MESSAGE).toBe('録画データ取得に失敗')
    expect(ENCODE_FAILURE_MESSAGE).toBe('エンコード情報取得に失敗')
    expect(STORAGES_FAILURE_MESSAGE).toBe('ストレージ情報取得に失敗')
  })

  it('titles each reserve list type', () => {
    expect(resolveReservesTitle(undefined)).toBe('予約')
    expect(resolveReservesTitle('normal')).toBe('予約')
    expect(resolveReservesTitle('conflict')).toBe('競合')
    expect(resolveReservesTitle('overlap')).toBe('重複')
    expect(resolveReservesTitle('skip')).toBe('除外')
  })
})

describe('recorded route id parsing', () => {
  it('treats a missing or empty value as no id', () => {
    expect(parseOptionalNumber(null)).toBeNull()
    expect(parseOptionalNumber('')).toBeNull()
    expect(parseOptionalNumber('0')).toBe(0)
    expect(parseOptionalNumber('x')).toBeNull()
  })
})

describe('encode list display items', () => {
  const recorded = (patch: Partial<RecordedListItem>): RecordedListItem =>
    ({ id: 1, name: 'n', channelName: 'c', ...patch }) as RecordedListItem
  const itemOf = (patch: Partial<EncodeProgramItem> & { recorded?: RecordedListItem }) =>
    ({ id: 7, mode: 'm', recorded: recorded({}), ...patch }) as EncodeProgramItem

  it('shows the time range and the length in minutes when start and end are known', () => {
    const start = new Date(2026, 9, 11, 9, 5).getTime()
    const end = start + 90 * 60 * 1000 + 30 * 1000
    const [item] = createEncodeSectionItems({
      runningItems: [itemOf({ recorded: recorded({ startAt: start, endAt: end }) })],
      waitItems: [],
    }).running

    expect(item.timeText).toMatch(/^10\/11\(.\) 09:05 ~ 10:35$/)
    expect(item.durationText).toBe('90 m')
  })

  it('leaves the time and length out unless both start and end are numbers', () => {
    const items = createEncodeSectionItems({
      runningItems: [
        itemOf({ recorded: recorded({ startAt: 1000 }) }),
        itemOf({ recorded: recorded({ endAt: 1000 }) }),
        itemOf({ recorded: recorded({}) }),
      ],
      waitItems: [],
    }).running

    for (const item of items) {
      expect(item.timeText).toBeUndefined()
      expect(item.durationText).toBeUndefined()
    }
  })

  it('uses no thumbnail when the list is missing or empty, and the first one otherwise', () => {
    const items = createEncodeSectionItems({
      runningItems: [
        itemOf({ recorded: recorded({ thumbnails: undefined }) }),
        itemOf({ recorded: recorded({ thumbnails: [] }) }),
        itemOf({ recorded: recorded({ thumbnails: [3, 4] }) }),
      ],
      waitItems: [],
    }).running

    expect(items.map((item) => item.thumbnailPath)).toStrictEqual([
      null,
      null,
      './api/thumbnails/3',
    ])
  })

  it('shows progress only when both the percentage and the log are present', () => {
    const items = createEncodeSectionItems({
      runningItems: [
        itemOf({ percent: 0.5 }),
        itemOf({ log: 'line' }),
        itemOf({ percent: 0.256, log: 'line' }),
      ],
      waitItems: [],
    }).running

    expect(items[0].progressValue).toBeUndefined()
    expect(items[0].progressText).toBeUndefined()
    expect(items[1].progressValue).toBeUndefined()
    expect(items[1].progressText).toBeUndefined()
    expect(items[2].progressValue).toBeCloseTo(25.6)
    expect(items[2].progressText).toBe('25% line')
  })
})
