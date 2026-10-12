import type { RecordedListItem, RecordedVideoFile } from '@/features/recorded/recordedApi'
import type { DashboardRecordsResponse } from './dashboardApiTypes'

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function adaptChannelIndex(value: unknown): Map<number, string> {
  const channels = new Map<number, string>()

  if (!Array.isArray(value)) {
    return channels
  }

  value.forEach((channel) => {
    if (!isRecord(channel) || typeof channel.id !== 'number') {
      return
    }

    const name =
      typeof channel.halfWidthName === 'string'
        ? channel.halfWidthName
        : typeof channel.name === 'string'
          ? channel.name
          : undefined

    if (name !== undefined) {
      channels.set(channel.id, name)
    }
  })

  return channels
}

export function hydrateRecordedChannelNames(
  response: DashboardRecordsResponse,
  channelIndex: ReadonlyMap<number, string>,
): DashboardRecordsResponse {
  return {
    ...response,
    records: response.records.map((item) =>
      item.channelName !== undefined || item.channelId === undefined
        ? item
        : {
            ...item,
            channelName: channelIndex.get(item.channelId),
          },
    ),
  }
}

function adaptVideoFile(value: unknown): RecordedVideoFile {
  if (!isRecord(value)) {
    return {}
  }

  const file: RecordedVideoFile = {}
  if (typeof value.id === 'number') file.id = value.id
  if (typeof value.name === 'string') file.name = value.name
  if (typeof value.filename === 'string') file.filename = value.filename
  if (typeof value.size === 'number') file.size = value.size
  if (typeof value.type === 'string') file.type = value.type
  if (typeof value.isOriginal === 'boolean') file.isOriginal = value.isOriginal

  return file
}

function adaptDropLogFile(value: unknown): RecordedListItem['dropLogFile'] {
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

function adaptRecordedItem(value: unknown): RecordedListItem {
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
    item.thumbnails = value.thumbnails.filter(
      (thumbnail): thumbnail is number => typeof thumbnail === 'number',
    )
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

export function adaptRecordsResponse(value: unknown): DashboardRecordsResponse | null {
  if (!isRecord(value) || !Array.isArray(value.records) || typeof value.total !== 'number') {
    return null
  }

  return {
    records: value.records.map(adaptRecordedItem),
    total: value.total,
  }
}
