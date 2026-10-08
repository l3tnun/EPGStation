import { describe, expect, it } from 'vitest'
import {
  GUIDE_RESERVE_INDEX_QUERY_KEY,
  GUIDE_SCHEDULE_QUERY_KEY,
  buildGuideFetchRequestSet,
  buildGuideRequestUrls,
  buildGuideRouteWithTime,
  createGuideQueryKeys,
  formatGuideRouteTime,
  resolveGuideTitle,
  transformReserveListsToIndex,
} from '@/features/guide/guideRequests'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'
import { NOW } from './support/guideImpHarness'

describe('Guide request builder implementation edges', () => {
  it('formats Guide route time and preserves only valid filters in route update actions', () => {
    const startAt = Date.parse('2026-05-05T09:00:00+09:00')

    expect(formatGuideRouteTime(startAt)).toBe('26050509')
    expect(
      buildGuideRouteWithTime({
        time: Date.parse('2026-05-06T00:00:00+09:00'),
        currentQuery: {
          mode: 'singleChannel',
          startAt,
          isTimeQueryValid: true,
          type: 'BS',
          channelId: 301,
        },
      }),
    ).toBe('/guide?time=26050600&type=BS&channelId=301')
    expect(
      buildGuideRouteWithTime({
        time: Date.parse('2026-05-06T00:00:00+09:00'),
        currentQuery: {
          mode: 'normal',
          startAt,
          isTimeQueryValid: false,
        },
        selectedType: 'GR',
      }),
    ).toBe('/guide?time=26050600&type=GR')
  })

  it('builds a normal schedule request from valid route query and settings', () => {
    const settings = {
      ...new DefaultSettingsFactory().create(),
      isHalfWidthDisplayed: false,
      isShowOnlyFreePrograms: true,
      guideLength: 6,
    }

    expect(
      buildGuideFetchRequestSet({
        settings,
        search: '?type=BS&time=26050509',
        now: NOW,
      }),
    ).toStrictEqual({
      guideQuery: {
        mode: 'normal',
        type: 'BS',
        startAt: Date.parse('2026-05-05T09:00:00+09:00'),
        isTimeQueryValid: true,
      },
      schedule: {
        mode: 'normal',
        startAt: Date.parse('2026-05-05T09:00:00+09:00'),
        endAt: Date.parse('2026-05-05T15:00:00+09:00'),
        isHalfWidth: false,
        isFree: true,
        GR: false,
        BS: true,
        CS: false,
        SKY: false,
        BS4K: false,
      },
      reserveIndex: {
        startAt: Date.parse('2026-05-05T09:00:00+09:00'),
        endAt: Date.parse('2026-05-05T15:00:00+09:00'),
      },
    })
  })

  it('omits BS4K from the normal schedule request when BS4K is not an enabled broadcast wave', () => {
    const settings = new DefaultSettingsFactory().create()

    const requestSet = buildGuideFetchRequestSet({
      settings,
      search: '?time=26050509',
      now: NOW,
      enabledBroadcastWaves: ['GR', 'BS', 'CS', 'SKY'],
    })

    expect(requestSet.schedule).toMatchObject({
      GR: true,
      BS: true,
      CS: true,
      SKY: true,
      BS4K: false,
    })
  })

  it('includes BS4K in the "show all" normal schedule request when BS4K is an enabled broadcast wave', () => {
    const settings = new DefaultSettingsFactory().create()

    const requestSet = buildGuideFetchRequestSet({
      settings,
      search: '?time=26050509',
      now: NOW,
      enabledBroadcastWaves: ['GR', 'BS', 'CS', 'SKY', 'BS4K'],
    })

    expect(requestSet.schedule).toMatchObject({
      GR: true,
      BS: true,
      CS: true,
      SKY: true,
      BS4K: true,
    })
    expect(buildGuideRequestUrls({ requestSet, basePath: '/api/' }).schedule).toContain('BS4K=true')
  })

  it('requests only BS4K when the route selects the BS4K broadcast wave', () => {
    const settings = new DefaultSettingsFactory().create()

    const requestSet = buildGuideFetchRequestSet({
      settings,
      search: '?type=BS4K&time=26050509',
      now: NOW,
      enabledBroadcastWaves: ['GR', 'BS', 'CS', 'SKY', 'BS4K'],
    })

    expect(requestSet.schedule).toMatchObject({
      GR: false,
      BS: false,
      CS: false,
      SKY: false,
      BS4K: true,
    })
  })

  it('ignores invalid type, time, and channelId without leaking them to API or title state', () => {
    const settings = new DefaultSettingsFactory().create()
    const requestSet = buildGuideFetchRequestSet({
      settings,
      search: '?type=INVALID&time=not-a-date&channelId=-10',
      now: NOW,
    })

    expect(requestSet.guideQuery).toStrictEqual({
      mode: 'normal',
      startAt: Date.parse('2026-05-05T12:00:00+09:00'),
      isTimeQueryValid: false,
    })
    expect(requestSet.schedule).toMatchObject({
      mode: 'normal',
      GR: true,
      BS: true,
      CS: true,
      SKY: true,
    })
    expect(resolveGuideTitle(requestSet.guideQuery)).not.toContain('INVALID')
  })

  it('treats a previously rejected positive channelId as invalid and falls back to normal guide', () => {
    const settings = new DefaultSettingsFactory().create()
    const requestSet = buildGuideFetchRequestSet({
      settings,
      search: '?channelId=999999&time=26050509',
      invalidChannelIds: new Set([999999]),
      now: NOW,
    })

    expect(requestSet.guideQuery).toStrictEqual({
      mode: 'normal',
      startAt: Date.parse('2026-05-05T09:00:00+09:00'),
      isTimeQueryValid: true,
    })
    expect(requestSet.schedule).toMatchObject({
      mode: 'normal',
      GR: true,
      BS: true,
      CS: true,
      SKY: true,
    })
  })

  it('builds single-channel URLs with free-only filter and separate schedule/reserve keys', () => {
    const settings = {
      ...new DefaultSettingsFactory().create(),
      isHalfWidthDisplayed: true,
      isShowOnlyFreePrograms: true,
      guideLength: 12,
    }
    const requestSet = buildGuideFetchRequestSet({
      settings,
      search: '?type=GR&time=26050500&channelId=301',
      now: NOW,
    })

    expect(requestSet.schedule).toStrictEqual({
      mode: 'singleChannel',
      channelId: 301,
      startAt: Date.parse('2026-05-05T00:00:00+09:00'),
      days: 8,
      isHalfWidth: true,
      isFree: true,
    })
    expect(requestSet.reserveIndex).toStrictEqual({
      startAt: Date.parse('2026-05-05T00:00:00+09:00'),
      endAt: Date.parse('2026-05-13T00:00:00+09:00'),
    })
    expect(
      buildGuideRequestUrls({
        requestSet,
        basePath: '/api/',
      }),
    ).toStrictEqual({
      schedule: '/api/schedules/301?startAt=1777906800000&days=8&isHalfWidth=true&isFree=true',
      reserveIndex: '/api/reserves/lists?startAt=1777906800000&endAt=1778598000000',
    })
    expect(createGuideQueryKeys(requestSet)).toStrictEqual({
      schedule: [...GUIDE_SCHEDULE_QUERY_KEY, requestSet.schedule],
      reserveIndex: [...GUIDE_RESERVE_INDEX_QUERY_KEY, requestSet.reserveIndex],
    })
  })

  it('transforms reserve lists with later lists taking visible-state priority', () => {
    expect(
      transformReserveListsToIndex({
        normal: [{ id: 1, programId: 10, ruleId: 100 }],
        conflicts: [{ id: 2, programId: 10, ruleId: 200 }],
        skips: [{ id: 3, programId: 10, ruleId: 300 }],
        overlaps: [{ id: 4, programId: 10, ruleId: 400 }],
      }),
    ).toStrictEqual({
      10: {
        type: 'overlap',
        item: { id: 4, programId: 10, ruleId: 400 },
      },
    })
  })
})
