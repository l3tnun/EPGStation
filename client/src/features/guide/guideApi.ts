import type { FeatureResult, ServerApiFetch } from '@/app/serverApi'
import {
  adaptAddReserveResponse,
  adaptReserveLists,
  adaptSchedule,
  fetchAction,
  fetchJson,
  resolveDefaultFetch,
} from './lib/guideApiAdapters'
// Coverage gate exclusion rationale:
// this fetch adapter handles backend schedule/reserve payload drift and transport failures.
// Unit tests cover representative valid/invalid contracts; exhaustive malformed backend
// combinations are API contract/E2E responsibility, not unit C1/C2.
import type {
  GuideProgramAddReservePayload,
  GuideFetchRequestSet,
  GuideReserveIndex,
  GuideReserveIndexRequest,
  GuideScheduleRequest,
} from './guideRequests'
import {
  GUIDE_FETCH_FAILURE_MESSAGE,
  buildGuideRequestUrls,
  transformReserveListsToIndex,
} from './guideRequests'

export interface GuideChannel {
  id?: number
  name?: string
  type?: number
}

export interface GuideProgram {
  id?: number
  name?: string
  description?: string
  startAt?: number
  endAt?: number
  channelId?: number
  genre1?: number
  subGenre1?: number
  genre2?: number
  subGenre2?: number
  genre3?: number
  subGenre3?: number
  extended?: string
  videoComponentType?: number
  audioComponentType?: number
  audioSamplingRate?: number
  isFree?: boolean
}

export interface GuideSchedule {
  channel?: GuideChannel
  programs?: readonly GuideProgram[]
}

export interface GuideApiRepository {
  fetchSchedule(
    request: GuideScheduleRequest,
  ): Promise<
    FeatureResult<GuideSchedule[], 'guide-schedule-fetch-failed' | 'guide-channel-not-found'>
  >
  fetchReserveIndex(
    request: GuideReserveIndexRequest,
  ): Promise<FeatureResult<GuideReserveIndex, 'guide-reserve-index-fetch-failed'>>
  triggerReserveUpdate(): Promise<
    FeatureResult<Record<string, never>, 'guide-reserve-update-failed'>
  >
  addProgramReserve(
    payload: GuideProgramAddReservePayload,
  ): Promise<FeatureResult<{ reserveId: number }, 'guide-program-reserve-add-failed'>>
  deleteReserve(reserveId: number): Promise<FeatureResult<void, 'guide-reserve-delete-failed'>>
  unlockSkipReserve(reserveId: number): Promise<FeatureResult<void, 'guide-reserve-unskip-failed'>>
  unlockOverlapReserve(
    reserveId: number,
  ): Promise<FeatureResult<void, 'guide-reserve-unoverlap-failed'>>
}

export interface CreateFetchGuideApiRepositoryOptions {
  fetcher?: ServerApiFetch
  basePath?: string
}

function createRequestSetFromScheduleRequest(
  request: GuideScheduleRequest | GuideReserveIndexRequest,
): GuideFetchRequestSet {
  if ('mode' in request) {
    const endAt =
      request.mode === 'normal'
        ? request.endAt
        : request.startAt + request.days * 24 * 60 * 60 * 1000

    return {
      guideQuery: {
        mode: request.mode,
        startAt: request.startAt,
        isTimeQueryValid: true,
        ...(request.mode === 'singleChannel' ? { channelId: request.channelId } : {}),
      },
      schedule: request,
      reserveIndex: {
        startAt: request.startAt,
        endAt,
      },
    }
  }

  return {
    guideQuery: {
      mode: 'normal',
      startAt: request.startAt,
      isTimeQueryValid: true,
    },
    schedule: {
      mode: 'normal',
      startAt: request.startAt,
      endAt: request.endAt,
      isHalfWidth: true,
      isFree: false,
      GR: true,
      BS: true,
      CS: true,
      SKY: true,
      BS4K: true,
    },
    reserveIndex: request,
  }
}

export function createFetchGuideApiRepository(
  options: CreateFetchGuideApiRepositoryOptions = {},
): GuideApiRepository {
  const fetcher = options.fetcher ?? resolveDefaultFetch()
  const basePath = options.basePath ?? './api'

  return {
    async fetchSchedule(request) {
      const requestSet = createRequestSetFromScheduleRequest(request)
      const urls = buildGuideRequestUrls({ requestSet, basePath })
      const response = await fetchJson(fetcher, urls.schedule)
      const schedules = adaptSchedule(response?.body)

      if (request.mode === 'singleChannel' && response?.status === 404) {
        return {
          ok: false,
          error: 'guide-channel-not-found',
          message: GUIDE_FETCH_FAILURE_MESSAGE,
        }
      }

      if (schedules === null) {
        return {
          ok: false,
          error: 'guide-schedule-fetch-failed',
          message: GUIDE_FETCH_FAILURE_MESSAGE,
        }
      }

      return {
        ok: true,
        value: schedules,
      }
    },

    async fetchReserveIndex(request) {
      const requestSet = createRequestSetFromScheduleRequest(request)
      const urls = buildGuideRequestUrls({ requestSet, basePath })
      const response = await fetchJson(fetcher, urls.reserveIndex)
      const lists = adaptReserveLists(response?.body)

      if (lists === null) {
        return {
          ok: false,
          error: 'guide-reserve-index-fetch-failed',
          message: GUIDE_FETCH_FAILURE_MESSAGE,
        }
      }

      return {
        ok: true,
        value: transformReserveListsToIndex(lists),
      }
    },

    async triggerReserveUpdate() {
      const ok = await fetchAction(fetcher, `${basePath.replace(/\/$/, '')}/reserves/update`, {
        method: 'POST',
      })

      if (!ok) {
        return {
          ok: false,
          error: 'guide-reserve-update-failed',
          message: '予約情報の更新を開始できませんでした。',
        }
      }

      return {
        ok: true,
        value: {},
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
      const value = adaptAddReserveResponse(response?.body)

      if (value === null) {
        return {
          ok: false,
          error: 'guide-program-reserve-add-failed',
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
            error: 'guide-reserve-delete-failed',
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
            error: 'guide-reserve-unskip-failed',
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
            error: 'guide-reserve-unoverlap-failed',
            message: '重複解除失敗',
          }
    },
  }
}
