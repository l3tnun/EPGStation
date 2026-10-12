import { describe, expect, it } from 'vitest'
import {
  applyLegacyKeywordTargetDefaults,
  applySearchRouteQuery,
  createDefaultSearchFormState,
  createDefaultSearchTimeReserveFormState,
} from '@/features/search/rule/lib/searchFormState'

const noTargets = {
  keyCS: false,
  keyRegExp: false,
  name: false,
  description: false,
  extended: false,
}

const allWeekdays = { sun: true, mon: true, tue: true, wed: true, thu: true, fri: true, sat: true }
const noWeekdays = {
  sun: false,
  mon: false,
  tue: false,
  wed: false,
  thu: false,
  fri: false,
  sat: false,
}

describe('search form default state', () => {
  it('creates a form with every keyword target off and every weekday on', () => {
    expect(createDefaultSearchFormState(['GR', 'BS'])).toStrictEqual({
      keyword: '',
      keywordTargets: noTargets,
      ignoreKeyword: '',
      ignoreKeywordTargets: noTargets,
      channelIds: [],
      broadcastWaves: { GR: true, BS: true },
      genre: null,
      subGenre: null,
      selectedGenres: [],
      startTime: null,
      durationMinutes: null,
      weekdays: allWeekdays,
      durationMinMinutes: null,
      durationMaxMinutes: null,
      startPeriod: null,
      endPeriod: null,
      isFree: false,
    })
  })

  it('creates a time reserve form with an empty keyword and every weekday off', () => {
    expect(createDefaultSearchTimeReserveFormState()).toStrictEqual({
      keyword: '',
      channelId: null,
      startTime: null,
      endTime: null,
      weekdays: noWeekdays,
    })
  })

  it('does not share target or weekday objects between created states', () => {
    const first = createDefaultSearchFormState([])
    const second = createDefaultSearchFormState([])
    first.keywordTargets.name = true
    first.weekdays.sun = false

    expect(second.keywordTargets.name).toBe(false)
    expect(second.weekdays.sun).toBe(true)

    const firstReserve = createDefaultSearchTimeReserveFormState()
    firstReserve.weekdays.mon = true
    expect(createDefaultSearchTimeReserveFormState().weekdays.mon).toBe(false)
  })
})

describe('search route query application', () => {
  it('stores a genre without a subGenre key when the query has no subGenre', () => {
    const form = applySearchRouteQuery(createDefaultSearchFormState([]), { genre: 3 })

    expect(form.selectedGenres).toStrictEqual([{ genre: 3 }])
    expect('subGenre' in form.selectedGenres[0]).toBe(false)
  })

  it('stores a genre with a subGenre of zero when the query has one', () => {
    const form = applySearchRouteQuery(createDefaultSearchFormState([]), { genre: 3, subGenre: 0 })

    expect(form.selectedGenres).toStrictEqual([{ genre: 3, subGenre: 0 }])
  })

  it('keeps the existing genres, keyword and channels when the query omits them', () => {
    const base = {
      ...createDefaultSearchFormState([]),
      keyword: 'kept',
      keywordTargets: { ...noTargets, extended: true },
      channelIds: [4, 5],
      selectedGenres: [{ genre: 1, subGenre: 2 }],
    }
    const form = applySearchRouteQuery(base, {})

    expect(form).toStrictEqual(base)
  })

  it('replaces channels with the single query channel and defaults the keyword targets', () => {
    const form = applySearchRouteQuery(createDefaultSearchFormState([]), {
      keyword: 'word',
      channelId: 9,
    })

    expect(form.channelIds).toStrictEqual([9])
    expect(form.keyword).toBe('word')
    expect(form.keywordTargets).toStrictEqual({ ...noTargets, name: true, description: true })
  })
})

describe('legacy keyword target defaults', () => {
  const withKeyword = (keyword: string, targets: Partial<typeof noTargets>) => ({
    ...createDefaultSearchFormState([]),
    keyword,
    keywordTargets: { ...noTargets, ...targets },
  })
  const withIgnore = (ignoreKeyword: string, targets: Partial<typeof noTargets>) => ({
    ...createDefaultSearchFormState([]),
    ignoreKeyword,
    ignoreKeywordTargets: { ...noTargets, ...targets },
  })

  it('turns on name and description for a non-blank keyword without visible targets', () => {
    const form = applyLegacyKeywordTargetDefaults(withKeyword('a', { keyCS: true }))

    expect(form.keywordTargets).toStrictEqual({
      keyCS: true,
      keyRegExp: false,
      name: true,
      description: true,
      extended: false,
    })
    expect(form.ignoreKeywordTargets).toStrictEqual(noTargets)
  })

  it.each(['name', 'description', 'extended'] as const)(
    'leaves keyword targets alone when %s is already on',
    (target) => {
      const input = withKeyword('a', { [target]: true })
      const form = applyLegacyKeywordTargetDefaults(input)

      expect(form.keywordTargets).toStrictEqual(input.keywordTargets)
    },
  )

  it.each(['', '   '])('leaves keyword targets alone for the blank keyword %j', (keyword) => {
    const form = applyLegacyKeywordTargetDefaults(withKeyword(keyword, {}))

    expect(form.keywordTargets).toStrictEqual(noTargets)
  })

  it('turns on name and description for a non-blank ignore keyword without visible targets', () => {
    const form = applyLegacyKeywordTargetDefaults(withIgnore(' x ', { keyRegExp: true }))

    expect(form.ignoreKeywordTargets).toStrictEqual({
      keyCS: false,
      keyRegExp: true,
      name: true,
      description: true,
      extended: false,
    })
    expect(form.keywordTargets).toStrictEqual(noTargets)
  })

  it.each(['name', 'description', 'extended'] as const)(
    'leaves ignore keyword targets alone when %s is already on',
    (target) => {
      const input = withIgnore('x', { [target]: true })
      const form = applyLegacyKeywordTargetDefaults(input)

      expect(form.ignoreKeywordTargets).toStrictEqual(input.ignoreKeywordTargets)
    },
  )

  it.each(['', '   '])(
    'leaves ignore keyword targets alone for the blank keyword %j',
    (keyword) => {
      const form = applyLegacyKeywordTargetDefaults(withIgnore(keyword, {}))

      expect(form.ignoreKeywordTargets).toStrictEqual(noTargets)
    },
  )

  it('does not mutate the form it receives', () => {
    const input = withKeyword('a', {})
    applyLegacyKeywordTargetDefaults(input)

    expect(input.keywordTargets).toStrictEqual(noTargets)
  })
})
