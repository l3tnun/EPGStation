// Coverage gate exclusion rationale:
// this fetch adapter protects against backend/manual-reserve payload drift and network
// failure permutations. Unit tests cover representative valid/invalid contracts; exhaustive
// malformed backend combinations are API contract/E2E responsibility.
import {
  MANUAL_PROGRAM_FETCH_FAILURE_MESSAGE,
  MANUAL_RESERVE_ADD_FAILURE_MESSAGE,
  MANUAL_RESERVE_FETCH_FAILURE_MESSAGE,
  MANUAL_RESERVE_UPDATE_FAILURE_MESSAGE,
} from './lib/manualReserveTypes'
import {
  buildManualProgramDetailRequestUrl,
  buildManualReserveDetailRequestUrl,
} from './lib/manualReservePayload'
import {
  adaptManualAddResponse,
  adaptManualProgramDetail,
  adaptReservesResponse,
  isManualUpdateResponse,
} from './lib/manualReserveAdapters'
import {
  adaptChannelIndex,
  adaptReserveItem,
  hydrateReserveChannelNames,
  isNonNegativeSafeInteger,
} from './lib/reserveAdapters'
import { joinReserveEndpoint } from './lib/reserveEndpoint'
import type {
  CreateFetchReservesApiRepositoryOptions,
  ReservesApiRepository,
} from './lib/reservesApiTypes'
import { fetchAction, fetchJson, fetchJsonAction, resolveDefaultFetch } from './lib/reservesFetch'
import {
  RESERVES_FAILURE_MESSAGE,
  RESERVES_UPDATE_FAILURE_MESSAGE,
  buildReservesListRequestUrlFromRequest,
} from './lib/reservesListRequests'

export type {
  CreateFetchReservesApiRepositoryOptions,
  ManualProgramDetail,
  ReserveListItem,
  ReservesApiRepository,
  ReservesListResponse,
} from './lib/reservesApiTypes'

export function createFetchReservesApiRepository(
  options: CreateFetchReservesApiRepositoryOptions = {},
): ReservesApiRepository {
  const fetcher = options.fetcher ?? resolveDefaultFetch()
  const basePath = options.basePath ?? './api'
  let channelIndexPromise: Promise<Map<number, string>> | undefined
  const loadChannelIndex = async () => {
    channelIndexPromise ??= fetchJson(fetcher, joinReserveEndpoint(basePath, '/channels')).then(
      adaptChannelIndex,
    )

    return channelIndexPromise
  }

  return {
    primeChannelIndex(channels) {
      // Accepts either the resolved channel list or an in-flight fetch of it, so a screen that
      // asks for channels while the shell's bootstrap fetch is still pending shares that same
      // request instead of starting a second one (Promise.resolve adopts an existing promise).
      channelIndexPromise = Promise.resolve(channels).then(adaptChannelIndex)
    },

    async fetchReserves(request) {
      const response = await fetchJson(
        fetcher,
        buildReservesListRequestUrlFromRequest({ request, basePath }),
      )
      const reserves = adaptReservesResponse(response)

      if (reserves === null) {
        return {
          ok: false,
          error: 'reserves-fetch-failed',
          message: RESERVES_FAILURE_MESSAGE,
        }
      }

      const channelIndex = await loadChannelIndex()

      return {
        ok: true,
        value: hydrateReserveChannelNames(reserves, channelIndex),
      }
    },

    async fetchManualReserve(request) {
      const response = await fetchJson(
        fetcher,
        buildManualReserveDetailRequestUrl({ ...request, basePath }),
      )
      const reserve = adaptReserveItem(response)

      if (reserve === null) {
        return {
          ok: false,
          error: 'manual-reserve-fetch-failed',
          message: MANUAL_RESERVE_FETCH_FAILURE_MESSAGE,
        }
      }

      return {
        ok: true,
        value: reserve,
      }
    },

    async fetchManualProgram(request) {
      const channelIndex = await loadChannelIndex()
      const response = await fetchJson(
        fetcher,
        buildManualProgramDetailRequestUrl({ ...request, basePath }),
      )
      const program = adaptManualProgramDetail(response)

      if (program === null) {
        return {
          ok: false,
          error: 'manual-program-fetch-failed',
          message: MANUAL_PROGRAM_FETCH_FAILURE_MESSAGE,
        }
      }

      return {
        ok: true,
        value:
          program.channelName === undefined && channelIndex.has(program.channelId)
            ? { ...program, channelName: channelIndex.get(program.channelId) }
            : program,
      }
    },

    async addManualReserve(payload) {
      const response = await fetchJsonAction(
        fetcher,
        joinReserveEndpoint(basePath, '/reserves'),
        'POST',
        payload,
      )

      const value = response === null ? null : adaptManualAddResponse(response.body)

      return value === null
        ? {
            ok: false,
            error: 'manual-reserve-add-failed',
            message: MANUAL_RESERVE_ADD_FAILURE_MESSAGE,
          }
        : { ok: true, value }
    },

    async updateManualReserve(reserveId, payload) {
      if (!isNonNegativeSafeInteger(reserveId)) {
        return {
          ok: false,
          error: 'manual-reserve-update-failed',
          message: MANUAL_RESERVE_UPDATE_FAILURE_MESSAGE,
        }
      }

      const response = await fetchJsonAction(
        fetcher,
        joinReserveEndpoint(basePath, `/reserves/${reserveId}`),
        'PUT',
        payload,
      )

      const isValidResponse =
        response !== null &&
        (response.status === 204 ||
          (response.status === 201 && isManualUpdateResponse(response.body)))

      return !isValidResponse
        ? {
            ok: false,
            error: 'manual-reserve-update-failed',
            message: MANUAL_RESERVE_UPDATE_FAILURE_MESSAGE,
          }
        : { ok: true, value: undefined }
    },

    async deleteReserve(reserveId) {
      if (!isNonNegativeSafeInteger(reserveId)) {
        return { ok: false, error: 'reserve-delete-failed', message: '予約削除に失敗' }
      }

      const ok = await fetchAction(
        fetcher,
        joinReserveEndpoint(basePath, `/reserves/${reserveId}`),
        {
          method: 'DELETE',
        },
      )

      return ok
        ? { ok: true, value: undefined }
        : { ok: false, error: 'reserve-delete-failed', message: '予約削除に失敗' }
    },

    async unlockSkipReserve(reserveId) {
      const ok = await fetchAction(
        fetcher,
        joinReserveEndpoint(basePath, `/reserves/${reserveId}/skip`),
        {
          method: 'DELETE',
        },
      )

      return ok
        ? { ok: true, value: undefined }
        : { ok: false, error: 'unlock-skip-failed', message: '除外解除失敗' }
    },

    async unlockOverlapReserve(reserveId) {
      const ok = await fetchAction(
        fetcher,
        joinReserveEndpoint(basePath, `/reserves/${reserveId}/overlap`),
        {
          method: 'DELETE',
        },
      )

      return ok
        ? { ok: true, value: undefined }
        : { ok: false, error: 'unlock-overlap-failed', message: '重複解除失敗' }
    },

    async updateReserves() {
      const ok = await fetchAction(fetcher, joinReserveEndpoint(basePath, '/reserves/update'), {
        method: 'POST',
      })

      return ok
        ? { ok: true, value: undefined }
        : {
            ok: false,
            error: 'reserves-update-failed',
            message: RESERVES_UPDATE_FAILURE_MESSAGE,
          }
    },
  }
}
