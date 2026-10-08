import { afterEach, describe, expect, it, vi } from 'vitest'
import { searchGenreLabel } from '@/features/search/rule/genreLabels'
import { mergeChannelSelectOptions } from '@/features/search/rule/lib/channelSelectOptions'
import {
  isTopGenreSelected,
  selectedSubGenreIndexes,
  toggleSubGenreSelection,
  toggleTopGenreSelection,
} from '@/features/search/rule/lib/genreSelection'
import {
  formatDatetimeLocalInput,
  parseDatetimeLocalInput,
  parseNullableTextInput,
  parseNumberInput,
} from '@/features/search/rule/lib/inputParsers'
import { scrollActivePageToTop, scrollToElementHead } from '@/features/search/rule/lib/pageScroll'
import {
  createReserveIndexRequest,
  programMeta,
  programName,
} from '@/features/search/rule/lib/programDisplay'
import {
  ruleChannel,
  ruleGenre,
  ruleIgnoreKeyword,
  ruleKeyword,
} from '@/features/search/rule/lib/ruleListText'
import { createRuleOptionDraft } from '@/features/search/rule/lib/ruleOptionDraft'
import {
  buildRuleListRequest,
  buildSearchRulePayload,
  createDefaultSearchFormState,
  parseRuleRoute,
  parseSearchRoute,
} from '@/features/search/rule/query'
import type { RuleListItem } from '@/features/search/rule/api'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'

const settings = new DefaultSettingsFactory().create()
const searchBody = { option: { keyword: 'kw', times: [] }, isHalfWidth: true, limit: 1 }

describe('genre selection', () => {
  it('[AC 2.34] toggles top genres, treats a full sub-genre set as the top genre, and toggles sub genres', () => {
    expect(isTopGenreSelected([{ genre: 1, subGenre: 2 }], 1)).toBe(false)
    expect(
      selectedSubGenreIndexes(
        [{ genre: 1, subGenre: 3 }, { genre: 1, subGenre: 2 }, { genre: 2 }],
        1,
      ),
    ).toEqual([2, 3])
    expect(
      toggleTopGenreSelection({
        selectedGenres: [],
        genre: 1,
        subGenreCount: 2,
        isSubGenreVisible: false,
      }),
    ).toEqual([{ genre: 1 }])
    expect(
      toggleTopGenreSelection({
        selectedGenres: [{ genre: 1 }],
        genre: 1,
        subGenreCount: 2,
        isSubGenreVisible: false,
      }),
    ).toEqual([])
    expect(
      toggleTopGenreSelection({
        selectedGenres: [
          { genre: 1, subGenre: 0 },
          { genre: 1, subGenre: 1 },
        ],
        genre: 1,
        subGenreCount: 2,
        isSubGenreVisible: true,
      }),
    ).toEqual([])
    expect(
      toggleTopGenreSelection({
        selectedGenres: [{ genre: 1, subGenre: 0 }],
        genre: 1,
        subGenreCount: 2,
        isSubGenreVisible: true,
      }),
    ).toEqual([{ genre: 1 }])

    expect(
      toggleSubGenreSelection({
        selectedGenres: [{ genre: 1 }],
        genre: 1,
        subGenre: 0,
        subGenreCount: 3,
      }),
    ).toEqual([
      { genre: 1, subGenre: 1 },
      { genre: 1, subGenre: 2 },
    ])
    expect(
      toggleSubGenreSelection({
        selectedGenres: [{ genre: 1, subGenre: 0 }],
        genre: 1,
        subGenre: 0,
        subGenreCount: 3,
      }),
    ).toEqual([])
    expect(
      toggleSubGenreSelection({
        selectedGenres: [
          { genre: 1, subGenre: 0 },
          { genre: 1, subGenre: 1 },
        ],
        genre: 1,
        subGenre: 2,
        subGenreCount: 3,
      }),
    ).toEqual([{ genre: 1 }])
    expect(
      toggleSubGenreSelection({
        selectedGenres: [{ genre: 2 }],
        genre: 1,
        subGenre: 1,
        subGenreCount: 3,
      }),
    ).toEqual([{ genre: 2 }, { genre: 1, subGenre: 1 }])
  })

  it('labels genres and sub genres with fallbacks', () => {
    expect(searchGenreLabel(3, 1)).toBe('海外ドラマ')
    expect(searchGenreLabel(3, 9)).toBe('ドラマ')
    expect(searchGenreLabel(99, 9)).toBe('99-9')
    expect(searchGenreLabel(99)).toBe('99')
  })
})

