import { describe, expect, it } from 'vitest'
import {
  adaptAddReserveResponse,
  adaptPrograms,
  adaptReserveLists,
} from '@/features/search/rule/api/adaptPrograms'
import {
  adaptAddRuleResponse,
  adaptRuleListResponse,
  adaptSearchRuleDetail,
} from '@/features/search/rule/api/adaptRules'
import {
  adaptChannelIndex,
  adaptRuleReserveList,
  hydrateRuleChannelNames,
  hydrateRuleDetailChannelNames,
  hydrateRuleReserveChannelNames,
  hydrateSearchProgramChannelNames,
} from '@/features/search/rule/api/channelNames'

const validRule = {
  id: 7,
  searchOption: { keyword: 'k', times: [], channelIds: [12] },
  reserveOption: {
    enable: false,
    allowEndLack: false,
    avoidDuplicate: true,
    periodToAvoidDuplicate: 3,
  },
}

describe('search program adapters', () => {
  it('adapts every optional program field and rejects malformed entries', () => {
    expect(adaptPrograms('nope')).toBeNull()
    expect(adaptPrograms([{ id: -1 }])).toBeNull()
    expect(adaptPrograms([null])).toBeNull()
    const [program] =
      adaptPrograms([
        {
          id: 1,
          name: 'n',
          channelId: 2,
          channelName: 'c',
          startAt: 3,
          endAt: 4,
          description: 'd',
          extended: 'e',
          genre1: 5,
          subGenre1: 6,
          genre2: 7,
          subGenre2: 8,
          genre3: 9,
          subGenre3: 10,
          isFree: false,
        },
      ]) ?? []
    expect(program).toEqual({
      id: 1,
      name: 'n',
      channelId: 2,
      channelName: 'c',
      startAt: 3,
      endAt: 4,
      description: 'd',
      extended: 'e',
      genre1: 5,
      subGenre1: 6,
      genre2: 7,
      subGenre2: 8,
      genre3: 9,
      subGenre3: 10,
      isFree: false,
    })
    expect(adaptPrograms([{ id: 2, name: 5, channelId: -3, startAt: 'x', isFree: 'y' }])).toEqual([
      { id: 2 },
    ])
  })

  it('adapts reserve lists and rejects any malformed list or item', () => {
    expect(adaptReserveLists(null)).toBeNull()
    expect(adaptReserveLists({ normal: 'x', conflicts: [], skips: [], overlaps: [] })).toBeNull()
    expect(
      adaptReserveLists({ normal: [{ reserveId: 'x' }], conflicts: [], skips: [], overlaps: [] }),
    ).toBeNull()
    expect(adaptReserveLists({ normal: [null], conflicts: [], skips: [], overlaps: [] })).toBeNull()
    // `GET /api/reserves/lists` (api.yml `ReserveListItem`, `ReserveApiModel.toReserveListItem`)
    // keys the reserve id as `reserveId`, never `id` - a real response never contains an `id`
    // field on these items. An adapter that required `value.id` (always absent on the real
    // payload) would make search/rule-edit results never show reserve state, because every
    // non-empty list would fail `adaptReserveList`'s `every` check and the
    // whole response would be discarded as malformed.
    expect(
      adaptReserveLists({
        normal: [{ reserveId: 1, programId: 2, ruleId: 3 }],
        conflicts: [{ reserveId: 4, programId: -1, ruleId: 'r' }],
        skips: [],
        overlaps: [],
      }),
    ).toEqual({
      normal: [{ id: 1, programId: 2, ruleId: 3 }],
      conflicts: [{ id: 4 }],
      skips: [],
      overlaps: [],
    })
  })

  it('adapts add reserve responses', () => {
    expect(adaptAddReserveResponse(null)).toBeNull()
    expect(adaptAddReserveResponse({ reserveId: -1 })).toBeNull()
    expect(adaptAddReserveResponse({ reserveId: 9 })).toEqual({ reserveId: 9 })
  })
})

