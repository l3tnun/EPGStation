import type { SettingsConsumerValue } from '@/shared/settings'

export interface DashboardRecordingRequest {
  isHalfWidth: boolean
  offset: number
  limit: number
}

export interface DashboardRecordedRequest extends DashboardRecordingRequest {
  keyword?: string
  ruleId?: number
  channelId?: number
  genre?: number
  hasOriginalFile?: boolean
}

export interface DashboardReservesRequest extends DashboardRecordingRequest {
  type: 'normal'
}

export interface DashboardSummaryRequestSet {
  recording: DashboardRecordingRequest
  recorded: DashboardRecordedRequest
  reserves: DashboardReservesRequest
}

export interface DashboardSummaryRequestUrls {
  reserveCounts: string
  recording: string
  recorded: string
  reserves: string
}

export const DASHBOARD_QUERY_KEY = ['dashboard', 'summary'] as const

export const DASHBOARD_FAILURE_MESSAGES = {
  reserveCounts: '予約情報取得に失敗',
  recording: '録画中データ取得に失敗',
  recorded: '録画済みデータ取得に失敗',
  reserves: '予約データ取得に失敗',
} as const

function appendNumberFilter(
  parameters: URLSearchParams,
  searchParameters: URLSearchParams,
  key: 'ruleId' | 'channelId' | 'genre',
): void {
  const value = searchParameters.get(key)

  if (value === null || value === '') {
    return
  }

  const parsed = Number(value)

  if (!Number.isInteger(parsed)) {
    return
  }

  parameters.set(key, String(parsed))
}

function createRecordedRequest(
  settings: SettingsConsumerValue,
  searchParameters: URLSearchParams,
): DashboardRecordedRequest {
  const request: DashboardRecordedRequest = {
    isHalfWidth: settings.isHalfWidthDisplayed,
    offset: 0,
    limit: settings.recordedLength,
  }
  const keyword = searchParameters.get('keyword')
  const hasOriginalFile = searchParameters.get('hasOriginalFile')

  if (keyword !== null) {
    request.keyword = keyword
  }
  ;(['ruleId', 'channelId', 'genre'] as const).forEach((key) => {
    const value = searchParameters.get(key)

    if (value === null || value === '') {
      return
    }

    const parsed = Number(value)

    if (Number.isInteger(parsed)) {
      request[key] = parsed
    }
  })
  if (hasOriginalFile === 'true' || hasOriginalFile === 'false') {
    request.hasOriginalFile = hasOriginalFile === 'true'
  }

  return request
}

export function buildDashboardSummaryRequestSet({
  settings,
  search,
}: {
  settings: SettingsConsumerValue
  search: string
}): DashboardSummaryRequestSet {
  const searchParameters = new URLSearchParams(search)

  return {
    recording: {
      isHalfWidth: settings.isHalfWidthDisplayed,
      offset: 0,
      limit: settings.recordingLength,
    },
    recorded: createRecordedRequest(settings, searchParameters),
    reserves: {
      type: 'normal',
      isHalfWidth: settings.isHalfWidthDisplayed,
      offset: 0,
      limit: settings.reservesLength,
    },
  }
}

function appendCommonRequestParameters(
  parameters: URLSearchParams,
  request: DashboardRecordingRequest,
): void {
  parameters.set('isHalfWidth', String(request.isHalfWidth))
  parameters.set('offset', String(request.offset))
  parameters.set('limit', String(request.limit))
}

function buildEndpointUrl(basePath: string, endpointPath: string, parameters?: URLSearchParams) {
  const endpoint = `${basePath.replace(/\/$/, '')}${endpointPath}`
  const query = parameters?.toString()

  return query === undefined || query === '' ? endpoint : `${endpoint}?${query}`
}

export function buildDashboardSummaryRequests({
  settings,
  search,
  basePath = './api',
}: {
  settings: SettingsConsumerValue
  search: string
  basePath?: string
}): DashboardSummaryRequestUrls {
  const requestSet = buildDashboardSummaryRequestSet({ settings, search })
  const recordingParameters = new URLSearchParams()
  const recordedParameters = new URLSearchParams()
  const reservesParameters = new URLSearchParams()
  const searchParameters = new URLSearchParams(search)

  appendCommonRequestParameters(recordingParameters, requestSet.recording)
  appendCommonRequestParameters(recordedParameters, requestSet.recorded)
  const keyword = searchParameters.get('keyword')
  if (keyword !== null) {
    recordedParameters.set('keyword', keyword)
  }
  appendNumberFilter(recordedParameters, searchParameters, 'ruleId')
  appendNumberFilter(recordedParameters, searchParameters, 'channelId')
  appendNumberFilter(recordedParameters, searchParameters, 'genre')
  if (requestSet.recorded.hasOriginalFile !== undefined) {
    recordedParameters.set('hasOriginalFile', String(requestSet.recorded.hasOriginalFile))
  }
  reservesParameters.set('type', requestSet.reserves.type)
  appendCommonRequestParameters(reservesParameters, requestSet.reserves)

  return {
    reserveCounts: buildEndpointUrl(basePath, '/reserves/cnts'),
    recording: buildEndpointUrl(basePath, '/recording', recordingParameters),
    recorded: buildEndpointUrl(basePath, '/recorded', recordedParameters),
    reserves: buildEndpointUrl(basePath, '/reserves', reservesParameters),
  }
}

export function formatDashboardSectionTitle(label: string, visibleCount: number, total: number) {
  return `${label} ${visibleCount}/${total}`
}
