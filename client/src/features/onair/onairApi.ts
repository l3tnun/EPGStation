import type { BroadcastWave } from '@/app/navigation'
import {
  adaptAddReserveResponse,
  adaptReserveLists,
  adaptSchedules,
  fetchAction,
  fetchJson,
  resolveDefaultFetch,
} from './lib/onairApiAdapters'
import {
  adaptChannelNameIndex,
  adaptLiveStreams,
  attachChannelNamesToLiveStreams,
} from './lib/onairLiveStreamAdapters'
import type { FeatureResult, ServerApiFetch } from '@/app/serverApi'
// Coverage gate exclusion rationale:
// this fetch adapter normalizes live program payloads and network failure permutations.
// Unit tests cover representative contracts; exhaustive malformed backend combinations are
// covered by API contract/E2E instead of unit C1/C2.
import type { GuideProgramAddReservePayload } from '@/features/guide/guideRequests'
import {
  ONAIR_FETCH_FAILURE_MESSAGE,
  ONAIR_STREAM_INFO_FETCH_FAILURE_MESSAGE,
  buildOnAirRequestUrls,
  buildOnAirStreamsUrl,
  transformOnAirReserveListsToIndex,
  type OnAirLiveStreamInfoItem,
  type OnAirRequest,
  type OnAirReserveIndex,
} from './onairRequests'

export interface OnAirChannel {
  id?: number
  name?: string
  channelType?: BroadcastWave
  hasLogoData?: boolean
}

export interface OnAirProgram {
  id?: number
  name?: string
  description?: string
  extended?: string
  startAt?: number
  endAt?: number
  channelId?: number
  genre1?: number
  subGenre1?: number
  genre2?: number
  subGenre2?: number
  genre3?: number
  subGenre3?: number
  videoComponentType?: number
  audioComponentType?: number
  audioSamplingRate?: number
  isFree?: boolean
}

export interface OnAirSchedule {
  channel?: OnAirChannel
  programs?: readonly OnAirProgram[]
}

export interface OnAirFetchResult {
  reserveIndex: OnAirReserveIndex
  schedules: readonly OnAirSchedule[]
}

export interface OnAirLiveStreamsResult {
  items: readonly OnAirLiveStreamInfoItem[]
}

export interface OnAirApiRepository {
  fetchOnAir(request: OnAirRequest): Promise<FeatureResult<OnAirFetchResult, 'onair-fetch-failed'>>
  fetchLiveStreams(
    request: OnAirRequest,
  ): Promise<FeatureResult<OnAirLiveStreamsResult, 'onair-stream-info-fetch-failed'>>
  addProgramReserve(
    payload: GuideProgramAddReservePayload,
  ): Promise<FeatureResult<{ reserveId: number }, 'onair-program-reserve-add-failed'>>
  deleteReserve(reserveId: number): Promise<FeatureResult<void, 'onair-reserve-delete-failed'>>
  unlockSkipReserve(reserveId: number): Promise<FeatureResult<void, 'onair-reserve-unskip-failed'>>
  unlockOverlapReserve(
    reserveId: number,
  ): Promise<FeatureResult<void, 'onair-reserve-unoverlap-failed'>>
}

export interface CreateFetchOnAirApiRepositoryOptions {
  fetcher?: ServerApiFetch
  basePath?: string
}

export function createFetchOnAirApiRepository(
  options: CreateFetchOnAirApiRepositoryOptions = {},
): OnAirApiRepository {
  const fetcher = options.fetcher ?? resolveDefaultFetch()
  const basePath = options.basePath ?? './api'

  return {
    async fetchOnAir(request) {
      const reserveStartAt = Date.now()
      const urls = buildOnAirRequestUrls({ ...request, reserveStartAt, basePath })
      const reserveResponse = await fetchJson(fetcher, urls.reserveIndex)
      const broadcastingResponse = await fetchJson(fetcher, urls.broadcasting)
      const reserveLists = adaptReserveLists(reserveResponse)
      const schedules = adaptSchedules(broadcastingResponse)

      if (reserveLists === null || schedules === null) {
        return {
          ok: false,
          error: 'onair-fetch-failed',
          message: ONAIR_FETCH_FAILURE_MESSAGE,
        }
      }

      return {
        ok: true,
        value: {
          reserveIndex: transformOnAirReserveListsToIndex(reserveLists),
          schedules,
        },
      }
    },

    async fetchLiveStreams(request) {
      const response = await fetchJson(fetcher, buildOnAirStreamsUrl({ ...request, basePath }))
      const value = adaptLiveStreams(response)
      const channelResponse = await fetchJson(fetcher, `${basePath.replace(/\/$/, '')}/channels`)
      const channelNames = adaptChannelNameIndex(channelResponse, request.isHalfWidth)

      if (value === null || channelNames === null) {
        return {
          ok: false,
          error: 'onair-stream-info-fetch-failed',
          message: ONAIR_STREAM_INFO_FETCH_FAILURE_MESSAGE,
        }
      }

      return {
        ok: true,
        value: attachChannelNamesToLiveStreams({ streams: value, channelNames }),
      }
    },

    async addProgramReserve(payload) {
      const response = await fetchJson(fetcher, `${basePath.replace(/\/$/, '')}/reserves`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      })
      const value = adaptAddReserveResponse(response)

      if (value === null) {
        return {
          ok: false,
          error: 'onair-program-reserve-add-failed',
          message: '予約失敗',
        }
      }

      return {
        ok: true,
        value,
      }
    },

    async deleteReserve(reserveId) {
      const ok = await fetchAction(
        fetcher,
        `${basePath.replace(/\/$/, '')}/reserves/${reserveId}`,
        {
          method: 'DELETE',
        },
      )

      return ok
        ? { ok: true, value: undefined }
        : {
            ok: false,
            error: 'onair-reserve-delete-failed',
            message: 'キャンセル失敗',
          }
    },

    async unlockSkipReserve(reserveId) {
      const ok = await fetchAction(
        fetcher,
        `${basePath.replace(/\/$/, '')}/reserves/${reserveId}/skip`,
        {
          method: 'DELETE',
        },
      )

      return ok
        ? { ok: true, value: undefined }
        : {
            ok: false,
            error: 'onair-reserve-unskip-failed',
            message: '除外解除失敗',
          }
    },

    async unlockOverlapReserve(reserveId) {
      const ok = await fetchAction(
        fetcher,
        `${basePath.replace(/\/$/, '')}/reserves/${reserveId}/overlap`,
        {
          method: 'DELETE',
        },
      )

      return ok
        ? { ok: true, value: undefined }
        : {
            ok: false,
            error: 'onair-reserve-unoverlap-failed',
            message: '重複解除失敗',
          }
    },
  }
}