describe('rule adapters', () => {
  it('adapts add rule responses from ruleId or id', () => {
    expect(adaptAddRuleResponse('x')).toBeNull()
    expect(adaptAddRuleResponse({})).toBeNull()
    expect(adaptAddRuleResponse({ ruleId: 3 })).toEqual({ ruleId: 3 })
    expect(adaptAddRuleResponse({ id: 4 })).toEqual({ ruleId: 4 })
  })

  it('adapts rule detail with defaults, encode option and rejects malformed shapes', () => {
    expect(adaptSearchRuleDetail({ id: 1 })).toBeNull()
    expect(
      adaptSearchRuleDetail({ id: 1, searchOption: { times: [] }, reserveOption: 'x' }),
    ).toBeNull()
    expect(
      adaptSearchRuleDetail({
        id: 1,
        searchOption: { times: [] },
        reserveOption: {},
        saveOption: 'x',
      }),
    ).toBeNull()
    const minimal = adaptSearchRuleDetail({ id: 1, searchOption: { times: [] }, reserveOption: {} })
    expect(minimal).toEqual({
      id: 1,
      isTimeSpecification: false,
      searchOption: { times: [] },
      reserveOption: {
        enable: true,
        allowEndLack: true,
        avoidDuplicate: false,
        periodToAvoidDuplicate: null,
      },
      saveOption: { parentDirectoryName: null, directory: null, recordedFormat: null },
    })
    const full = adaptSearchRuleDetail({
      id: 2,
      isTimeSpecification: true,
      searchOption: { times: [] },
      reserveOption: {
        enable: false,
        allowEndLack: false,
        avoidDuplicate: true,
        periodToAvoidDuplicate: 5,
      },
      saveOption: { parentDirectoryName: 'p', directory: 'd', recordedFormat: 'f' },
      encodeOption: { mode1: 'm1', isDeleteOriginalAfterEncode: true },
    })
    expect(full?.isTimeSpecification).toBe(true)
    expect(full?.reserveOption).toEqual({
      enable: false,
      allowEndLack: false,
      avoidDuplicate: true,
      periodToAvoidDuplicate: 5,
    })
    expect(full?.saveOption).toEqual({
      parentDirectoryName: 'p',
      directory: 'd',
      recordedFormat: 'f',
    })
    expect(full?.encodeOption).toEqual({
      mode1: 'm1',
      encodeParentDirectoryName1: null,
      directory1: null,
      mode2: null,
      encodeParentDirectoryName2: null,
      directory2: null,
      mode3: null,
      encodeParentDirectoryName3: null,
      directory3: null,
      isDeleteOriginalAfterEncode: true,
    })
    expect(
      adaptSearchRuleDetail({
        id: 3,
        searchOption: { times: [] },
        reserveOption: {},
        encodeOption: {},
      })?.encodeOption?.isDeleteOriginalAfterEncode,
    ).toBe(false)
  })

  it('adapts rule list responses and totals', () => {
    expect(adaptRuleListResponse({ rules: 'x' })).toBeNull()
    expect(adaptRuleListResponse({ rules: [{ id: 1 }] })).toBeNull()
    expect(
      adaptRuleListResponse({
        rules: [{ id: 1, searchOption: { times: [] }, reserveOption: 'x' }],
      }),
    ).toBeNull()
    expect(
      adaptRuleListResponse({ rules: [validRule, { ...validRule, id: 8, reservesCnt: 2 }] }),
    ).toEqual({
      rules: [
        { id: 7, searchOption: validRule.searchOption, reserveOption: validRule.reserveOption },
        {
          id: 8,
          searchOption: validRule.searchOption,
          reserveOption: validRule.reserveOption,
          reservesCnt: 2,
        },
      ],
      total: 2,
    })
    expect(adaptRuleListResponse({ rules: [validRule], total: 40 })?.total).toBe(40)
  })
})

