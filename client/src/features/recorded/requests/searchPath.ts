import type { SettingsConsumerValue } from '@/shared/settings'
import { RECORDED_DETAIL_QUERY_KEY, RECORDED_QUERY_KEY } from './constants'
import { buildRecordedListRequest } from './listRequest'

export function buildRecordedPageSearch({
  search,
  page,
}: {
  search: string
  page: number
}): string {
  const parameters = new URLSearchParams(search)

  parameters.delete('timestamp')
  parameters.set('page', String(page))

  return `?${parameters.toString()}`
}

export function createRecordedQueryKey({
  settings,
  search,
}: {
  settings: SettingsConsumerValue
  search: string
}) {
  return [...RECORDED_QUERY_KEY, search, buildRecordedListRequest({ settings, search })] as const
}

export interface RecordedDetailRequest {
  recordedId: number
  isHalfWidth: boolean
}

export function createRecordedDetailQueryKey(request: RecordedDetailRequest) {
  return [...RECORDED_DETAIL_QUERY_KEY, request] as const
}

type NullableNumber = number | null | undefined

export interface RecordedSearchPathInput {
  keyword?: string | null
  ruleId?: NullableNumber
  channelId?: NullableNumber
  genre?: NullableNumber
  hasOriginalFile?: boolean | null
}

function appendPathQuery(parameters: URLSearchParams, key: string, value: string | number): void {
  parameters.set(key, String(value))
}

function buildPath(pathname: string, parameters: URLSearchParams): string {
  const query = parameters.toString()

  return query === '' ? pathname : `${pathname}?${query}`
}

export function buildRecordedSearchPath(input: RecordedSearchPathInput): string {
  const parameters = new URLSearchParams()
  const keyword = input.keyword?.trim()

  if (keyword !== undefined && keyword !== '') {
    appendPathQuery(parameters, 'keyword', keyword)
  }
  if (input.ruleId !== undefined && input.ruleId !== null) {
    appendPathQuery(parameters, 'ruleId', input.ruleId)
  }
  if (input.channelId !== undefined && input.channelId !== null) {
    appendPathQuery(parameters, 'channelId', input.channelId)
  }
  if (input.genre !== undefined && input.genre !== null) {
    appendPathQuery(parameters, 'genre', input.genre)
  }
  if (input.hasOriginalFile === true) {
    appendPathQuery(parameters, 'hasOriginalFile', 'true')
  }

  return buildPath('/recorded', parameters)
}

export function createRecordedSearchKeyword(name: string | undefined): string {
  const outTitle = (name ?? '')
    .replace(/\[.+?\]/g, ' ')
    .replace(/【.+?】/g, ' ')
    .replace(/\(.\)/g, ' ')
    .replace(/ +/g, ' ')
    .trim()
  const delimiter = outTitle.includes(' #') ? ' #' : outTitle.includes('「') ? '「' : ''
  const keyword = delimiter === '' ? outTitle : outTitle.slice(0, outTitle.indexOf(delimiter))

  return keyword === '' ? outTitle : keyword
}

export function buildItemRuleSearchPath({ ruleId }: { ruleId?: number }): string {
  if (ruleId === undefined) {
    return '/search'
  }

  return `/search?rule=${ruleId}`
}

export function buildItemRecordedSearchPath({
  ruleId,
  name,
}: {
  ruleId?: number
  name?: string
}): string {
  if (ruleId !== undefined) {
    return `/recorded?ruleId=${ruleId}`
  }

  const parameters = new URLSearchParams()
  const keyword = createRecordedSearchKeyword(name)

  if (keyword !== '') {
    parameters.set('keyword', keyword)
  }

  return buildPath('/recorded', parameters)
}
