import { isBroadcastWave } from '@/app/navigation'
import type { ReserveListItem } from '@/features/reserves/reservesApi'
import type { DashboardReserveCounts, DashboardReservesResponse } from './dashboardApiTypes'
import { isRecord } from './dashboardRecordedAdapters'

export function hydrateReserveChannelNames(
  response: DashboardReservesResponse,
  channelIndex: ReadonlyMap<number, string>,
): DashboardReservesResponse {
  return {
    ...response,
    reserves: response.reserves.map((item) =>
      item.channelName !== undefined || item.channelId === undefined
        ? item
        : {
            ...item,
            channelName: channelIndex.get(item.channelId),
          },
    ),
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

function adaptReserveItem(value: unknown): ReserveListItem | null {
  if (!isRecord(value) || typeof value.id !== 'number') {
    return null
  }

  const item: ReserveListItem = {
    id: value.id,
  }
  if (typeof value.programId === 'number') item.programId = value.programId
  if (typeof value.name === 'string') item.name = value.name
  if (typeof value.channelId === 'number') item.channelId = value.channelId
  if (typeof value.channelName === 'string') item.channelName = value.channelName
  if (isBroadcastWave(value.channelType)) item.channelType = value.channelType
  if (typeof value.startAt === 'number') item.startAt = value.startAt
  if (typeof value.endAt === 'number') item.endAt = value.endAt
  if (typeof value.description === 'string') item.description = value.description
  if (typeof value.extended === 'string') item.extended = value.extended
  if (typeof value.ruleId === 'number') item.ruleId = value.ruleId
  if (typeof value.genre1 === 'number') item.genre1 = value.genre1
  if (typeof value.subGenre1 === 'number') item.subGenre1 = value.subGenre1
  if (typeof value.genre2 === 'number') item.genre2 = value.genre2
  if (typeof value.subGenre2 === 'number') item.subGenre2 = value.subGenre2
  if (typeof value.genre3 === 'number') item.genre3 = value.genre3
  if (typeof value.subGenre3 === 'number') item.subGenre3 = value.subGenre3
  if (typeof value.isConflict === 'boolean') item.isConflict = value.isConflict
  if (typeof value.isSkip === 'boolean') item.isSkip = value.isSkip
  if (typeof value.isOverlap === 'boolean') item.isOverlap = value.isOverlap
  if (typeof value.isTimeSpecified === 'boolean') item.isTimeSpecified = value.isTimeSpecified
  if (typeof value.allowEndLack === 'boolean') item.allowEndLack = value.allowEndLack
  if (typeof value.parentDirectoryName === 'string')
    item.parentDirectoryName = value.parentDirectoryName
  if (typeof value.directory === 'string') item.directory = value.directory
  if (typeof value.recordedFormat === 'string') item.recordedFormat = value.recordedFormat
  if (typeof value.encodeMode1 === 'string') item.encodeMode1 = value.encodeMode1
  if (typeof value.encodeParentDirectoryName1 === 'string') {
    item.encodeParentDirectoryName1 = value.encodeParentDirectoryName1
  }
  if (typeof value.encodeDirectory1 === 'string') item.encodeDirectory1 = value.encodeDirectory1
  if (typeof value.encodeMode2 === 'string') item.encodeMode2 = value.encodeMode2
  if (typeof value.encodeParentDirectoryName2 === 'string') {
    item.encodeParentDirectoryName2 = value.encodeParentDirectoryName2
  }
  if (typeof value.encodeDirectory2 === 'string') item.encodeDirectory2 = value.encodeDirectory2
  if (typeof value.encodeMode3 === 'string') item.encodeMode3 = value.encodeMode3
  if (typeof value.encodeParentDirectoryName3 === 'string') {
    item.encodeParentDirectoryName3 = value.encodeParentDirectoryName3
  }
  if (typeof value.encodeDirectory3 === 'string') item.encodeDirectory3 = value.encodeDirectory3
  if (typeof value.isDeleteOriginalAfterEncode === 'boolean') {
    item.isDeleteOriginalAfterEncode = value.isDeleteOriginalAfterEncode
  }
  const genreLabels = Array.isArray(value.genres)
    ? value.genres.filter((genre): genre is string => typeof genre === 'string')
    : createGenreLabels(item)
  if (genreLabels.length > 0) {
    item.genres = genreLabels
  }

  return item
}

export function adaptReservesResponse(value: unknown): DashboardReservesResponse | null {
  if (!isRecord(value) || !Array.isArray(value.reserves) || typeof value.total !== 'number') {
    return null
  }

  const reserves = value.reserves.map(adaptReserveItem)

  if (!reserves.every((item): item is ReserveListItem => item !== null)) {
    return null
  }

  return {
    reserves,
    total: value.total,
  }
}

export function adaptReserveCounts(value: unknown): DashboardReserveCounts | null {
  if (!isRecord(value)) {
    return null
  }

  const counts = {
    normal: value.normal,
    conflicts: value.conflicts,
    skips: value.skips,
    overlaps: value.overlaps,
  }

  if (
    typeof counts.normal !== 'number' ||
    typeof counts.conflicts !== 'number' ||
    typeof counts.skips !== 'number' ||
    typeof counts.overlaps !== 'number'
  ) {
    return null
  }

  return counts as DashboardReserveCounts
}
