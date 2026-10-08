import type { Page } from '@playwright/test'
import { HttpResponse, getResponse, http } from 'msw'
import { createMswRequest, fulfillMswResponse } from './appShellMocks'

export interface SearchRuleRequestLog {
  apiPaths: string[]
  methods: string[]
  bodies: unknown[]
}

export function createSearchRuleRequestLog(): SearchRuleRequestLog {
  return {
    apiPaths: [],
    methods: [],
    bodies: [],
  }
}

export interface SearchRuleRealtimeMockController {
  clearSearchPrograms: () => void
  clearRuleList: () => void
  clearReserveIndex: () => void
}

const searchProgramStart = Date.parse('2026-05-05T10:00:00+09:00')

const searchPrograms = [
  {
    id: 6101,
    name: 'Synthetic Search Program Alpha',
    channelId: 4101,
    channelName: 'Synthetic Search Channel',
    startAt: searchProgramStart,
    endAt: searchProgramStart + 30 * 60 * 1000,
    description: 'Synthetic search description',
    genre1: 7,
    subGenre1: 3,
  },
]

const searchChannels = [
  {
    id: 4101,
    name: 'Synthetic Search Channel',
    halfWidthName: 'Synthetic Search Channel',
  },
  {
    id: 4102,
    name: 'Synthetic Search Channel Sub',
    halfWidthName: 'Synthetic Search Channel Sub',
  },
]

const ruleList = [
  {
    id: 6201,
    searchOption: {
      keyword: 'Synthetic Rule Alpha',
      ignoreKeyword: 'Synthetic Ignore',
      channelIds: [4101, 4102],
      genres: [{ genre: 7, subGenre: 3 }],
      times: [{ week: 0x7f }],
    },
    reserveOption: {
      enable: true,
      allowEndLack: true,
      avoidDuplicate: false,
      periodToAvoidDuplicate: null,
    },
    saveOption: {
      parentDirectoryName: null,
      directory: 'Synthetic Rule Directory',
      recordedFormat: null,
    },
    reservesCnt: 3,
  },
  {
    id: 6202,
    searchOption: {
      times: [{ week: 0x7f }],
    },
    reserveOption: {
      enable: false,
      allowEndLack: true,
      avoidDuplicate: false,
      periodToAvoidDuplicate: null,
    },
    saveOption: {
      parentDirectoryName: null,
      directory: null,
      recordedFormat: null,
    },
  },
]

const minute = 60 * 1000

type MixedReserveKind = 'none' | 'manual' | 'rule' | 'conflict' | 'skip' | 'overlap'

const mixedReserveKinds: readonly MixedReserveKind[] = [
  'none',
  'manual',
  'rule',
  'conflict',
  'skip',
  'overlap',
]

/**
 * Search results for `searchResultsMixed`: `count` programs (20 by default) cycling through the six
 * reserve states, a long title on every third program, a short title on every third program, and
 * a program that crosses midnight (23:30 to 00:30) on every seventh one.
 */
export function createMixedSearchResults(count = 20) {
  return Array.from({ length: count }, (_, index) => {
    const crossesMidnight = index % 7 === 6
    const startAt = crossesMidnight
      ? Date.parse('2026-05-05T23:30:00+09:00')
      : searchProgramStart + index * 40 * minute
    const title =
      index % 3 === 0
        ? `Synthetic Long Search Program Title ${index + 1} ${'Extended '.repeat(8)}Tail`
        : index % 3 === 1
          ? `S${index + 1}`
          : `Synthetic Search Program ${index + 1}`

    return {
      id: 7001 + index,
      name: title,
      channelId: index % 2 === 0 ? 4101 : 4102,
      channelName: index % 2 === 0 ? 'Synthetic Search Channel' : 'Synthetic Search Channel Sub',
      startAt,
      endAt: startAt + (crossesMidnight ? 60 : 30) * minute,
      description: `Synthetic mixed search description ${index + 1}`,
      genre1: index % 16,
      subGenre1: index % 4,
    }
  })
}

