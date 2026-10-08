import type { FeatureResult, ServerApiFetch } from '@/app/serverApi'
import { STORAGES_FAILURE_MESSAGE, buildStoragesRequestUrl } from './storagesRequests'

export interface StorageUsageItem {
  name: string
  available: number
  used: number
  total: number
}

export interface StoragesResponse {
  items: StorageUsageItem[]
}

export interface StoragesApiRepository {
  fetchStorages(): Promise<FeatureResult<StoragesResponse, 'storages-fetch-failed'>>
}

export interface CreateFetchStoragesApiRepositoryOptions {
  fetcher?: ServerApiFetch
  basePath?: string
}

function resolveDefaultFetch(): ServerApiFetch {
  return globalThis.fetch.bind(globalThis)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isNonNegativeFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function adaptStorageUsageItem(value: unknown): StorageUsageItem | null {
  if (
    !isRecord(value) ||
    typeof value.name !== 'string' ||
    !isNonNegativeFiniteNumber(value.available) ||
    !isNonNegativeFiniteNumber(value.used) ||
    !isNonNegativeFiniteNumber(value.total)
  ) {
    return null
  }

  return {
    name: value.name,
    available: value.available,
    used: value.used,
    total: value.total,
  }
}

function adaptStoragesResponse(value: unknown): StoragesResponse | null {
  if (!isRecord(value) || !Array.isArray(value.items)) {
    return null
  }

  const items = value.items.map(adaptStorageUsageItem)

  if (items.some((item) => item === null)) {
    return null
  }

  return {
    items,
  } as StoragesResponse
}

export function createFetchStoragesApiRepository(
  options: CreateFetchStoragesApiRepositoryOptions = {},
): StoragesApiRepository {
  const fetcher = options.fetcher ?? resolveDefaultFetch()
  const basePath = options.basePath ?? './api'

  return {
    async fetchStorages() {
      try {
        const response = await fetcher(buildStoragesRequestUrl(basePath))
        const payload: unknown = await response.json()
        const storages = adaptStoragesResponse(payload)

        if (!response.ok || storages === null) {
          return {
            ok: false,
            error: 'storages-fetch-failed',
            message: STORAGES_FAILURE_MESSAGE,
          }
        }

        return {
          ok: true,
          value: storages,
        }
      } catch {
        return {
          ok: false,
          error: 'storages-fetch-failed',
          message: STORAGES_FAILURE_MESSAGE,
        }
      }
    },
  }
}
