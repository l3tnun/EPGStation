import { describe, expect, it } from 'vitest'
import {
  buildSearchRequestBody,
  createDefaultSearchFormState,
  createDefaultSearchTimeReserveFormState,
  createSearchFormStateFromOption,
  createTimeSpecifiedSearchOption,
  restoreVisibleBroadcastWaves,
} from '@/features/search/rule/query'
import type { SearchApiOption, SearchFormState } from '@/features/search/rule/query'

const settings = { isHalfWidthDisplayed: true, searchLength: 30 }

function form(overrides: Partial<SearchFormState> = {}): SearchFormState {
  return { ...createDefaultSearchFormState(['GR', 'BS']), ...overrides }
}

describe('createTimeSpecifiedSearchOption', () => {
  const base = { ...createDefaultSearchTimeReserveFormState(), keyword: 'k', channelId: 1 }

  it('[AC 2.11] converts HH:MM texts to seconds, wraps ranges past midnight and sends week=0x7f for no weekday', () => {
    expect(
      createTimeSpecifiedSearchOption({ ...base, startTime: '01:30', endTime: '02:00' }),
    ).toEqual({
      keyword: 'k',
      channelIds: [1],
      times: [{ start: 5400, range: 1800, week: 0x7f }],
    })
    expect(
      createTimeSpecifiedSearchOption({ ...base, startTime: '23:00', endTime: '01:00' }).times[0]
        ?.range,
    ).toBe(7200)
    expect(
      createTimeSpecifiedSearchOption({
        ...base,
        startTime: '00:00',
        endTime: '00:00',
        weekdays: { ...base.weekdays, mon: true },
      }).times[0]?.week,
    ).toBe(0x02)
  })

  it('rejects blank keyword, missing channel, malformed or out-of-range times', () => {
    expect(() =>
      createTimeSpecifiedSearchOption({
        ...base,
        keyword: ' ',
        startTime: '01:00',
        endTime: '02:00',
      }),
    ).toThrow('TimeReserveOptionIsInvalidValue')
    expect(() =>
      createTimeSpecifiedSearchOption({
        ...base,
        channelId: null,
        startTime: '01:00',
        endTime: '02:00',
      }),
    ).toThrow()
    expect(() =>
      createTimeSpecifiedSearchOption({ ...base, startTime: null, endTime: '02:00' }),
    ).toThrow()
    expect(() =>
      createTimeSpecifiedSearchOption({ ...base, startTime: '1:00', endTime: '02:00' }),
    ).toThrow()
    expect(() =>
      createTimeSpecifiedSearchOption({ ...base, startTime: '24:00', endTime: '02:00' }),
    ).toThrow()
    expect(() =>
      createTimeSpecifiedSearchOption({ ...base, startTime: '01:00', endTime: '01:60' }),
    ).toThrow()
  })
})

