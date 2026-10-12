import { isBroadcastWave } from '@/app/navigation'
import type { ReserveListItem, ReservesListResponse } from './reservesApiTypes'

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function isSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value)
}

export function isNonNegativeSafeInteger(value: unknown): value is number {
  return isSafeInteger(value) && value >= 0
}

const MAX_VALID_DATE_TIMESTAMP = 8_640_000_000_000_000

export function isValidDateTimestamp(value: unknown): value is number {
  return isSafeInteger(value) && Math.abs(value) <= MAX_VALID_DATE_TIMESTAMP
}

function adaptOptionalSafeIntegerField<T extends string>(
  source: Record<string, unknown>,
  target: Partial<Record<T, number>>,
  key: T,
): void {
  if (isNonNegativeSafeInteger(source[key])) {
    target[key] = source[key]
  }
}

function adaptOptionalStringField<T extends string>(
  source: Record<string, unknown>,
  target: Partial<Record<T, string>>,
  sourceKey: string,
  targetKey: T,
): void {
  const value = source[sourceKey]
  if (typeof value === 'string') {
    target[targetKey] = value
  }
}

function createGenreLabel(genre: number, subGenre?: number): string {
  return subGenre === undefined ? `genre ${genre}` : `genre ${genre}/${subGenre}`
}

function createGenreLabels(item: ReserveListItem): string[] {
  const labels: string[] = []

  if (item.genre1 !== undefined) {
    labels.push(createGenreLabel(item.genre1, item.subGenre1))
  }
  if (item.genre2 !== undefined) {
    labels.push(createGenreLabel(item.genre2, item.subGenre2))
  }
  if (item.genre3 !== undefined) {
    labels.push(createGenreLabel(item.genre3, item.subGenre3))
  }

  return labels
}

export function adaptChannelIndex(value: unknown): Map<number, string> {
  const channels = new Map<number, string>()

  if (!Array.isArray(value)) {
    return channels
  }

  value.forEach((channel) => {
    if (!isRecord(channel) || !isNonNegativeSafeInteger(channel.id)) {
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

export function hydrateReserveChannelNames(
  response: ReservesListResponse,
  channelIndex: ReadonlyMap<number, string>,
): ReservesListResponse {
  return {
    ...response,
    reserves: response.reserves.map((item) =>
      item.channelName !== undefined || item.channelId === undefined
        ? item
        : channelIndex.has(item.channelId)
          ? {
              ...item,
              channelName: channelIndex.get(item.channelId),
            }
          : item,
    ),
  }
}

export function adaptReserveItem(value: unknown): ReserveListItem | null {
  if (!isRecord(value)) {
    return null
  }

  const rawId = isSafeInteger(value.id)
    ? value.id
    : isSafeInteger(value.reserveId)
      ? value.reserveId
      : null

  if (rawId === null) {
    return null
  }

  const item: ReserveListItem = {
    id: rawId,
  }
  if (isNonNegativeSafeInteger(value.programId)) {
    item.programId = value.programId
  }
  if (typeof value.name === 'string') {
    item.name = value.name
  }
  if (isNonNegativeSafeInteger(value.channelId)) {
    item.channelId = value.channelId
  }
  if (typeof value.channelName === 'string') {
    item.channelName = value.channelName
  }
  if (isBroadcastWave(value.channelType)) {
    item.channelType = value.channelType
  }
  if (isValidDateTimestamp(value.startAt)) {
    item.startAt = value.startAt
  }
  if (isValidDateTimestamp(value.endAt)) {
    item.endAt = value.endAt
  }
  if (item.startAt !== undefined && item.endAt !== undefined && item.endAt < item.startAt) {
    delete item.endAt
  }
  if (typeof value.description === 'string') {
    item.description = value.description
  }
  if (typeof value.extended === 'string') {
    item.extended = value.extended
  }
  if (isNonNegativeSafeInteger(value.ruleId)) {
    item.ruleId = value.ruleId
  }
  adaptOptionalSafeIntegerField(value, item, 'genre1')
  adaptOptionalSafeIntegerField(value, item, 'subGenre1')
  adaptOptionalSafeIntegerField(value, item, 'genre2')
  adaptOptionalSafeIntegerField(value, item, 'subGenre2')
  adaptOptionalSafeIntegerField(value, item, 'genre3')
  adaptOptionalSafeIntegerField(value, item, 'subGenre3')
  if (typeof value.isConflict === 'boolean') {
    item.isConflict = value.isConflict
  }
  if (typeof value.isSkip === 'boolean') {
    item.isSkip = value.isSkip
  }
  if (typeof value.isOverlap === 'boolean') {
    item.isOverlap = value.isOverlap
  }
  if (typeof value.isTimeSpecified === 'boolean') {
    item.isTimeSpecified = value.isTimeSpecified
  }
  if (typeof value.allowEndLack === 'boolean') {
    item.allowEndLack = value.allowEndLack
  }
  adaptOptionalStringField(value, item, 'parentDirectoryName', 'parentDirectoryName')
  adaptOptionalStringField(value, item, 'directory', 'directory')
  adaptOptionalStringField(value, item, 'recordedFormat', 'recordedFormat')
  adaptOptionalStringField(value, item, 'encodeMode1', 'encodeMode1')
  adaptOptionalStringField(value, item, 'encodeParentDirectoryName1', 'encodeParentDirectoryName1')
  adaptOptionalStringField(value, item, 'encodeDirectory1', 'encodeDirectory1')
  adaptOptionalStringField(value, item, 'encodeMode2', 'encodeMode2')
  adaptOptionalStringField(value, item, 'encodeParentDirectoryName2', 'encodeParentDirectoryName2')
  adaptOptionalStringField(value, item, 'encodeDirectory2', 'encodeDirectory2')
  adaptOptionalStringField(value, item, 'encodeMode3', 'encodeMode3')
  adaptOptionalStringField(value, item, 'encodeParentDirectoryName3', 'encodeParentDirectoryName3')
  adaptOptionalStringField(value, item, 'encodeDirectory3', 'encodeDirectory3')
  if (typeof value.isDeleteOriginalAfterEncode === 'boolean') {
    item.isDeleteOriginalAfterEncode = value.isDeleteOriginalAfterEncode
  }
  if (Array.isArray(value.genres)) {
    item.genres = value.genres.filter((genre): genre is string => typeof genre === 'string')
  }
  if (item.genres === undefined || item.genres.length === 0) {
    const genreLabels = createGenreLabels(item)
    if (genreLabels.length > 0) {
      item.genres = genreLabels
    }
  }

  return item
}