describe('input parsers', () => {
  it('parses numbers, datetimes and nullable text', () => {
    expect(parseNumberInput(' ')).toBeNull()
    expect(parseNumberInput('-1')).toBeNull()
    expect(parseNumberInput('1.5')).toBeNull()
    expect(parseNumberInput('12')).toBe(12)
    expect(parseDatetimeLocalInput('')).toBeNull()
    expect(parseDatetimeLocalInput('not-a-date')).toBeNull()
    expect(parseDatetimeLocalInput('2026-01-02T03:04')).toBe(new Date('2026-01-02T03:04').getTime())
    expect(formatDatetimeLocalInput(null)).toBe('')
    expect(formatDatetimeLocalInput(undefined)).toBe('')
    expect(formatDatetimeLocalInput(new Date('2026-01-02T03:04').getTime())).toBe(
      '2026-01-02T03:04',
    )
    expect(parseNullableTextInput('  ')).toBeNull()
    expect(parseNullableTextInput(' a ')).toBe(' a ')
  })
})

describe('page scroll helpers', () => {
  afterEach(() => {
    document.body.innerHTML = ''
    document.documentElement.classList.remove('fix-address-bar2')
  })

  it('scrolls the window when no fixed shell is active and reports only a missing target', () => {
    // Only a missing target element is reported as a failure here, matching v2's
    // `scrollToElementHead` (Search.vue), whose sole failure condition is the target component's
    // ref being undefined. A missing title bar or a thrown `window.scrollTo` are not: v2 has no
    // "height lookup failed" concept (it dereferences the title ref directly) and no try/catch
    // around the scroll call, so neither is reported to the user - see pageScroll.ts.
    expect(scrollToElementHead(null)).toBe(false)
    const element = document.createElement('div')
    document.body.append(element)
    // No title bar in the DOM yet: falls back to a 0 offset instead of failing.
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
    expect(scrollToElementHead(element)).toBe(true)
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' })
    const titleBar = document.createElement('div')
    titleBar.setAttribute('data-testid', 'title-bar')
    document.body.append(titleBar)
    expect(scrollToElementHead(element, { offset: 4, behavior: 'auto' })).toBe(true)
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'auto' })
    expect(scrollActivePageToTop('auto')).toBe(true)
    scrollTo.mockImplementation(() => {
      throw new Error('boom')
    })
    // A thrown scrollTo is swallowed silently and still reports success: the target component
    // was found, which is the only thing v2 actually checks before scrolling.
    expect(scrollToElementHead(element)).toBe(true)
    expect(scrollActivePageToTop()).toBe(false)
    scrollTo.mockRestore()
  })

  it('scrolls the fixed shell main container when fix-address-bar2 is active', () => {
    document.documentElement.classList.add('fix-address-bar2')
    const titleBar = document.createElement('div')
    titleBar.setAttribute('data-testid', 'title-bar')
    const main = document.createElement('div')
    main.setAttribute('data-testid', 'shell-main')
    const scrollTo = vi.fn()
    main.scrollTo = scrollTo as never
    const element = document.createElement('div')
    document.body.append(titleBar, main, element)
    expect(scrollToElementHead(element)).toBe(true)
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' })
    expect(scrollActivePageToTop()).toBe(true)
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 0, behavior: 'smooth' })
  })
})

describe('program display helpers', () => {
  it('formats names, meta and reserve index ranges', () => {
    expect(programName({ id: 5 })).toBe('#5')
    expect(programMeta({ id: 1 })).toBe('')
    expect(programMeta({ id: 1, channelId: 3 })).toBe('channel 3')
    const meta = programMeta({
      id: 1,
      channelName: 'c',
      startAt: Date.UTC(2026, 0, 4, 0, 0),
      endAt: Date.UTC(2026, 0, 4, 1, 0),
    })
    expect(meta.startsWith('c\n')).toBe(true)
    expect(programMeta({ id: 1, startAt: 0, endAt: 60000 }).includes('\n')).toBe(false)
    expect(createReserveIndexRequest(null)).toBeNull()
    expect(createReserveIndexRequest([])).toBeNull()
    expect(createReserveIndexRequest([{ id: 1 }])).toBeNull()
    expect(
      createReserveIndexRequest([
        { id: 1, startAt: 5, endAt: 9 },
        { id: 2, startAt: 3, endAt: 7 },
      ]),
    ).toEqual({ startAt: 3, endAt: 9 })
  })
})

