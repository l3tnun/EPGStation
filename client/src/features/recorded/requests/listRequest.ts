import type { SettingsConsumerValue } from '@/shared/settings'

export interface RecordedListRequest {
  isHalfWidth: boolean
  limit: number
  offset: number
  page: number
  keyword?: string
  ruleId?: number
  channelId?: number
  genre?: number
  hasOriginalFile?: boolean
}

const FILTER_QUERY_KEYS = ['keyword', 'ruleId', 'channelId', 'genre', 'hasOriginalFile'] as const

export function toggleVisibleRecordedSelection({
  currentSelectedIds,
  visibleRecordedIds,
  action,
}: {
  currentSelectedIds: ReadonlySet<number>
  visibleRecordedIds: readonly number[]
  action: 'select-all' | 'preserve-visible'
}): Set<number> {
  const visibleIds = new Set(visibleRecordedIds)

  if (action === 'preserve-visible') {
    return new Set([...currentSelectedIds].filter((id) => visibleIds.has(id)))
  }

  const areAllVisibleSelected =
    visibleRecordedIds.length > 0 && visibleRecordedIds.every((id) => currentSelectedIds.has(id))

  return areAllVisibleSelected
    ? new Set([...currentSelectedIds].filter((id) => !visibleIds.has(id)))
    : new Set([...currentSelectedIds, ...visibleRecordedIds])
}

function parsePositivePage(value: string | null): number {
  if (value === null || value === '') {
    return 1
  }

  const parsed = Number(value)

  return Number.isInteger(parsed) && parsed >= 1 ? parsed : 1
}

function parseIntegerFilter(parameters: URLSearchParams, key: 'ruleId' | 'channelId' | 'genre') {
  const value = parameters.get(key)

  if (value === null || value === '') {
    return undefined
  }

  const parsed = Number(value)

  return Number.isInteger(parsed) ? parsed : undefined
}

export function buildRecordedListRequest({
  settings,
  search,
}: {
  settings: SettingsConsumerValue
  search: string
}): RecordedListRequest {
  const parameters = new URLSearchParams(search)
  const page = parsePositivePage(parameters.get('page'))
  const request: RecordedListRequest = {
    isHalfWidth: settings.isHalfWidthDisplayed,
    limit: settings.recordedLength,
    offset: (page - 1) * settings.recordedLength,
    page,
  }
  const keyword = parameters.get('keyword')
  const ruleId = parseIntegerFilter(parameters, 'ruleId')
  const channelId = parseIntegerFilter(parameters, 'channelId')
  const genre = parseIntegerFilter(parameters, 'genre')
  const hasOriginalFile = parameters.get('hasOriginalFile')

  if (keyword !== null) {
    request.keyword = keyword
  }
  if (ruleId !== undefined) {
    request.ruleId = ruleId
  }
  if (channelId !== undefined) {
    request.channelId = channelId
  }
  if (genre !== undefined) {
    request.genre = genre
  }
  if (hasOriginalFile === 'true') {
    request.hasOriginalFile = true
  }

  return request
}

function appendRecordedRequestParameters(
  parameters: URLSearchParams,
  request: RecordedListRequest,
): void {
  parameters.set('isHalfWidth', String(request.isHalfWidth))
  parameters.set('limit', String(request.limit))
  parameters.set('offset', String(request.offset))

  FILTER_QUERY_KEYS.forEach((key) => {
    const value = request[key]

    if (value !== undefined) {
      parameters.set(key, String(value))
    }
  })
}

function buildEndpointUrl(
  basePath: string,
  endpointPath: '/recorded' | `/recorded/${number}`,
  parameters: URLSearchParams,
) {
  return `${basePath.replace(/\/$/, '')}${endpointPath}?${parameters.toString()}`
}

export function buildRecordedDetailRequestUrl({
  recordedId,
  isHalfWidth,
  basePath = './api',
}: {
  recordedId: number
  isHalfWidth: boolean
  basePath?: string
}): string {
  const parameters = new URLSearchParams()
  parameters.set('isHalfWidth', String(isHalfWidth))

  return buildEndpointUrl(basePath, `/recorded/${recordedId}`, parameters)
}

export function buildRecordedListRequestUrl({
  settings,
  search,
  basePath = './api',
}: {
  settings: SettingsConsumerValue
  search: string
  basePath?: string
}): string {
  const request = buildRecordedListRequest({ settings, search })
  const parameters = new URLSearchParams()

  appendRecordedRequestParameters(parameters, request)

  return buildEndpointUrl(basePath, '/recorded', parameters)
}

export function buildRuleKeywordRequestUrl({
  keyword,
  basePath = './api',
}: {
  keyword?: string | null
  basePath?: string
}): string {
  const parameters = new URLSearchParams({ limit: '1000' })

  if (keyword !== undefined && keyword !== null) {
    parameters.set('keyword', keyword)
  }

  return `${basePath.replace(/\/$/, '')}/rules/keyword?${parameters.toString()}`
}
