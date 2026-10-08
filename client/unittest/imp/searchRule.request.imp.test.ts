import { describe, expect, it } from 'vitest'
import {
  buildSearchRequestBody,
  applySearchRouteQuery,
  createDefaultSearchFormState,
  parseSearchRoute,
  restoreVisibleBroadcastWaves,
} from '@/features/search/rule/query'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'

describe('Search request builder', () => {
  it('builds /schedules/search body from query-backed search options and settings', () => {
    const settings = {
      ...new DefaultSettingsFactory().create(),
      isHalfWidthDisplayed: false,
      searchLength: 125,
    }
    const form = createDefaultSearchFormState(['GR', 'BS', 'CS'])
    form.keyword = 'Synthetic Keyword'
    form.ignoreKeyword = 'Synthetic Ignore'
    form.keywordTargets.name = false
    form.ignoreKeywordTargets.extended = false
    form.channelIds = [101, 102]
    form.selectedGenres = [{ genre: 7, subGenre: 3 }]
    form.startTime = 1380
    form.durationMinutes = 90
    form.weekdays = {
      sun: false,
      mon: false,
      tue: true,
      wed: false,
      thu: true,
      fri: false,
      sat: false,
    }
    form.durationMinMinutes = 15
    form.durationMaxMinutes = 60
    form.startPeriod = 1_700_000_000_000
    form.endPeriod = 1_700_086_400_000
    form.isFree = true

    expect(buildSearchRequestBody({ form, settings })).toEqual({
      option: {
        keyword: 'Synthetic Keyword',
        keyCS: false,
        keyRegExp: false,
        name: true,
        description: true,
        extended: false,
        ignoreKeyword: 'Synthetic Ignore',
        ignoreKeyCS: false,
        ignoreKeyRegExp: false,
        ignoreName: true,
        ignoreDescription: true,
        ignoreExtended: false,
        channelIds: [101, 102],
        genres: [{ genre: 7, subGenre: 3 }],
        times: [{ week: 0x14, start: 1380, range: 90 }],
        durationMin: 900,
        durationMax: 3600,
        searchPeriods: [{ startAt: 1_700_000_000_000, endAt: 1_700_086_400_000 }],
        isFree: true,
      },
      isHalfWidth: false,
      limit: 125,
    })
  })

  it('serializes keyword search option fields in the legacy order', () => {
    const form = createDefaultSearchFormState(['GR'])
    form.keyword = 'Synthetic Rule Keyword'
    form.keywordTargets.name = true
    form.channelIds = [101]

    const body = buildSearchRequestBody({
      form,
      settings: new DefaultSettingsFactory().create(),
    })

    expect(JSON.stringify(body.option)).toBe(
      JSON.stringify({
        keyword: 'Synthetic Rule Keyword',
        keyCS: false,
        keyRegExp: false,
        name: true,
        description: false,
        extended: false,
        channelIds: [101],
        times: [{ week: 0x7f }],
      }),
    )
  })

  it('omits all broadcast wave keys when all visible waves are enabled and restores all-disabled waves', () => {
    const settings = new DefaultSettingsFactory().create()
    const enabled = createDefaultSearchFormState(['GR', 'BS'])
    const disabled = createDefaultSearchFormState(['GR', 'BS'])
    disabled.broadcastWaves.GR = false
    disabled.broadcastWaves.BS = false

    expect(buildSearchRequestBody({ form: enabled, settings }).option).toEqual({
      times: [{ week: 0x7f }],
    })
    expect(restoreVisibleBroadcastWaves(disabled).broadcastWaves).toEqual({
      GR: true,
      BS: true,
    })
    expect(buildSearchRequestBody({ form: disabled, settings }).option).toEqual({
      times: [{ week: 0x7f }],
    })
  })

  it('parses route query and lets rule edit mode override query search values', () => {
    expect(parseSearchRoute('?keyword=Synthetic&channelId=12&genre=7&subGenre=2')).toEqual({
      mode: 'search',
      shouldAutoSearch: true,
      query: {
        keyword: 'Synthetic',
        channelId: 12,
        genre: 7,
        subGenre: 2,
      },
    })

    expect(parseSearchRoute('?rule=55&keyword=Ignored')).toEqual({
      mode: 'rule-edit',
      ruleId: 55,
    })
  })

  it('applies legacy guide-search keyword target defaults to route-backed search forms', () => {
    const form = applySearchRouteQuery(createDefaultSearchFormState(['GR']), {
      keyword: 'Synthetic Program',
      channelId: 301,
      genre: 7,
      subGenre: 3,
    })

    expect(form.keyword).toBe('Synthetic Program')
    expect(form.keywordTargets.name).toBe(true)
    expect(form.keywordTargets.description).toBe(true)
    expect(form.keywordTargets.extended).toBe(false)
    expect(form.channelIds).toEqual([301])
    expect(form.selectedGenres).toEqual([{ genre: 7, subGenre: 3 }])
  })
})