describe('rule list text and channel options', () => {
  const rule = (searchOption: RuleListItem['searchOption']): RuleListItem => ({
    id: 1,
    searchOption,
    reserveOption: {
      enable: true,
      allowEndLack: true,
      avoidDuplicate: false,
      periodToAvoidDuplicate: null,
    },
  })

  it('formats keyword, channel and genre columns with fallbacks', () => {
    expect(ruleKeyword(rule({ times: [] }))).toBe('-')
    expect(ruleIgnoreKeyword(rule({ times: [], ignoreKeyword: 'x' }))).toBe('x')
    expect(ruleChannel(rule({ times: [] }))).toBe('-')
    expect(ruleChannel(rule({ times: [], channelIds: [3] }))).toBe('3')
    expect(ruleChannel(rule({ times: [], channelIds: [3, 4], channelNames: ['Three'] }))).toBe(
      'Three 他1',
    )
    expect(ruleGenre(rule({ times: [] }))).toBe('-')
    expect(ruleGenre(rule({ times: [], genres: [{ genre: 3, subGenre: 1 }, { genre: 4 }] }))).toBe(
      '海外ドラマ 他1',
    )
  })

  it('merges unknown channel ids into the select options using rule detail names', () => {
    const options = [{ id: 1, name: 'One' }]
    expect(
      mergeChannelSelectOptions({ channelIds: [], channelOptions: options, ruleDetail: null }),
    ).toBe(options)
    expect(
      mergeChannelSelectOptions({ channelIds: [1, 2], channelOptions: options, ruleDetail: null }),
    ).toEqual([
      { id: 2, name: '2' },
      { id: 1, name: 'One' },
    ])
    const detail = {
      id: 9,
      isTimeSpecification: false,
      searchOption: { times: [], channelIds: [2, 3], channelNames: ['Two'] },
      reserveOption: {
        enable: true,
        allowEndLack: true,
        avoidDuplicate: false,
        periodToAvoidDuplicate: null,
      },
      saveOption: { parentDirectoryName: null, directory: null, recordedFormat: null },
    }
    expect(
      mergeChannelSelectOptions({
        channelIds: [2, 3, 4],
        channelOptions: options,
        ruleDetail: detail,
      }).map((c) => c.name),
    ).toEqual(['Two', '3', '4', 'One'])
  })
})

