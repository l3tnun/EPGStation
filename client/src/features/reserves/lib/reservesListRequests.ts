import type { SettingsConsumerValue } from '@/shared/settings'
import { buildReserveEndpointUrl } from './reserveEndpoint'

export type ReservesRouteType = 'normal' | 'conflict' | 'overlap' | 'skip'
export type ReservesApiType = 'all' | ReservesRouteType
export type ReserveVisualState = 'skip' | 'conflict' | 'overlap' | 'reserve'
export type ReservesLayout = 'card' | 'table'

export interface ReservesListRequest {
  type: ReservesApiType
  isHalfWidth: boolean
  limit: number
  offset: number
  page: number
  routeType: ReservesRouteType | undefined
}

export const RESERVES_QUERY_KEY = ['reserves', 'list'] as const
export const RESERVES_FAILURE_MESSAGE = '予約データ取得に失敗'
export const RESERVES_UPDATE_STARTED_MESSAGE = '予約情報の更新開始'
export const RESERVES_UPDATE_FAILURE_MESSAGE = '予約情報の更新を開始できませんでした。'

const RESERVES_ROUTE_TITLES: Record<ReservesRouteType, string> = {
  normal: '予約',
  conflict: '競合',
  overlap: '重複',
  skip: '除外',
}

function parsePositivePage(value: string | null): number {
  if (value === null || value === '') {
    return 1
  }

  const parsed = Number(value)

  return Number.isInteger(parsed) && parsed >= 1 ? parsed : 1
}

function parseReservesType(value: string | null): {
  type: ReservesApiType
  routeType: ReservesRouteType | undefined
} {
  if (value === null) {
    return {
      type: 'all',
      routeType: undefined,
    }
  }

  if (value === 'normal' || value === 'conflict' || value === 'overlap' || value === 'skip') {
    return {
      type: value,
      routeType: value,
    }
  }

  return {
    type: 'normal',
    routeType: 'normal',
  }
}

export function buildReservesListRequest({
  settings,
  search,
}: {
  settings: SettingsConsumerValue
  search: string
}): ReservesListRequest {
  const parameters = new URLSearchParams(search)
  const page = parsePositivePage(parameters.get('page'))
  const type = parseReservesType(parameters.get('type'))

  return {
    type: type.type,
    isHalfWidth: settings.isHalfWidthDisplayed,
    limit: settings.reservesLength,
    offset: (page - 1) * settings.reservesLength,
    page,
    routeType: type.routeType,
  }
}

function appendReservesRequestParameters(
  parameters: URLSearchParams,
  request: ReservesListRequest,
): void {
  parameters.set('type', request.type)
  parameters.set('isHalfWidth', String(request.isHalfWidth))
  parameters.set('limit', String(request.limit))
  parameters.set('offset', String(request.offset))
}

export function buildReservesListRequestUrl({
  settings,
  search,
  basePath = './api',
}: {
  settings: SettingsConsumerValue
  search: string
  basePath?: string
}): string {
  const request = buildReservesListRequest({ settings, search })
  const parameters = new URLSearchParams()

  appendReservesRequestParameters(parameters, request)

  return buildReserveEndpointUrl(basePath, '/reserves', parameters)
}

export function buildReservesListRequestUrlFromRequest({
  request,
  basePath = './api',
}: {
  request: ReservesListRequest
  basePath?: string
}): string {
  const parameters = new URLSearchParams()

  appendReservesRequestParameters(parameters, request)

  return buildReserveEndpointUrl(basePath, '/reserves', parameters)
}

export function buildReservesPageSearch({
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

export function createReservesQueryKey({
  settings,
  search,
}: {
  settings: SettingsConsumerValue
  search: string
}) {
  return [...RESERVES_QUERY_KEY, search, buildReservesListRequest({ settings, search })] as const
}

export function resolveReservesTitle(routeType: ReservesRouteType | undefined): string {
  return routeType === undefined ? '予約' : RESERVES_ROUTE_TITLES[routeType]
}

// v2 `client/src/components/reserves/ReserveItems.vue:38` は `this.$el.clientWidth >= 900` を
// `ResizeObserver` で判定する。`$el` は component root の `<div>` で padding を持たず、v2 build を
// 実ブラウザで測ると viewport より 16px 狭い。v2 は viewport 915px で card、**916px で table** に
// 切り替わる（実測。916 のとき root の clientWidth が 900）。
//
// v3 が測る `.reservesPage` は `box-sizing: border-box` で自身に padding 8px を持つため
// `clientWidth` に左右 16px が含まれ、全幅のとき viewport と一致する。したがって v2 の
// 「content 幅 900」は v3 の「`.reservesPage` clientWidth 916」と同じ境界である。
export function resolveReservesLayout(containerWidth: number): ReservesLayout {
  return containerWidth >= 916 ? 'table' : 'card'
}
