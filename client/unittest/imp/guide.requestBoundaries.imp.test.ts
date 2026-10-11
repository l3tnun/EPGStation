import { describe, expect, it } from 'vitest'
import {
  createGuideDateOptions,
  formatDayLabel,
  HOUR_MS,
} from '@/features/guide/lib/guideDate'
import {
  buildGuideFetchRequestSet,
  createJapanTimestamp,
  createNormalScheduleRequest,
  formatGuideRouteTime,
  parseChannelId,
  parseGuideTime,
  resolveStartAt,
} from '@/features/guide/lib/guideRoute'
import {
  appendBooleanFilter,
  appendPathNumber,
  buildGuideRequestUrls,
  createGuideProgramSearchKeyword,
} from '@/features/guide/lib/guideUrls'
import { DefaultSettingsFactory } from '@/shared/settings'

const settings = new DefaultSettingsFactory().create()

describe('guide route: channel id and time parsing', () => {
  it('accepts only positive integer channel ids that are not marked invalid', () => {
    expect(parseChannelId('5', new Set())).toBe(5)
    expect(parseChannelId('0', new Set())).toBeUndefined()
    expect(parseChannelId('-1', new Set())).toBeUndefined()
    expect(parseChannelId('1.5', new Set())).toBeUndefined()
    expect(parseChannelId('', new Set())).toBeUndefined()
    expect(parseChannelId(null, new Set())).toBeUndefined()
    expect(parseChannelId('5', new Set([5]))).toBeUndefined()
  })

  it('pads a single-digit month and day in the route time', () => {
    expect(formatGuideRouteTime(createJapanTimestamp(2026, 3, 5, 1))).toBe('26030501')
    expect(formatGuideRouteTime(createJapanTimestamp(2026, 11, 25, 21))).toBe('26112521')
    expect(formatGuideRouteTime(createJapanTimestamp(2005, 3, 5, 1))).toBe('05030501')
  })

  it('has no time when the query is missing', () => {
    expect(parseGuideTime(null)).toBeUndefined()
  })

  it.each(['123', '261003123', 'a26100312', '2610031a', ''])(
    'marks %j as an invalid time without a start',
    (value) => {
      expect(parseGuideTime(value)).toStrictEqual({ startAt: Number.NaN, isValid: false })
    },
  )

  it('rejects an hour of 24 without a start and accepts 23', () => {
    expect(parseGuideTime('26100324')).toStrictEqual({ startAt: Number.NaN, isValid: false })
    expect(parseGuideTime('26100323')).toStrictEqual({
      startAt: createJapanTimestamp(2026, 10, 3, 23),
      isValid: true,
    })
  })

  it.each(['26130100', '26000100', '26023000', '26043100', '26030000', '26013200'])(
    'marks the impossible date %s as invalid but keeps its start',
    (value) => {
      const parsed = parseGuideTime(value)

      expect(parsed?.isValid).toBe(false)
      expect(Number.isNaN(parsed?.startAt)).toBe(false)
    },
  )

  it('falls back to the current hour when the time query is missing or invalid', () => {
    const now = createJapanTimestamp(2026, 10, 3, 15) + 25 * 60 * 1000
    const hourStart = createJapanTimestamp(2026, 10, 3, 15)

    expect(resolveStartAt(new URLSearchParams(), now)).toStrictEqual({
      startAt: hourStart,
      isTimeQueryValid: true,
    })
    expect(resolveStartAt(new URLSearchParams('time=zz'), now)).toStrictEqual({
      startAt: hourStart,
      isTimeQueryValid: false,
    })
    expect(resolveStartAt(new URLSearchParams('time=26010102'), now)).toStrictEqual({
      startAt: createJapanTimestamp(2026, 1, 1, 2),
      isTimeQueryValid: true,
    })
  })
})

describe('guide normal schedule request', () => {
  const startAt = createJapanTimestamp(2026, 10, 3, 15)

  it('requests every wave but BS4K when no type is given and BS4K is not enabled', () => {
    expect(createNormalScheduleRequest({ settings, type: undefined, startAt })).toStrictEqual({
      mode: 'normal',
      startAt,
      endAt: startAt + settings.guideLength * HOUR_MS,
      isHalfWidth: settings.isHalfWidthDisplayed,
      isFree: settings.isShowOnlyFreePrograms,
      GR: true,
      BS: true,
      CS: true,
      SKY: true,
      BS4K: false,
    })
  })

  it('includes BS4K without a type only when it is enabled, and never with a type', () => {
    expect(
      createNormalScheduleRequest({ settings, type: undefined, startAt, enabledBroadcastWaves: ['BS4K'] }).BS4K,
    ).toBe(true)
    expect(
      createNormalScheduleRequest({ settings, type: 'GR', startAt, enabledBroadcastWaves: ['BS4K'] }),
    ).toMatchObject({ GR: true, BS: false, CS: false, SKY: false, BS4K: false })
    expect(
      createNormalScheduleRequest({ settings, type: 'BS4K', startAt, enabledBroadcastWaves: ['BS4K'] }).BS4K,
    ).toBe(true)
  })

  it('reads the enabled waves from the fetch request set', () => {
    const set = buildGuideFetchRequestSet({
      settings,
      search: '',
      now: startAt,
      enabledBroadcastWaves: ['BS4K'],
    })

    expect(set.schedule).toMatchObject({ mode: 'normal', BS4K: true })
    expect(
      buildGuideFetchRequestSet({ settings, search: '', now: startAt }).schedule,
    ).toMatchObject({ BS4K: false })
  })
})

