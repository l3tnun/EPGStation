import type { GuideReserveItem, GuideReserveLists } from '@/features/guide/guideRequests'
import { isNonNegativeSafeInteger, isRecord, isSafeInteger } from './guards'
import type { SearchProgram } from './types'

function adaptProgram(value: unknown): SearchProgram | null {
  if (!isRecord(value) || !isNonNegativeSafeInteger(value.id)) {
    return null
  }

  const program: SearchProgram = {
    id: value.id,
  }

  if (typeof value.name === 'string') program.name = value.name
  if (isNonNegativeSafeInteger(value.channelId)) program.channelId = value.channelId
  if (typeof value.channelName === 'string') program.channelName = value.channelName
  if (isSafeInteger(value.startAt)) program.startAt = value.startAt
  if (isSafeInteger(value.endAt)) program.endAt = value.endAt
  if (typeof value.description === 'string') program.description = value.description
  if (typeof value.extended === 'string') program.extended = value.extended
  if (isNonNegativeSafeInteger(value.genre1)) program.genre1 = value.genre1
  if (isNonNegativeSafeInteger(value.subGenre1)) program.subGenre1 = value.subGenre1
  if (isNonNegativeSafeInteger(value.genre2)) program.genre2 = value.genre2
  if (isNonNegativeSafeInteger(value.subGenre2)) program.subGenre2 = value.subGenre2
  if (isNonNegativeSafeInteger(value.genre3)) program.genre3 = value.genre3
  if (isNonNegativeSafeInteger(value.subGenre3)) program.subGenre3 = value.subGenre3
  if (typeof value.isFree === 'boolean') program.isFree = value.isFree

  return program
}

export function adaptPrograms(value: unknown): SearchProgram[] | null {
  if (!Array.isArray(value)) {
    return null
  }

  const programs = value.map(adaptProgram)

  return programs.every((program): program is SearchProgram => program !== null) ? programs : null
}

function adaptReserveItem(value: unknown): GuideReserveItem | null {
  if (!isRecord(value)) {
    return null
  }

  // `GET /api/reserves/lists` returns `ReserveListItem` (api.yml), whose reserve id field is
  // `reserveId` - it never has an `id` field (confirmed against api.yml's `ReserveListItem`
  // schema, `ReserveApiModel.toReserveListItem` (src/model/api/reserve/ReserveApiModel.ts), and
  // a live capture from this endpoint). Falling back to `value.id` only matches the sibling
  // Guide feature's adapter (`adaptReserveItem` in
  // client/src/features/guide/lib/guideApiAdapters.ts), which is the reference implementation
  // for this same response shape.
  const id = isNonNegativeSafeInteger(value.reserveId) ? value.reserveId : value.id

  if (!isNonNegativeSafeInteger(id)) {
    return null
  }

  const item: GuideReserveItem = {
    id,
  }

  if (isNonNegativeSafeInteger(value.programId)) {
    item.programId = value.programId
  }
  if (isNonNegativeSafeInteger(value.ruleId)) {
    item.ruleId = value.ruleId
  }

  return item
}

function adaptReserveList(value: unknown): GuideReserveItem[] | null {
  if (!Array.isArray(value)) {
    return null
  }

  const items = value.map(adaptReserveItem)

  return items.every((item): item is GuideReserveItem => item !== null) ? items : null
}

export function adaptReserveLists(value: unknown): GuideReserveLists | null {
  if (!isRecord(value)) {
    return null
  }

  const normal = adaptReserveList(value.normal)
  const conflicts = adaptReserveList(value.conflicts)
  const skips = adaptReserveList(value.skips)
  const overlaps = adaptReserveList(value.overlaps)

  if (normal === null || conflicts === null || skips === null || overlaps === null) {
    return null
  }

  return { normal, conflicts, skips, overlaps }
}

export function adaptAddReserveResponse(value: unknown): { reserveId: number } | null {
  if (!isRecord(value) || !isNonNegativeSafeInteger(value.reserveId)) {
    return null
  }

  return { reserveId: value.reserveId }
}
