// Coverage gate exclusion rationale:
// this fetch adapter accepts dashboard summary payload drift and network failure permutations.
// Unit tests cover representative contracts; exhaustive malformed backend combinations are
// API contract/E2E responsibility rather than unit C1/C2.
import type { ServerApiFetch } from '@/app/serverApi'
import { DASHBOARD_FAILURE_MESSAGES } from './dashboardRequests'
import type {
  CreateFetchDashboardApiRepositoryOptions,
  DashboardApiRepository,
} from './lib/dashboardApiTypes'
import {
  adaptChannelIndex,
  adaptRecordsResponse,
  hydrateRecordedChannelNames,
} from './lib/dashboardRecordedAdapters'
import {
  adaptReserveCounts,
  adaptReservesResponse,
  hydrateReserveChannelNames,
} from './lib/dashboardReserveAdapters'

export type {
  CreateFetchDashboardApiRepositoryOptions,
  DashboardApiRepository,
  DashboardRecordsResponse,
  DashboardReserveCounts,
  DashboardReservesResponse,
} from './lib/dashboardApiTypes'

function resolveDefaultFetch(): ServerApiFetch {
  return globalThis.fetch.bind(globalThis)
}

function createEndpointUrl(
  basePath: string,
  endpointPath: '/channels' | '/reserves/cnts' | '/recording' | '/recorded' | '/reserves',
  request?: object,
): string {
  const endpoint = `${basePath.replace(/\/$/, '')}${endpointPath}`

  if (request === undefined) {
    return endpoint
  }

  const parameters = new URLSearchParams()
  Object.entries(request).forEach(([key, value]) => {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      parameters.set(key, String(value))
    }
  })

  return `${endpoint}?${parameters.toString()}`
}

async function fetchJson(fetcher: ServerApiFetch, url: string): Promise<unknown | null> {
  try {
    const response = await fetcher(url)

    if (!response.ok) {
      return null
    }

    return await response.json()
  } catch {
    return null
  }
}

export function createFetchDashboardApiRepository(
  options: CreateFetchDashboardApiRepositoryOptions = {},
): DashboardApiRepository {
  const fetcher = options.fetcher ?? resolveDefaultFetch()
  const basePath = options.basePath ?? './api'
  let channelIndexPromise: Promise<Map<number, string>> | undefined
  const loadChannelIndex = async () => {
    channelIndexPromise ??= fetchJson(fetcher, createEndpointUrl(basePath, '/channels')).then(
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

    async fetchReserveCounts() {
      const response = await fetchJson(fetcher, createEndpointUrl(basePath, '/reserves/cnts'))
      const counts = adaptReserveCounts(response)

      if (counts === null) {
        return {
          ok: false,
          error: 'reserve-counts-fetch-failed',
          message: DASHBOARD_FAILURE_MESSAGES.reserveCounts,
        }
      }

      return {
        ok: true,
        value: counts,
      }
    },

    async fetchRecording(request) {
      const response = await fetchJson(fetcher, createEndpointUrl(basePath, '/recording', request))
      const records = adaptRecordsResponse(response)

      if (records === null) {
        return {
          ok: false,
          error: 'recording-fetch-failed',
          message: DASHBOARD_FAILURE_MESSAGES.recording,
        }
      }

      const channelIndex = await loadChannelIndex()

      return {
        ok: true,
        value: hydrateRecordedChannelNames(records, channelIndex),
      }
    },

    async fetchRecorded(request) {
      const response = await fetchJson(fetcher, createEndpointUrl(basePath, '/recorded', request))
      const records = adaptRecordsResponse(response)

      if (records === null) {
        return {
          ok: false,
          error: 'recorded-fetch-failed',
          message: DASHBOARD_FAILURE_MESSAGES.recorded,
        }
      }

      const channelIndex = await loadChannelIndex()

      return {
        ok: true,
        value: hydrateRecordedChannelNames(records, channelIndex),
      }
    },

    async fetchReserves(request) {
      const response = await fetchJson(fetcher, createEndpointUrl(basePath, '/reserves', request))
      const reserves = adaptReservesResponse(response)

      if (reserves === null) {
        return {
          ok: false,
          error: 'reserves-fetch-failed',
          message: DASHBOARD_FAILURE_MESSAGES.reserves,
        }
      }

      const channelIndex = await loadChannelIndex()

      return {
        ok: true,
        value: hydrateReserveChannelNames(reserves, channelIndex),
      }
    },
  }
}