function createMixedReserveLists(programs: ReturnType<typeof createMixedSearchResults>) {
  const lists: {
    normal: { id: number; reserveId: number; programId: number; ruleId?: number }[]
    conflicts: { id: number; reserveId: number; programId: number }[]
    skips: { id: number; reserveId: number; programId: number }[]
    overlaps: { id: number; reserveId: number; programId: number }[]
  } = { normal: [], conflicts: [], skips: [], overlaps: [] }

  programs.forEach((program, index) => {
    const kind = mixedReserveKinds[index % mixedReserveKinds.length]
    const reserve = { id: 7500 + index, reserveId: 7500 + index, programId: program.id }

    if (kind === 'manual') lists.normal.push(reserve)
    if (kind === 'rule') lists.normal.push({ ...reserve, ruleId: 7100 + index })
    if (kind === 'conflict') lists.conflicts.push(reserve)
    if (kind === 'skip') lists.skips.push(reserve)
    if (kind === 'overlap') lists.overlaps.push(reserve)
  })

  return lists
}

/**
 * Rules for `ruleMixedList`: `count` rules (12 by default) with and without a keyword, one or two
 * channels, one or two genres, `reservesCnt` undefined / 0 / positive, and a long keyword on every
 * fourth rule.
 */
export function createMixedRules(count = 12) {
  return Array.from({ length: count }, (_, index) => {
    const searchOption: Record<string, unknown> = {
      channelIds: index % 2 === 0 ? [4101, 4102] : [4101],
      genres:
        index % 2 === 0
          ? [
              { genre: 7, subGenre: 3 },
              { genre: 1, subGenre: 0 },
            ]
          : [{ genre: 2, subGenre: 1 }],
      times: [{ week: 0x7f }],
    }
    if (index % 3 !== 0) {
      searchOption.keyword =
        index % 4 === 1
          ? `SyntheticLongRuleKeyword${index + 1}${'Unbreakable'.repeat(6)}`
          : `Synthetic Mixed Rule ${index + 1}`
    }

    return {
      id: 7101 + index,
      searchOption,
      reserveOption: {
        enable: index % 5 !== 4,
        allowEndLack: true,
        avoidDuplicate: false,
        periodToAvoidDuplicate: null,
      },
      saveOption: {
        parentDirectoryName: null,
        directory: null,
        recordedFormat: null,
      },
      ...(index % 3 === 0 ? {} : { reservesCnt: index % 3 === 1 ? 0 : index + 2 }),
    }
  })
}

/**
 * Serves `GET /api/rules` for a rule list of `total` synthetic rules (1,125 = 47 pages at the
 * default 24 per page) and leaves every other request to the mocks installed before it. Rule ids
 * are `10000 + position`, so a row's id tells which page it came from.
 */
export async function installPagedRuleListApiMocks(
  page: Page,
  { total = 1125 }: { total?: number } = {},
): Promise<void> {
  await page.route(
    (url) => url.pathname.endsWith('/api/rules'),
    async (route) => {
      if (route.request().method() !== 'GET') {
        await route.fallback()
        return
      }

      const parameters = new URL(route.request().url()).searchParams
      const limit = Number(parameters.get('limit') ?? 24)
      const offset = Number(parameters.get('offset') ?? 0)
      const count = Math.max(0, Math.min(limit, total - offset))
      const rules = createMixedRules(count).map((rule, index) => ({
        ...rule,
        id: 10000 + offset + index,
      }))

      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ rules, total }),
      })
    },
  )
}

/**
 * Sets `isEnableExtendedPagination` in the saved settings before the app starts; `null` removes
 * the key so the app has to backfill its default.
 */
export async function seedExtendedPagination(page: Page, value: boolean | null): Promise<void> {
  await page.addInitScript((seeded) => {
    const saved = JSON.parse(window.localStorage.getItem('settings') ?? '{}') as Record<
      string,
      unknown
    >
    if (seeded === null) {
      delete saved.isEnableExtendedPagination
    } else {
      saved.isEnableExtendedPagination = seeded
    }
    window.localStorage.setItem('settings', JSON.stringify(saved))
  }, value)
}

export const searchRuleFixtureSecrecyText = JSON.stringify({
  searchChannels,
  searchPrograms,
  ruleList,
})

