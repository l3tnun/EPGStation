import { describe, expect, it } from 'vitest'
import { createSearchFormStateFromOption } from '@/features/search/rule/lib/searchFormState'

const WEEK_BITS = [
  ['sun', 0x01],
  ['mon', 0x02],
  ['tue', 0x04],
  ['wed', 0x08],
  ['thu', 0x10],
  ['fri', 0x20],
  ['sat', 0x40],
] as const

describe('search form state from a stored rule option', () => {
  it('maps every keyword and ignore keyword flag when all are true', () => {
    const form = createSearchFormStateFromOption(
      {
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
        times: [],
      },
      [],
    )

    expect(form.keywordTargets).toStrictEqual({
      keyCS: true,
      keyRegExp: true,
      name: true,
      description: true,
      extended: true,
    })
    expect(form.ignoreKeywordTargets).toStrictEqual({
      keyCS: true,
      keyRegExp: true,
      name: true,
      description: true,
      extended: true,
    })
  })

  it('maps every flag to false when the option omits them', () => {
    const form = createSearchFormStateFromOption({ times: [] }, [])
    const off = { keyCS: false, keyRegExp: false, name: false, description: false, extended: false }

    expect(form.keywordTargets).toStrictEqual(off)
    expect(form.ignoreKeywordTargets).toStrictEqual(off)
    expect(form.keyword).toBe('')
    expect(form.ignoreKeyword).toBe('')
    expect(form.isFree).toBe(false)
  })

  it('maps each flag independently', () => {
    const form = createSearchFormStateFromOption(
      { ignoreName: true, extended: true, times: [] },
      [],
    )

    expect(form.keywordTargets).toStrictEqual({
      keyCS: false,
      keyRegExp: false,
      name: false,
      description: false,
      extended: true,
    })
    expect(form.ignoreKeywordTargets).toStrictEqual({
      keyCS: false,
      keyRegExp: false,
      name: true,
      description: false,
      extended: false,
    })
  })

  it('enables every weekday when there is no time entry', () => {
    const form = createSearchFormStateFromOption({ times: [] }, [])

    expect(form.weekdays).toStrictEqual({
      sun: true,
      mon: true,
      tue: true,
      wed: true,
      thu: true,
      fri: true,
      sat: true,
    })
    expect(form.startTime).toBeNull()
    expect(form.durationMinutes).toBeNull()
  })

  it('enables every weekday for the all-days week value', () => {
    const form = createSearchFormStateFromOption({ times: [{ week: 0x7f }] }, [])

    expect(Object.values(form.weekdays)).toStrictEqual([true, true, true, true, true, true, true])
  })

  it.each(WEEK_BITS)('enables only %s when the week value is its single bit', (day, bit) => {
    const form = createSearchFormStateFromOption({ times: [{ week: bit }] }, [])

    for (const [name] of WEEK_BITS) {
      expect(form.weekdays[name]).toBe(name === day)
    }
  })

  it('disables every weekday for a week value of zero', () => {
    const form = createSearchFormStateFromOption({ times: [{ week: 0 }] }, [])

    expect(Object.values(form.weekdays)).toStrictEqual([
      false,
      false,
      false,
      false,
      false,
      false,
      false,
    ])
  })

  it('enables the weekdays of a combined week value only', () => {
    const form = createSearchFormStateFromOption({ times: [{ week: 0x02 | 0x10 | 0x40 }] }, [])

    expect(form.weekdays).toStrictEqual({
      sun: false,
      mon: true,
      tue: false,
      wed: false,
      thu: true,
      fri: false,
      sat: true,
    })
  })

  it('reads the start time and range from the first time entry', () => {
    const form = createSearchFormStateFromOption(
      {
        times: [
          { week: 1, start: 5, range: 3 },
          { week: 2, start: 9, range: 9 },
        ],
      },
      [],
    )

    expect(form.startTime).toBe(5)
    expect(form.durationMinutes).toBe(3)
  })

  it('reads the first search period and falls back to null for an empty list', () => {
    const withPeriods = createSearchFormStateFromOption(
      {
        times: [],
        searchPeriods: [
          { startAt: 100, endAt: 200 },
          { startAt: 300, endAt: 400 },
        ],
      },
      [],
    )
    const empty = createSearchFormStateFromOption({ times: [], searchPeriods: [] }, [])

    expect(withPeriods.startPeriod).toBe(100)
    expect(withPeriods.endPeriod).toBe(200)
    expect(empty.startPeriod).toBeNull()
    expect(empty.endPeriod).toBeNull()
  })

  it('converts durations from seconds to whole minutes and keeps zero', () => {
    const form = createSearchFormStateFromOption(
      { times: [], durationMin: 0, durationMax: 659 },
      [],
    )

    expect(form.durationMinMinutes).toBe(0)
    expect(form.durationMaxMinutes).toBe(10)
  })

  it('reads broadcast waves only for the visible waves', () => {
    const form = createSearchFormStateFromOption({ times: [], GR: true, CS: true }, ['GR', 'BS'])

    expect(form.broadcastWaves).toStrictEqual({ GR: true, BS: false })
  })

  it('copies channel ids and genres instead of sharing them', () => {
    const option = {
      times: [],
      channelIds: [1, 2],
      genres: [{ genre: 1, subGenre: 0 }],
    }
    const form = createSearchFormStateFromOption(option, [])

    expect(form.channelIds).toStrictEqual([1, 2])
    expect(form.channelIds).not.toBe(option.channelIds)
    expect(form.selectedGenres).toStrictEqual([{ genre: 1, subGenre: 0 }])
    expect(form.selectedGenres).not.toBe(option.genres)
  })
})
