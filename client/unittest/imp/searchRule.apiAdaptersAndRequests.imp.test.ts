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
  hydrateRuleReserveChannelNames,
  hydrateSearchProgramChannelNames,
} from '@/features/search/rule/api/channelNames'
import {
  buildReserveIndexUrl,
  buildRuleListUrl,
  compactOptionalApiFields,
} from '@/features/search/rule/api/http'
import { createFetchSearchRuleApiRepository } from '@/features/search/rule/api/repository'

const times: unknown[] = []
const reserveOption = {
  enable: true,
  allowEndLack: true,
  avoidDuplicate: false,
  periodToAvoidDuplicate: null,
}

describe('search program adapters', () => {
  it('keeps every valid field of a program', () => {
    const program = {
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
      isFree: true,
    }

    expect(adaptPrograms([program])).toStrictEqual([program])
  })

  it('drops every field whose type or range is wrong', () => {
    expect(
      adaptPrograms([
        {
          id: 1,
          name: 1,
          channelId: -1,
          channelName: 1,
          startAt: 1.5,
          endAt: 1.5,
          description: 1,
          extended: 1,
          genre1: -1,
          subGenre1: 'x',
          genre2: 1.5,
          subGenre2: null,
          genre3: -2,
          subGenre3: 'a',
          isFree: 'true',
        },
      ]),
    ).toStrictEqual([{ id: 1 }])
  })

  it('rejects the whole list when any program is invalid', () => {
    expect(adaptPrograms([{ id: 1 }, 'bad'])).toBeNull()
    expect(adaptPrograms([{ id: -1 }])).toBeNull()
    expect(adaptPrograms('x')).toBeNull()
    expect(adaptPrograms([{ id: 1 }, { id: 2 }])).toStrictEqual([{ id: 1 }, { id: 2 }])
  })

  it('rejects reserve lists unless all four lists are valid', () => {
    const valid = { normal: [], conflicts: [], skips: [], overlaps: [] }

    expect(adaptReserveLists(valid)).toStrictEqual(valid)
    for (const key of ['normal', 'conflicts', 'skips', 'overlaps']) {
      expect(adaptReserveLists({ ...valid, [key]: 'x' })).toBeNull()
    }
    expect(adaptReserveLists(null)).toBeNull()
  })

  it('reads the reserve id from a reserve add response', () => {
    expect(adaptAddReserveResponse({ reserveId: 4 })).toStrictEqual({ reserveId: 4 })
    expect(adaptAddReserveResponse({ reserveId: -1 })).toBeNull()
    expect(adaptAddReserveResponse(null)).toBeNull()
  })
})

describe('search rule adapters', () => {
  it('reads the rule id from an add response by ruleId or id', () => {
    expect(adaptAddRuleResponse({ ruleId: 3 })).toStrictEqual({ ruleId: 3 })
    expect(adaptAddRuleResponse({ id: 4 })).toStrictEqual({ ruleId: 4 })
    expect(adaptAddRuleResponse({ ruleId: -1, id: 4 })).toStrictEqual({ ruleId: 4 })
    expect(adaptAddRuleResponse({})).toBeNull()
    expect(adaptAddRuleResponse(null)).toBeNull()
  })

  it('adapts a rule detail without an encode option into one without the key', () => {
    expect(
      adaptSearchRuleDetail({ id: 1, searchOption: { times }, reserveOption: {} }),
    ).toStrictEqual({
      id: 1,
      isTimeSpecification: false,
      searchOption: { times },
      reserveOption,
      saveOption: { parentDirectoryName: null, directory: null, recordedFormat: null },
    })
  })

  it('rejects a rule detail that is not an object with an id and a search option with times', () => {
    const base = { id: 1, searchOption: { times }, reserveOption: {} }

    expect(adaptSearchRuleDetail(null)).toBeNull()
    expect(adaptSearchRuleDetail({ ...base, id: -1 })).toBeNull()
    expect(adaptSearchRuleDetail({ ...base, searchOption: 'x' })).toBeNull()
    expect(adaptSearchRuleDetail({ ...base, searchOption: { times: 'x' } })).toBeNull()
    expect(adaptSearchRuleDetail({ ...base, reserveOption: 'x' })).toBeNull()
    expect(adaptSearchRuleDetail({ ...base, saveOption: 'x' })).toBeNull()
  })

  it('rejects a rule list unless every rule is valid and keeps a reserve count only when valid', () => {
    const rule = { id: 1, searchOption: { times }, reserveOption: {} }

    expect(adaptRuleListResponse({ rules: [rule, { ...rule, id: 'x' }] })).toBeNull()
    expect(adaptRuleListResponse({ rules: [null] })).toBeNull()
    expect(adaptRuleListResponse({ rules: [{ ...rule, searchOption: { times: 'x' } }] })).toBeNull()
    expect(adaptRuleListResponse({ rules: [{ ...rule, reserveOption: 'x' }] })).toBeNull()
    expect(
      adaptRuleListResponse({ rules: [{ ...rule, reservesCnt: -1 }], total: -1 }),
    ).toStrictEqual({
      rules: [{ id: 1, searchOption: { times }, reserveOption }],
      total: 1,
    })
    expect(adaptRuleListResponse({ rules: [{ ...rule, reservesCnt: 2 }], total: 5 })).toStrictEqual(
      {
        rules: [{ id: 1, searchOption: { times }, reserveOption, reservesCnt: 2 }],
        total: 5,
      },
    )
  })
})

