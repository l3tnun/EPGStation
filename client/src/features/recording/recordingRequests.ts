import type { SettingsConsumerValue } from '@/shared/settings'

export interface RecordingListRequest {
  isHalfWidth: boolean
  limit: number
  offset: number
  page: number
}

export const RECORDING_QUERY_KEY = ['recording', 'list'] as const
export const RECORDING_FAILURE_MESSAGE = '録画データ取得に失敗'

function parsePositivePage(value: string | null): number {
  if (value === null || value === '') {
    return 1
  }

  const parsed = Number(value)

  return Number.isInteger(parsed) && parsed >= 1 ? parsed : 1
}

export function buildRecordingListRequest({
  settings,
  search,
}: {
  settings: SettingsConsumerValue
  search: string
}): RecordingListRequest {
  const page = parsePositivePage(new URLSearchParams(search).get('page'))

  return {
    isHalfWidth: settings.isHalfWidthDisplayed,
    limit: settings.recordingLength,
    offset: (page - 1) * settings.recordingLength,
    page,
  }
}

export function buildRecordingListRequestUrl({
  settings,
  search,
  basePath = './api',
}: {
  settings: SettingsConsumerValue
  search: string
  basePath?: string
}): string {
  const request = buildRecordingListRequest({ settings, search })
  const parameters = new URLSearchParams()
  parameters.set('isHalfWidth', String(request.isHalfWidth))
  parameters.set('limit', String(request.limit))
  parameters.set('offset', String(request.offset))

  return `${basePath.replace(/\/$/, '')}/recording?${parameters.toString()}`
}

export function buildRecordingListRequestUrlFromRequest({
  request,
  basePath = './api',
}: {
  request: RecordingListRequest
  basePath?: string
}): string {
  const parameters = new URLSearchParams()
  parameters.set('isHalfWidth', String(request.isHalfWidth))
  parameters.set('limit', String(request.limit))
  parameters.set('offset', String(request.offset))

  return `${basePath.replace(/\/$/, '')}/recording?${parameters.toString()}`
}

export function buildRecordingPageSearch({
  search,
  page,
}: {
  search: string
  page: number
}): string {
  const parameters = new URLSearchParams(search)
  parameters.delete('timestamp')

  if (page <= 1) {
    parameters.delete('page')
  } else {
    parameters.set('page', String(page))
  }

  const query = parameters.toString()
  return query === '' ? '' : `?${query}`
}
export function createRecordingQueryKey({
  settings,
  search,
}: {
  settings: SettingsConsumerValue
  search: string
}) {
  return [...RECORDING_QUERY_KEY, search, buildRecordingListRequest({ settings, search })] as const
}

export function toggleVisibleRecordingSelection({
  currentSelectedIds,
  visibleRecordingIds,
  action,
}: {
  currentSelectedIds: ReadonlySet<number>
  visibleRecordingIds: readonly number[]
  action: 'select-all' | 'preserve-visible'
}): Set<number> {
  const visible = new Set(visibleRecordingIds)

  if (action === 'preserve-visible') {
    return new Set([...currentSelectedIds].filter((id) => visible.has(id)))
  }

  const isAllSelected =
    visibleRecordingIds.length > 0 && visibleRecordingIds.every((id) => currentSelectedIds.has(id))

  return isAllSelected ? new Set() : new Set(visibleRecordingIds)
}
