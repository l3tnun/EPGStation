import type { ManualProgramDetail, ReserveListItem, ReservesListResponse } from './reservesApiTypes'
import {
  adaptReserveItem,
  isNonNegativeSafeInteger,
  isRecord,
  isSafeInteger,
  isValidDateTimestamp,
} from './reserveAdapters'

export function adaptManualProgramDetail(value: unknown): ManualProgramDetail | null {
  if (!isRecord(value)) {
    return null
  }

  if (
    !isNonNegativeSafeInteger(value.id) ||
    typeof value.name !== 'string' ||
    !isNonNegativeSafeInteger(value.channelId) ||
    !isValidDateTimestamp(value.startAt) ||
    !isValidDateTimestamp(value.endAt) ||
    value.endAt < value.startAt
  ) {
    return null
  }

  const item: ManualProgramDetail = {
    id: value.id,
    name: value.name,
    channelId: value.channelId,
    startAt: value.startAt,
    endAt: value.endAt,
  }
  if (typeof value.channelName === 'string') {
    item.channelName = value.channelName
  }
  if (typeof value.description === 'string') {
    item.description = value.description
  }
  if (typeof value.extended === 'string') {
    item.extended = value.extended
  }
  if (Array.isArray(value.genres)) {
    item.genres = value.genres.filter((genre): genre is string => typeof genre === 'string')
  }
  if (isSafeInteger(value.genre1)) {
    item.genre1 = value.genre1
  }
  if (isSafeInteger(value.subGenre1)) {
    item.subGenre1 = value.subGenre1
  }
  if (isSafeInteger(value.genre2)) {
    item.genre2 = value.genre2
  }
  if (isSafeInteger(value.subGenre2)) {
    item.subGenre2 = value.subGenre2
  }
  if (isSafeInteger(value.genre3)) {
    item.genre3 = value.genre3
  }
  if (isSafeInteger(value.subGenre3)) {
    item.subGenre3 = value.subGenre3
  }
  if (typeof value.isFree === 'boolean') {
    item.isFree = value.isFree
  }
  if (isSafeInteger(value.videoComponentType)) {
    item.videoComponentType = value.videoComponentType
  }
  if (isSafeInteger(value.audioComponentType)) {
    item.audioComponentType = value.audioComponentType
  }
  if (isSafeInteger(value.audioSamplingRate)) {
    item.audioSamplingRate = value.audioSamplingRate
  }

  return item
}

export function adaptReservesResponse(value: unknown): ReservesListResponse | null {
  if (
    !isRecord(value) ||
    !Array.isArray(value.reserves) ||
    !isSafeInteger(value.total) ||
    value.total < 0
  ) {
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

export function adaptManualAddResponse(value: unknown): { reserveId: number } | null {
  if (!isRecord(value) || !isNonNegativeSafeInteger(value.reserveId)) {
    return null
  }

  return {
    reserveId: value.reserveId,
  }
}

export function isManualUpdateResponse(value: unknown): boolean {
  return isRecord(value) && value.code === 201 && value.message === 'ok'
}