describe('buildSearchRequestBody branches', () => {
  it('[AC 2.12] sends keyword targets, ignore keyword targets and legacy defaulting', () => {
    const body = buildSearchRequestBody({
      form: form({
        keyword: ' key ',
        keywordTargets: {
          keyCS: true,
          keyRegExp: true,
          name: false,
          description: false,
          extended: true,
        },
        ignoreKeyword: 'ign',
        ignoreKeywordTargets: {
          keyCS: false,
          keyRegExp: false,
          name: false,
          description: false,
          extended: false,
        },
      }),
      settings,
    })
    expect(body.option).toMatchObject({
      keyword: 'key',
      keyCS: true,
      keyRegExp: true,
      name: false,
      description: false,
      extended: true,
      ignoreKeyword: 'ign',
      ignoreName: true,
      ignoreDescription: true,
      ignoreExtended: false,
    })
  })

  it('[AC 2.14] uses broadcast waves only without channels and drops them when all visible waves are enabled', () => {
    const partial = buildSearchRequestBody({
      form: form({ broadcastWaves: { GR: true, BS: false } }),
      settings,
    })
    expect(partial.option).toMatchObject({ GR: true, BS: false })
    const all = buildSearchRequestBody({
      form: form({ broadcastWaves: { GR: true, BS: true } }),
      settings,
    })
    expect(all.option.GR).toBeUndefined()
    const channels = buildSearchRequestBody({
      form: form({ channelIds: [3], broadcastWaves: { GR: false, BS: false } }),
      settings,
    })
    expect(channels.option.channelIds).toEqual([3])
    expect(channels.option.GR).toBeUndefined()
    const none = buildSearchRequestBody({ form: form({ broadcastWaves: {} }), settings })
    expect(none.option.GR).toBeUndefined()
  })

  it('[AC 2.14] keeps the "omit when all visible waves enabled" rule with BS4K as a 5th visible wave', () => {
    const partial = buildSearchRequestBody({
      form: form({ broadcastWaves: { GR: true, BS: true, CS: true, SKY: true, BS4K: false } }),
      settings,
    })
    expect(partial.option).toMatchObject({ GR: true, BS: true, CS: true, SKY: true, BS4K: false })

    const allFive = buildSearchRequestBody({
      form: form({ broadcastWaves: { GR: true, BS: true, CS: true, SKY: true, BS4K: true } }),
      settings,
    })
    expect(allFive.option.GR).toBeUndefined()
    expect(allFive.option.BS4K).toBeUndefined()
  })

  it('[AC 2.11] sends genres, time start/range, durations, periods and isFree', () => {
    const body = buildSearchRequestBody({
      form: form({
        selectedGenres: [{ genre: 1, subGenre: 2 }],
        startTime: 5,
        durationMinutes: 6,
        weekdays: {
          sun: true,
          mon: false,
          tue: false,
          wed: false,
          thu: false,
          fri: false,
          sat: false,
        },
        durationMinMinutes: 7,
        durationMaxMinutes: 8,
        startPeriod: 9,
        endPeriod: 10,
        isFree: true,
      }),
      settings,
    })
    expect(body.option).toMatchObject({
      genres: [{ genre: 1, subGenre: 2 }],
      times: [{ week: 0x01, start: 5, range: 6 }],
      durationMin: 420,
      durationMax: 480,
      searchPeriods: [{ startAt: 9, endAt: 10 }],
      isFree: true,
    })
    expect(body.isHalfWidth).toBe(true)
    expect(body.limit).toBe(30)
  })

  it('restores every visible wave when none is enabled', () => {
    expect(
      restoreVisibleBroadcastWaves(form({ broadcastWaves: { GR: false, BS: false } }))
        .broadcastWaves,
    ).toEqual({ GR: true, BS: true })
    const unchanged = form({ broadcastWaves: { GR: true, BS: false } })
    expect(restoreVisibleBroadcastWaves(unchanged)).toBe(unchanged)
  })
})

describe('createSearchFormStateFromOption', () => {
  it('maps every option field back to the form state', () => {
    const option: SearchApiOption = {
      keyword: 'k',
      keyCS: true,
      keyRegExp: true,
      name: true,
      description: true,
      extended: true,
      ignoreKeyword: 'i',
      ignoreKeyCS: true,
      ignoreKeyRegExp: true,
      ignoreName: true,
      ignoreDescription: true,
      ignoreExtended: true,
      channelIds: [4],
      GR: true,
      genres: [{ genre: 2 }],
      times: [{ week: 0x02 | 0x40, start: 60, range: 120 }],
      durationMin: 600,
      durationMax: 1200,
      searchPeriods: [{ startAt: 1, endAt: 2 }],
      isFree: true,
    }
    const state = createSearchFormStateFromOption(option, ['GR', 'BS'])
    expect(state).toMatchObject({
      keyword: 'k',
      keywordTargets: {
        keyCS: true,
        keyRegExp: true,
        name: true,
        description: true,
        extended: true,
      },
      ignoreKeyword: 'i',
      ignoreKeywordTargets: {
        keyCS: true,
        keyRegExp: true,
        name: true,
        description: true,
        extended: true,
      },
      channelIds: [4],
      broadcastWaves: { GR: true, BS: false },
      selectedGenres: [{ genre: 2 }],
      startTime: 60,
      durationMinutes: 120,
      weekdays: {
        sun: false,
        mon: true,
        tue: false,
        wed: false,
        thu: false,
        fri: false,
        sat: true,
      },
      durationMinMinutes: 10,
      durationMaxMinutes: 20,
      startPeriod: 1,
      endPeriod: 2,
      isFree: true,
    })
  })

  it('falls back to defaults for an empty option', () => {
    const state = createSearchFormStateFromOption({ times: [] }, ['GR'])
    expect(state).toMatchObject({
      keyword: '',
      ignoreKeyword: '',
      channelIds: [],
      broadcastWaves: { GR: false },
      selectedGenres: [],
      startTime: null,
      durationMinutes: null,
      weekdays: { sun: true, mon: true, tue: true, wed: true, thu: true, fri: true, sat: true },
      durationMinMinutes: null,
      durationMaxMinutes: null,
      startPeriod: null,
      endPeriod: null,
      isFree: false,
    })
    expect(createSearchFormStateFromOption({ times: [{ week: 0 }] }, ['GR']).weekdays.sun).toBe(
      false,
    )
  })
})