describe('guide request URLs', () => {
  const normal = {
    guideQuery: { mode: 'normal', startAt: 1000, isTimeQueryValid: true },
    schedule: {
      mode: 'normal',
      startAt: 1000,
      endAt: 2000,
      isHalfWidth: true,
      isFree: false,
      GR: true,
      BS: false,
      CS: true,
      SKY: false,
      BS4K: true,
    },
    reserveIndex: { startAt: 1000, endAt: 2000 },
  } as never
  const single = {
    guideQuery: { mode: 'singleChannel', startAt: 1000, isTimeQueryValid: true },
    schedule: {
      mode: 'singleChannel',
      channelId: 7,
      startAt: 1000,
      days: 7,
      isHalfWidth: false,
      isFree: true,
    },
    reserveIndex: { startAt: 1000, endAt: 3000 },
  } as never

  it('lists every wave flag of a normal schedule, with ./api as the default base', () => {
    expect(buildGuideRequestUrls({ requestSet: normal })).toStrictEqual({
      schedule:
        './api/schedules?startAt=1000&endAt=2000&isHalfWidth=true&GR=true&BS=false&CS=true&SKY=false&BS4K=true',
      reserveIndex: './api/reserves/lists?startAt=1000&endAt=2000',
    })
  })

  it('adds the free-only filter of a normal schedule only when it is on', () => {
    const freeOnly = {
      ...(normal as unknown as { schedule: object }),
      schedule: { ...(normal as unknown as { schedule: object }).schedule, isFree: true },
    } as never

    expect(buildGuideRequestUrls({ requestSet: freeOnly }).schedule).toBe(
      './api/schedules?startAt=1000&endAt=2000&isHalfWidth=true&isFree=true&GR=true&BS=false&CS=true&SKY=false&BS4K=true',
    )
  })

  it('adds the free-only filter only when it is on, and addresses a single channel by id', () => {
    expect(buildGuideRequestUrls({ requestSet: single, basePath: '/x/' })).toStrictEqual({
      schedule: '/x/schedules/7?startAt=1000&days=7&isHalfWidth=false&isFree=true',
      reserveIndex: '/x/reserves/lists?startAt=1000&endAt=3000',
    })
  })

  it('appends a boolean filter only when it is true', () => {
    const on = new URLSearchParams()
    const off = new URLSearchParams()
    appendBooleanFilter(on, 'k', true)
    appendBooleanFilter(off, 'k', false)

    expect(on.toString()).toBe('k=true')
    expect(off.toString()).toBe('')
  })

  it('appends a path number only for a non-negative integer', () => {
    const appended = (value: number | undefined) => {
      const parameters = new URLSearchParams()
      appendPathNumber(parameters, 'k', value)
      return parameters.toString()
    }

    expect(appended(0)).toBe('k=0')
    expect(appended(3)).toBe('k=3')
    expect(appended(-1)).toBe('')
    expect(appended(1.5)).toBe('')
    expect(appended(undefined)).toBe('')
  })
})

describe('guide program search keyword', () => {
  it('replaces bracketed marks with one space and collapses spaces', () => {
    expect(createGuideProgramSearchKeyword('Foo[新]Bar')).toBe('Foo Bar')
    expect(createGuideProgramSearchKeyword('Foo[ab]Bar')).toBe('Foo Bar')
    expect(createGuideProgramSearchKeyword('Foo【ab】Bar')).toBe('Foo Bar')
    expect(createGuideProgramSearchKeyword('Foo(字)Bar')).toBe('Foo Bar')
    expect(createGuideProgramSearchKeyword('A     B')).toBe('A B')
  })

  it('cuts the sub title after a quotation mark or a hash and keeps a title that would become empty', () => {
    expect(createGuideProgramSearchKeyword('作品「副題」')).toBe('作品')
    expect(createGuideProgramSearchKeyword('作品 #3')).toBe('作品')
    expect(createGuideProgramSearchKeyword('「副題」')).toBe('「副題」')
  })
})

describe('guide date options', () => {
  it('labels each weekday in Japanese', () => {
    const labels = Array.from({ length: 7 }, (_, index) =>
      formatDayLabel(createJapanTimestamp(2026, 10, 11 + index, 12)),
    )

    expect(labels).toStrictEqual([
      '10/11(日)',
      '10/12(月)',
      '10/13(火)',
      '10/14(水)',
      '10/15(木)',
      '10/16(金)',
      '10/17(土)',
    ])
  })

  it('keeps the current hour on the first option and starts later days at midnight', () => {
    const base = createJapanTimestamp(2026, 10, 3, 15)
    const options = createGuideDateOptions(base)

    expect(HOUR_MS).toBe(3_600_000)
    expect(options).toHaveLength(8)
    expect(options[0].dayStartAt).toBe(createJapanTimestamp(2026, 10, 3, 0))
    expect(options[0].value).toBe(base)
    expect(options[0].routeTime).toBe('26100315')
    expect(options[0].dayRouteTime).toBe('26100300')
    expect(options[1].value).toBe(createJapanTimestamp(2026, 10, 4, 0))
    expect(options[1].routeTime).toBe('26100400')
  })
})
