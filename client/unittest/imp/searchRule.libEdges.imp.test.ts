import { describe, expect, it } from 'vitest'
import { formatDatetimeLocalInput, parseNumberInput } from '@/features/search/rule/lib/inputParsers'
import { buildSearchRulePayload } from '@/features/search/rule/lib/rulePayload'
import {
  buildSearchRequestBody,
  createTimeSpecifiedSearchOption,
  restoreVisibleBroadcastWaves,
} from '@/features/search/rule/lib/searchRequest'
import {
  buildRuleListRequest,
  parseRuleRoute,
  parseSearchRoute,
} from '@/features/search/rule/lib/searchRoute'
import {
  createDefaultSearchFormState,
  createDefaultSearchTimeReserveFormState,
} from '@/features/search/rule/query'
import type { SearchRulePayload } from '@/features/search/rule/query'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'

const settings = new DefaultSettingsFactory().create()
const requestSettings = { isHalfWidthDisplayed: true, searchLength: 30 }
const searchBody = { option: { keyword: 'kw', times: [] }, isHalfWidth: true, limit: 1 }

const noModeEncodeOption = {
  mode1: null,
  encodeParentDirectoryName1: null,
  directory1: null,
  mode2: null,
  encodeParentDirectoryName2: null,
  directory2: null,
  mode3: null,
  encodeParentDirectoryName3: null,
  directory3: null,
  isDeleteOriginalAfterEncode: false,
}

const reserveOption = {
  enable: true,
  allowEndLack: true,
  avoidDuplicate: false,
  periodToAvoidDuplicate: null,
}
const saveOption = { parentDirectoryName: null, directory: null, recordedFormat: null }

describe('input parsers edges', () => {
  it('parses zero as the number zero', () => {
    expect(parseNumberInput('0')).toBe(0)
    expect(parseNumberInput(' 0 ')).toBe(0)
  })

  it('pads a year before 1000 to four digits', () => {
    const date = new Date(2000, 0, 2, 3, 4)
    date.setFullYear(500)

    expect(formatDatetimeLocalInput(date.getTime())).toBe('0500-01-02T03:04')
  })
})

describe('rule payload edges', () => {
  it('keeps the encode option of a draft that selects only the second mode', () => {
    const payload = buildSearchRulePayload({
      searchBody,
      settings,
      encodeModes: [],
      optionDraft: {
        reserveOption,
        saveOption,
        encodeOption: { ...noModeEncodeOption, mode2: 'm2' },
      },
    })

    expect(payload.encodeOption?.mode2).toBe('m2')
  })

  it.each([
    ['null', null],
    ['a string', 'not an object'],
  ])('rejects a rule whose search option is %s', (_label, searchOption) => {
    const existingRule = {
      isTimeSpecification: true,
      searchOption,
      reserveOption,
      saveOption,
    } as unknown as SearchRulePayload

    expect(() =>
      buildSearchRulePayload({ searchBody, settings, encodeModes: [], existingRule }),
    ).toThrow()
  })

  it('creates no default encode option when the setting is on but no encode mode exists', () => {
    const payload = buildSearchRulePayload({
      searchBody,
      settings: { ...settings, isEnableEncodingSettingWhenCreateRule: true },
      encodeModes: [],
    })

    expect(payload.encodeOption).toBeUndefined()
  })

  it('creates no default encode option when the setting is off although an encode mode exists', () => {
    const payload = buildSearchRulePayload({
      searchBody,
      settings: { ...settings, isEnableEncodingSettingWhenCreateRule: false },
      encodeModes: ['h264'],
    })

    expect(payload.encodeOption).toBeUndefined()
  })
})