describe('search channel names', () => {
  it('ignores a half-width name that is not a string when there is no full name', () => {
    expect(
      adaptChannelIndex([null, { id: 1, halfWidthName: 5 }, { id: 2, halfWidthName: 'H' }], false),
    ).toStrictEqual(new Map([[2, 'H']]))
  })

  it('keeps a given channel name and leaves unknown channels untouched', () => {
    const index = new Map([[1, 'Indexed']])
    const given = { id: 1, channelId: 1, channelName: 'Given' }
    const unknown = { id: 2, channelId: 9 }
    const noChannel = { id: 3 }

    expect(hydrateSearchProgramChannelNames([given, unknown, noChannel], index)).toStrictEqual([
      given,
      unknown,
      noChannel,
    ])
    expect(hydrateSearchProgramChannelNames([{ id: 4, channelId: 1 }], index)).toStrictEqual([
      { id: 4, channelId: 1, channelName: 'Indexed' },
    ])
    expect(hydrateRuleReserveChannelNames([given, unknown, noChannel], index)).toStrictEqual([
      given,
      unknown,
      noChannel,
    ])
    expect(hydrateRuleReserveChannelNames([{ id: 4, channelId: 1 }], index)).toStrictEqual([
      { id: 4, channelId: 1, channelName: 'Indexed' },
    ])
  })

  it('rejects a rule reserve list when any reserve is invalid', () => {
    expect(adaptRuleReserveList([{ id: 1 }, 'bad'])).toBeNull()
    expect(adaptRuleReserveList({ reserves: [{ id: 1 }, { id: 2 }] })).toStrictEqual([
      { id: 1 },
      { id: 2 },
    ])
  })
})

describe('search rule request building', () => {
  it('drops null, undefined and channel name entries recursively', () => {
    expect(
      compactOptionalApiFields({
        a: null,
        b: undefined,
        c: 1,
        channelNames: ['x'],
        d: { e: null, f: 2 },
        g: [{ h: null, i: 3 }],
      }),
    ).toStrictEqual({ c: 1, d: { f: 2 }, g: [{ i: 3 }] })
  })

  it('names the reserve index period and the rule list keyword in the query', () => {
    expect(buildReserveIndexUrl('/api/', { startAt: 1_000, endAt: 2_000 })).toBe(
      '/api/reserves/lists?startAt=1000&endAt=2000',
    )
    expect(
      buildRuleListUrl('/api', { type: 'all', offset: 0, limit: 10, isHalfWidth: true } as never),
    ).toBe('/api/rules?type=all&offset=0&limit=10&isHalfWidth=true')
    expect(
      buildRuleListUrl('/api', {
        type: 'all',
        offset: 0,
        limit: 10,
        isHalfWidth: true,
        keyword: 'k',
      } as never),
    ).toBe('/api/rules?type=all&offset=0&limit=10&isHalfWidth=true&keyword=k')
  })
})

describe('search rule repository requests', () => {
  it('uses an empty channel list when the channel request fails', async () => {
    const repository = createFetchSearchRuleApiRepository({
      fetcher: async () => {
        throw new Error('network')
      },
    })

    await expect(repository.fetchSearchChannels?.(true)).resolves.toStrictEqual({
      ok: true,
      value: [],
    })
  })

  it('updates a rule with PUT and a compacted JSON body, and reports the failure', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const repository = createFetchSearchRuleApiRepository({
      basePath: '/api/',
      fetcher: async (url, init) => {
        calls.push({ url: String(url), init })

        return new Response(null, { status: 204 })
      },
    })

    await expect(repository.updateRule(5, { keep: 1, drop: null } as never)).resolves.toStrictEqual(
      { ok: true, value: undefined },
    )
    expect(calls[0]?.url).toBe('/api/rules/5')
    expect(calls[0]?.init?.method).toBe('PUT')
    expect(calls[0]?.init?.headers).toStrictEqual({ 'Content-Type': 'application/json' })
    expect(JSON.parse(String(calls[0]?.init?.body))).toStrictEqual({ keep: 1 })

    await expect(
      createFetchSearchRuleApiRepository({
        fetcher: async () => new Response(null, { status: 500 }),
      }).updateRule(5, {} as never),
    ).resolves.toStrictEqual({
      ok: false,
      error: 'rule-update-failed',
      message: 'ルール更新に失敗',
    })
  })
})