function pathnameOf(request: Request): string {
  return new URL(request.url).pathname
}

function createSearchRuleHandlers(requestLog?: SearchRuleRequestLog, mixed = false) {
  const activePrograms = mixed ? createMixedSearchResults() : searchPrograms
  const activeRules = mixed ? createMixedRules() : ruleList
  const reserveLists = mixed
    ? createMixedReserveLists(createMixedSearchResults())
    : { normal: [], conflicts: [], skips: [], overlaps: [] }

  return [
    http.get(
      ({ request }) => pathnameOf(request).endsWith('/api/channels'),
      () => HttpResponse.json(searchChannels),
    ),
    http.post(
      ({ request }) => pathnameOf(request).endsWith('/api/schedules/search'),
      async ({ request }) => {
        requestLog?.bodies.push(await request.json())
        return HttpResponse.json(activePrograms)
      },
    ),
    http.get(
      ({ request }) => pathnameOf(request).endsWith('/api/reserves/lists'),
      () => HttpResponse.json(reserveLists),
    ),
    http.post(
      ({ request }) => pathnameOf(request).endsWith('/api/reserves'),
      async ({ request }) => {
        requestLog?.bodies.push(await request.json())
        return HttpResponse.json({ reserveId: 6301 })
      },
    ),
    http.get(
      ({ request }) => pathnameOf(request).endsWith('/api/rules'),
      () => HttpResponse.json({ rules: activeRules, total: 384 }),
    ),
    http.post(
      ({ request }) => pathnameOf(request).endsWith('/api/rules'),
      async ({ request }) => {
        requestLog?.bodies.push(await request.json())
        return HttpResponse.json({ ruleId: 6401 })
      },
    ),
    http.get(
      ({ request }) => /\/api\/rules\/\d+$/.test(pathnameOf(request)),
      () => HttpResponse.json(ruleList[0]),
    ),
    http.put(
      ({ request }) => /\/api\/rules\/\d+\/(enable|disable)$/.test(pathnameOf(request)),
      () => new HttpResponse(null, { status: 204 }),
    ),
    http.put(
      ({ request }) => /\/api\/rules\/\d+$/.test(pathnameOf(request)),
      async ({ request }) => {
        requestLog?.bodies.push(await request.json())
        return new HttpResponse(null, { status: 204 })
      },
    ),
    http.delete(
      ({ request }) => /\/api\/rules\/\d+$/.test(pathnameOf(request)),
      () => new HttpResponse(null, { status: 204 }),
    ),
  ]
}

export async function installSearchRuleWorkflowApiMocks(
  page: Page,
  { requestLog, mixed = false }: { requestLog?: SearchRuleRequestLog; mixed?: boolean } = {},
): Promise<void> {
  const handlers = createSearchRuleHandlers(requestLog, mixed)

  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url())
    requestLog?.apiPaths.push(`${url.pathname}${url.search}`)
    requestLog?.methods.push(`${route.request().method()} ${url.pathname}`)
    const response = await getResponse(handlers, await createMswRequest(route))

    if (response === undefined) {
      await route.fallback()
      return
    }

    await fulfillMswResponse(route, response)
  })
}

export async function installSearchRuleRealtimeApiMocks(
  page: Page,
  { requestLog }: { requestLog?: SearchRuleRequestLog } = {},
): Promise<SearchRuleRealtimeMockController> {
  let activeSearchPrograms = searchPrograms
  let activeRuleList = ruleList
  let hasReserveIndex = true

  const handlers = [
    http.get(
      ({ request }) => pathnameOf(request).endsWith('/api/channels'),
      () => HttpResponse.json(searchChannels),
    ),
    http.post(
      ({ request }) => pathnameOf(request).endsWith('/api/schedules/search'),
      async ({ request }) => {
        requestLog?.bodies.push(await request.json())
        return HttpResponse.json(activeSearchPrograms)
      },
    ),
    http.get(
      ({ request }) => pathnameOf(request).endsWith('/api/reserves/lists'),
      () =>
        HttpResponse.json({
          normal: hasReserveIndex ? [{ id: 6301, reserveId: 6301, programId: 6101 }] : [],
          conflicts: [],
          skips: [],
          overlaps: [],
        }),
    ),
    http.get(
      ({ request }) => pathnameOf(request).endsWith('/api/rules'),
      () => HttpResponse.json({ rules: activeRuleList, total: activeRuleList.length }),
    ),
    ...createSearchRuleHandlers(requestLog),
  ]

  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url())
    requestLog?.apiPaths.push(`${url.pathname}${url.search}`)
    requestLog?.methods.push(`${route.request().method()} ${url.pathname}`)
    const response = await getResponse(handlers, await createMswRequest(route))

    if (response === undefined) {
      await route.fallback()
      return
    }

    await fulfillMswResponse(route, response)
  })

  return {
    clearSearchPrograms: () => {
      activeSearchPrograms = []
    },
    clearRuleList: () => {
      activeRuleList = []
    },
    clearReserveIndex: () => {
      hasReserveIndex = false
    },
  }
}