describe('channel name adapters', () => {
  it('[AC 3.23] builds the channel index from half-width names and skips invalid entries when isHalfWidth is true', () => {
    expect(adaptChannelIndex('x', true).size).toBe(0)
    const index = adaptChannelIndex(
      [
        null,
        { id: 'x' },
        { id: 1, halfWidthName: 'half', name: 'full' },
        { id: 2, name: 'full-only' },
        { id: 3 },
      ],
      true,
    )
    expect([...index]).toEqual([
      [1, 'half'],
      [2, 'full-only'],
    ])
  })

  it('[AC 3.23] prefers the full-width name and falls back to half-width when isHalfWidth is false', () => {
    const index = adaptChannelIndex(
      [
        { id: 1, halfWidthName: 'half', name: 'full' },
        { id: 2, name: 'full-only' },
        { id: 3, halfWidthName: 'half-only' },
      ],
      false,
    )
    expect([...index]).toEqual([
      [1, 'full'],
      [2, 'full-only'],
      [3, 'half-only'],
    ])
  })

  it('hydrates rule, detail, program and reserve channel names', () => {
    const index = new Map([[12, 'Twelve']])
    const rules = {
      rules: [{ ...validRule }, { ...validRule, id: 9, searchOption: { times: [] } }],
      total: 2,
    }
    const hydrated = hydrateRuleChannelNames(rules, index)
    expect(hydrated.rules[0]?.searchOption.channelNames).toEqual(['Twelve'])
    expect(hydrated.rules[1]).toBe(rules.rules[1])
    expect(
      hydrateRuleChannelNames(
        { rules: [{ ...validRule, searchOption: { times: [], channelIds: [99] } }], total: 1 },
        index,
      ).rules[0]?.searchOption.channelNames,
    ).toEqual(['99'])

    const detail = adaptSearchRuleDetail({
      id: 1,
      searchOption: { times: [], channelIds: [12, 13] },
      reserveOption: {},
    })
    expect(hydrateRuleDetailChannelNames(detail!, index).searchOption.channelNames).toEqual([
      'Twelve',
      '13',
    ])
    const plainDetail = adaptSearchRuleDetail({
      id: 1,
      searchOption: { times: [] },
      reserveOption: {},
    })
    expect(hydrateRuleDetailChannelNames(plainDetail!, index)).toBe(plainDetail)

    expect(
      hydrateSearchProgramChannelNames(
        [
          { id: 1, channelId: 12 },
          { id: 2, channelId: 99 },
          { id: 3 },
          { id: 4, channelId: 12, channelName: 'kept' },
        ],
        index,
      ),
    ).toEqual([
      { id: 1, channelId: 12, channelName: 'Twelve' },
      { id: 2, channelId: 99 },
      { id: 3 },
      { id: 4, channelId: 12, channelName: 'kept' },
    ])

    expect(
      hydrateRuleReserveChannelNames(
        [
          { id: 1, channelId: 12 },
          { id: 2, channelId: 99 },
          { id: 3 },
          { id: 4, channelId: 12, channelName: 'kept' },
        ],
        index,
      ),
    ).toEqual([
      { id: 1, channelId: 12, channelName: 'Twelve' },
      { id: 2, channelId: 99 },
      { id: 3 },
      { id: 4, channelId: 12, channelName: 'kept' },
    ])
  })

  it('adapts rule reserve lists from bare arrays or { reserves } and every optional field', () => {
    expect(adaptRuleReserveList('x')).toBeNull()
    expect(adaptRuleReserveList([{ id: 'x' }])).toBeNull()
    expect(adaptRuleReserveList({ reserves: [{ id: 1 }] })).toEqual([{ id: 1 }])
    expect(
      adaptRuleReserveList([
        {
          id: 1,
          programId: 2,
          name: 'n',
          channelId: 3,
          channelName: 'c',
          startAt: 4,
          endAt: 5,
          description: 'd',
          ruleId: 6,
          isConflict: true,
          isSkip: false,
          isOverlap: true,
          isTimeSpecified: false,
        },
        {
          id: 7,
          programId: 'x',
          name: 1,
          channelId: -1,
          channelName: 2,
          startAt: 'a',
          endAt: 'b',
          description: 3,
          ruleId: -1,
          isConflict: 'y',
          isSkip: 1,
          isOverlap: 2,
          isTimeSpecified: 3,
        },
      ]),
    ).toEqual([
      {
        id: 1,
        programId: 2,
        name: 'n',
        channelId: 3,
        channelName: 'c',
        startAt: 4,
        endAt: 5,
        description: 'd',
        ruleId: 6,
        isConflict: true,
        isSkip: false,
        isOverlap: true,
        isTimeSpecified: false,
      },
      { id: 7 },
    ])
  })
})