describe('rule option draft and payload', () => {
  it('[AC 2.21] derives defaults from settings and keeps existing rule options', () => {
    const copySettings = {
      ...settings,
      isEnableCopyKeywordToDirectory: true,
      isEnableEncodingSettingWhenCreateRule: true,
      isCheckAvoidDuplicate: true,
      isCheckDeleteOriginalAfterEncode: true,
    }
    expect(
      createRuleOptionDraft({
        existingRule: null,
        searchBody,
        settings: copySettings,
        encodeModes: ['h264'],
      }),
    ).toEqual({
      reserveOption: {
        enable: true,
        allowEndLack: true,
        avoidDuplicate: true,
        periodToAvoidDuplicate: null,
      },
      saveOption: { parentDirectoryName: null, directory: 'kw', recordedFormat: null },
      encodeOption: {
        mode1: 'h264',
        encodeParentDirectoryName1: null,
        directory1: 'kw',
        mode2: null,
        encodeParentDirectoryName2: null,
        directory2: null,
        mode3: null,
        encodeParentDirectoryName3: null,
        directory3: null,
        isDeleteOriginalAfterEncode: true,
      },
    })
    expect(
      createRuleOptionDraft({
        existingRule: null,
        searchBody: { ...searchBody, option: { times: [] } },
        settings,
        encodeModes: ['h264'],
      }).encodeOption?.mode1,
    ).toBeNull()
    expect(
      createRuleOptionDraft({ existingRule: null, searchBody, settings, encodeModes: [] })
        .encodeOption,
    ).toBeUndefined()
    const existing = {
      id: 1,
      isTimeSpecification: false,
      searchOption: { times: [] },
      reserveOption: {
        enable: false,
        allowEndLack: false,
        avoidDuplicate: false,
        periodToAvoidDuplicate: 1,
      },
      saveOption: { parentDirectoryName: 'p', directory: null, recordedFormat: null },
    }
    expect(
      createRuleOptionDraft({ existingRule: existing, searchBody, settings, encodeModes: [] }),
    ).toEqual({ reserveOption: existing.reserveOption, saveOption: existing.saveOption })
    expect(
      createRuleOptionDraft({
        existingRule: {
          ...existing,
          encodeOption: {
            mode1: 'm',
            encodeParentDirectoryName1: null,
            directory1: null,
            mode2: null,
            encodeParentDirectoryName2: null,
            directory2: null,
            mode3: null,
            encodeParentDirectoryName3: null,
            directory3: null,
            isDeleteOriginalAfterEncode: false,
          },
        },
        searchBody,
        settings,
        encodeModes: [],
      }).encodeOption?.mode1,
    ).toBe('m')
  })

  it('[AC 2.18][AC 2.19] builds payloads from drafts, existing rules and settings defaults', () => {
    const noMode = {
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
    const draftPayload = buildSearchRulePayload({
      searchBody,
      settings,
      encodeModes: [],
      optionDraft: {
        reserveOption: {
          enable: true,
          allowEndLack: true,
          avoidDuplicate: false,
          periodToAvoidDuplicate: null,
        },
        saveOption: { parentDirectoryName: null, directory: null, recordedFormat: null },
        encodeOption: noMode,
      },
    })
    expect(draftPayload.encodeOption).toBeUndefined()
    expect(
      buildSearchRulePayload({
        searchBody,
        settings,
        encodeModes: [],
        optionDraft: {
          reserveOption: draftPayload.reserveOption,
          saveOption: draftPayload.saveOption,
          encodeOption: { ...noMode, mode3: 'm3' },
        },
      }).encodeOption?.mode3,
    ).toBe('m3')
    const existing = {
      isTimeSpecification: true,
      searchOption: { keyword: 'ts', times: [] },
      reserveOption: draftPayload.reserveOption,
      saveOption: draftPayload.saveOption,
      encodeOption: { ...noMode, mode2: 'm2' },
    }
    const fromExisting = buildSearchRulePayload({
      searchBody,
      settings,
      encodeModes: [],
      existingRule: existing,
    })
    expect(fromExisting.isTimeSpecification).toBe(true)
    expect(fromExisting.searchOption).toBe(existing.searchOption)
    expect(fromExisting.encodeOption?.mode2).toBe('m2')
    const defaults = buildSearchRulePayload({
      searchBody,
      settings: {
        ...settings,
        isEnableEncodingSettingWhenCreateRule: true,
        isEnableCopyKeywordToDirectory: true,
      },
      encodeModes: ['h264'],
    })
    expect(defaults.encodeOption?.mode1).toBe('h264')
    expect(defaults.saveOption.directory).toBe('kw')
    expect(
      buildSearchRulePayload({
        searchBody: { ...searchBody, option: { times: [] } },
        settings,
        encodeModes: [],
      }).saveOption.directory,
    ).toBeNull()
  })
})

describe('route parsing', () => {
  it('[AC 1.8][AC 1.9] parses search queries, rule edit mode and rule list routes', () => {
    expect(parseSearchRoute('?rule=12')).toEqual({ mode: 'rule-edit', ruleId: 12 })
    expect(parseSearchRoute('?keyword=&channelId=x&genre=1&subGenre=2')).toEqual({
      mode: 'search',
      shouldAutoSearch: true,
      query: { genre: 1, subGenre: 2 },
    })
    expect(parseSearchRoute('?rule=99999999999999999999')).toMatchObject({
      mode: 'search',
      shouldAutoSearch: false,
    })
    expect(parseRuleRoute('?page=0&keyword=')).toEqual({ page: 1 })
    expect(parseRuleRoute('?page=3&keyword=k')).toEqual({ page: 3, keyword: 'k' })
    expect(
      buildRuleListRequest({
        route: { page: 2 },
        settings: { rulesLength: 10, isHalfWidthDisplayed: false },
      }),
    ).toEqual({ type: 'normal', offset: 10, limit: 10, isHalfWidth: false })
    expect(
      buildRuleListRequest({
        route: { page: 1, keyword: 'k' },
        settings: { rulesLength: 10, isHalfWidthDisplayed: true },
      }).keyword,
    ).toBe('k')
    expect(createDefaultSearchFormState([]).broadcastWaves).toEqual({})
  })
})
