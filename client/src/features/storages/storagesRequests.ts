import type { StorageUsageItem } from './storagesApi'

export const STORAGES_QUERY_KEY = ['storages'] as const
export const STORAGES_FAILURE_MESSAGE = 'ストレージ情報取得に失敗'

const STORAGE_SIZE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'] as const

export interface StorageUsageView {
  name: string
  available: string
  used: string
  total: string
  useRate: number
}

export function createStoragesQueryKey(): readonly ['storages'] {
  return STORAGES_QUERY_KEY
}

export function buildStoragesRequestUrl(basePath = './api'): string {
  return `${basePath.replace(/\/$/, '')}/storages`
}

export function formatStorageSize(value: number): string {
  let size = Number.isFinite(value) && value >= 0 ? value : 0
  let unitIndex = 0

  while (size >= 1000 && unitIndex < STORAGE_SIZE_UNITS.length - 1) {
    size /= 1024
    unitIndex += 1
  }

  return `${size.toFixed(1)}${STORAGE_SIZE_UNITS[unitIndex]}`
}

export function toStorageUsageView(item: StorageUsageItem): StorageUsageView {
  return {
    name: item.name,
    available: formatStorageSize(item.available),
    used: formatStorageSize(item.used),
    total: formatStorageSize(item.total),
    useRate: item.total > 0 ? Math.floor((item.used / item.total) * 100) : 0,
  }
}