// Fixture for `.kiro/specs/frontend-search-rule/requirements.md` 要求 3 AC27: a single Rule list
// row that simultaneously carries a long, unbreakable keyword, more than one channel and more than
// one genre (so `ruleChannel`/`ruleGenre` both append ` 他<n>`), so the row's crowded-content
// no-overlap/no-overflow contract can be checked in a real browser instead of only by reading the
// CSS declarations that are supposed to guarantee it.
const crowdedRuleChannels = [
  {
    id: 9101,
    name: 'Synthetic Crowded Channel With An Extremely Long Broadcast Name For Overflow Testing',
    halfWidthName:
      'Synthetic Crowded Channel With An Extremely Long Broadcast Name For Overflow Testing',
  },
  {
    id: 9102,
    name: 'Synthetic Crowded Channel Sub',
    halfWidthName: 'Synthetic Crowded Channel Sub',
  },
  {
    id: 9103,
    name: 'Synthetic Crowded Channel Third',
    halfWidthName: 'Synthetic Crowded Channel Third',
  },
]

const crowdedRule = {
  id: 6210,
  searchOption: {
    keyword: 'SyntheticCrowdedRuleKeywordThatIsVeryLongAndUnbreakableForOverlapTesting1234567890',
    ignoreKeyword: 'SyntheticCrowdedIgnoreKeywordAlsoVeryLongAndUnbreakableForOverlapTesting',
    channelIds: [9101, 9102, 9103],
    // genre 4/10 and 10/6 resolve to long labels ('民族音楽・ワールドミュージック',
    // 'コンピュータ・ＴＶゲーム') via `searchGenreLabel`
    // (client/src/features/search/rule/genreLabels.ts) so `ruleGenre()` produces a long
    // "<label> 他1" string, matching the long "<name> 他2" `ruleChannel()` produces above.
    genres: [
      { genre: 4, subGenre: 10 },
      { genre: 10, subGenre: 6 },
    ],
    times: [{ week: 0x7f }],
  },
  reserveOption: {
    enable: true,
    allowEndLack: true,
    avoidDuplicate: false,
    periodToAvoidDuplicate: null,
  },
  saveOption: {
    parentDirectoryName: null,
    directory: 'Synthetic Crowded Rule Directory',
    recordedFormat: null,
  },
  reservesCnt: 128,
}

export async function installSearchRuleCrowdedRowApiMocks(
  page: Page,
  { requestLog }: { requestLog?: SearchRuleRequestLog } = {},
): Promise<void> {
  const handlers = [
    http.get(
      ({ request }) => pathnameOf(request).endsWith('/api/channels'),
      () => HttpResponse.json(crowdedRuleChannels),
    ),
    http.get(
      ({ request }) => pathnameOf(request).endsWith('/api/rules'),
      () => HttpResponse.json({ rules: [crowdedRule], total: 1 }),
    ),
    ...createSearchRuleHandlers(requestLog),
  ]

  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url())
    requestLog?.apiPaths.push(`${url.pathname}${url.search}`)
    requestLog?.methods.push(`${route.request().method()} ${url.pathname}`)
    const response = await getResponse(handlers, await createMswRequest(route))

    if (response === undefined) {
      await route.fallback()
      return
    }

    await fulfillMswResponse(route, response)
  })
}
