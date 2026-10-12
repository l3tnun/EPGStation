import type { ServerApiFetch } from '@/app/serverApi'
import type { RecordedListRequest } from '../recordedRequests'
import type {
  RecordedDropLogFile,
  RecordedListItem,
  RecordedListResponse,
  RecordedSearchOptionItem,
  RecordedVideoFile,
} from './recordedApiTypes'

export function resolveDefaultFetch(): ServerApiFetch {
  return globalThis.fetch.bind(globalThis)
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function createEndpointUrl(basePath: string, request: RecordedListRequest): string {
  const endpoint = `${basePath.replace(/\/$/, '')}/recorded`
  const parameters = new URLSearchParams()

  Object.entries(request).forEach(([key, value]) => {
    if (key === 'page') {
      return
    }

    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      parameters.set(key, String(value))
    }
  })

  return `${endpoint}?${parameters.toString()}`
}

export function joinEndpoint(basePath: string, endpoint: string): string {
  return `${basePath.replace(/\/$/, '')}${endpoint}`
}

export function adaptChannelIndex(value: unknown, isHalfWidth: boolean): Map<number, string> {
  const channels = new Map<number, string>()

  if (!Array.isArray(value)) {
    return channels
  }

  value.forEach((channel) => {
    if (!isRecord(channel) || typeof channel.id !== 'number') {
      return
    }

    const name =
      isHalfWidth && typeof channel.halfWidthName === 'string'
        ? channel.halfWidthName
        : typeof channel.name === 'string'
          ? channel.name
          : typeof channel.halfWidthName === 'string'
            ? channel.halfWidthName
            : undefined

    if (name !== undefined) {
      channels.set(channel.id, name)
    }
  })

  return channels
}

export function adaptSearchOptionChannelIndex(
  value: unknown,
): Map<number, RecordedSearchOptionItem> {
  const channels = new Map<number, RecordedSearchOptionItem>()

  if (!Array.isArray(value)) {
    return channels
  }

  value.forEach((channel) => {
    if (!isRecord(channel) || typeof channel.id !== 'number') {
      return
    }

    const name =
      typeof channel.name === 'string'
        ? channel.name
        : typeof channel.halfWidthName === 'string'
          ? channel.halfWidthName
          : undefined

    if (name === undefined) {
      return
    }

    const item: RecordedSearchOptionItem = { id: channel.id, name }
    if (typeof channel.halfWidthName === 'string') {
      item.halfWidthName = channel.halfWidthName
    }
    channels.set(channel.id, item)
  })

  return channels
}

export function hydrateRecordedChannelName(
  item: RecordedListItem,
  channelIndex: ReadonlyMap<number, string>,
): RecordedListItem {
  if (item.channelName !== undefined || item.channelId === undefined) {
    return item
  }

  const channelName = channelIndex.get(item.channelId)

  return channelName === undefined ? item : { ...item, channelName }
}

export function hydrateRecordedResponseChannelNames(
  response: RecordedListResponse,
  channelIndex: ReadonlyMap<number, string>,
): RecordedListResponse {
  return {
    ...response,
    records: response.records.map((item) => hydrateRecordedChannelName(item, channelIndex)),
  }
}

function adaptVideoFile(value: unknown): RecordedVideoFile {
  if (!isRecord(value)) {
    return {}
  }

  const videoFile: RecordedVideoFile = {}

  if (typeof value.id === 'number') {
    videoFile.id = value.id
  }
  if (typeof value.name === 'string') {
    videoFile.name = value.name
  }
  if (typeof value.filename === 'string') {
    videoFile.filename = value.filename
  }
  if (typeof value.size === 'number') {
    videoFile.size = value.size
  }
  if (typeof value.type === 'string') {
    videoFile.type = value.type
  }
  if (typeof value.isOriginal === 'boolean') {
    videoFile.isOriginal = value.isOriginal
  }

  return videoFile
}

function adaptDropLogFile(value: unknown): RecordedDropLogFile | undefined {
  if (
    !isRecord(value) ||
    typeof value.dropCnt !== 'number' ||
    typeof value.errorCnt !== 'number' ||
    typeof value.scramblingCnt !== 'number'
  ) {
    return undefined
  }

  return {
    id: typeof value.id === 'number' ? value.id : undefined,
    dropCnt: value.dropCnt,
    errorCnt: value.errorCnt,
    scramblingCnt: value.scramblingCnt,
  }
}

export function adaptRecordedItem(value: unknown): RecordedListItem {
  if (!isRecord(value)) {
    return {}
  }

  const item: RecordedListItem = {}

  if (typeof value.id === 'number') {
    item.id = value.id
  }
  if (typeof value.name === 'string') {
    item.name = value.name
  }
  if (typeof value.channelId === 'number') {
    item.channelId = value.channelId
  }
  if (typeof value.channelName === 'string') {
    item.channelName = value.channelName
  }
  if (Array.isArray(value.genres)) {
    item.genres = value.genres.filter((genre): genre is string => typeof genre === 'string')
  } else if (typeof value.genre === 'string') {
    item.genres = [value.genre]
  }
  ;(['genre1', 'subGenre1', 'genre2', 'subGenre2', 'genre3', 'subGenre3'] as const).forEach(
    (key) => {
      if (typeof value[key] === 'number') {
        item[key] = value[key]
      }
    },
  )
  if (typeof value.startAt === 'number') {
    item.startAt = value.startAt
  }
  if (typeof value.endAt === 'number') {
    item.endAt = value.endAt
  }
  if (typeof value.description === 'string') {
    item.description = value.description
  }
  if (typeof value.extended === 'string') {
    item.extended = value.extended
  }
  if (typeof value.ruleId === 'number') {
    item.ruleId = value.ruleId
  }
  if (typeof value.isProtected === 'boolean') {
    item.isProtected = value.isProtected
  }
  if (typeof value.isRecording === 'boolean') {
    item.isRecording = value.isRecording
  }
  if (typeof value.isEncoding === 'boolean') {
    item.isEncoding = value.isEncoding
  }
  if (Array.isArray(value.thumbnails)) {
    item.thumbnails = value.thumbnails.filter((thumbnail): thumbnail is number => {
      return typeof thumbnail === 'number'
    })
  }
  const dropLogFile = adaptDropLogFile(value.dropLogFile)
  if (dropLogFile !== undefined) {
    item.dropLogFile = dropLogFile
  }
  if (Array.isArray(value.videoFiles)) {
    item.videoFiles = value.videoFiles.map(adaptVideoFile)
  }

  return item
}

export function adaptRecordedResponse(value: unknown): RecordedListResponse | null {
  if (!isRecord(value) || !Array.isArray(value.records) || typeof value.total !== 'number') {
    return null
  }

  return {
    records: value.records.map(adaptRecordedItem),
    total: value.total,
  }
}