describe('search request edges', () => {
  const base = { ...createDefaultSearchTimeReserveFormState(), keyword: 'k', channelId: 1 }

  it('sends the start time and range only when both are set', () => {
    const onlyStart = buildSearchRequestBody({
      form: { ...createDefaultSearchFormState(['GR']), startTime: 60, durationMinutes: null },
      settings: requestSettings,
    })
    const onlyRange = buildSearchRequestBody({
      form: { ...createDefaultSearchFormState(['GR']), startTime: null, durationMinutes: 30 },
      settings: requestSettings,
    })

    expect(onlyStart.option.times).toStrictEqual([{ week: 0x7f }])
    expect(onlyRange.option.times).toStrictEqual([{ week: 0x7f }])
  })

  it('sends the search period only when both ends are set', () => {
    const onlyStart = buildSearchRequestBody({
      form: { ...createDefaultSearchFormState(['GR']), startPeriod: 1, endPeriod: null },
      settings: requestSettings,
    })
    const onlyEnd = buildSearchRequestBody({
      form: { ...createDefaultSearchFormState(['GR']), startPeriod: null, endPeriod: 2 },
      settings: requestSettings,
    })

    expect(onlyStart.option.searchPeriods).toBeUndefined()
    expect(onlyEnd.option.searchPeriods).toBeUndefined()
  })

  it.each([' 10:30', '10:30 ', '1x:30', '10:3', '10:300'])(
    'rejects the malformed start time %j',
    (startTime) => {
      expect(() =>
        createTimeSpecifiedSearchOption({ ...base, startTime, endTime: '11:00' }),
      ).toThrow('TimeReserveOptionIsInvalidValue')
    },
  )

  it('accepts the last valid minute of the last valid hour', () => {
    expect(
      createTimeSpecifiedSearchOption({ ...base, startTime: '23:59', endTime: '23:59' }).times[0],
    ).toStrictEqual({ start: 86340, range: 0, week: 0x7f })
  })

  it('gives a zero range, not a full day, when the start and end are the same time', () => {
    expect(
      createTimeSpecifiedSearchOption({ ...base, startTime: '10:30', endTime: '10:30' }).times[0]
        ?.range,
    ).toBe(0)
  })

  it('returns the very same form when no broadcast wave is visible', () => {
    const withoutWaves = { ...createDefaultSearchFormState([]), channelIds: [] }
    const withoutWavesButChannel = { ...createDefaultSearchFormState([]), channelIds: [3] }

    expect(restoreVisibleBroadcastWaves(withoutWaves)).toBe(withoutWaves)
    expect(restoreVisibleBroadcastWaves(withoutWavesButChannel)).toBe(withoutWavesButChannel)
  })

  it('disables every visible broadcast wave once a channel filter exists and one wave is enabled', () => {
    const form = {
      ...createDefaultSearchFormState(['GR', 'BS', 'CS']),
      channelIds: [3],
      broadcastWaves: { GR: true, BS: false, CS: false },
    }

    expect(restoreVisibleBroadcastWaves(form).broadcastWaves).toStrictEqual({
      GR: false,
      BS: false,
      CS: false,
    })
  })

  it('returns the very same form when a channel filter exists and no wave is enabled', () => {
    const form = {
      ...createDefaultSearchFormState(['GR', 'BS']),
      channelIds: [3],
      broadcastWaves: { GR: false, BS: false },
    }

    expect(restoreVisibleBroadcastWaves(form)).toBe(form)
  })
})

describe('search route edges', () => {
  it.each(['1e3', ' 12', '12 ', '-5', '+5', '0x10'])('does not read %j as a rule id', (value) => {
    expect(parseSearchRoute(`?rule=${encodeURIComponent(value)}`)).toStrictEqual({
      mode: 'search',
      shouldAutoSearch: false,
      query: {},
    })
  })

  it('omits the keyword key from a rule route that has no keyword', () => {
    expect(parseRuleRoute('?page=2')).toStrictEqual({ page: 2 })
    expect(parseRuleRoute('?page=1e3')).toStrictEqual({ page: 1 })
  })

  it('omits the keyword key from a rule list request that has no keyword', () => {
    expect(
      buildRuleListRequest({
        route: { page: 3 },
        settings: { rulesLength: 10, isHalfWidthDisplayed: true },
      }),
    ).toStrictEqual({ type: 'normal', offset: 20, limit: 10, isHalfWidth: true })
  })
})
