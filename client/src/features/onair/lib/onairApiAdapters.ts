import { isBroadcastWave } from '@/app/navigation'
import type { ServerApiFetch } from '@/app/serverApi'
import { type OnAirChannel, type OnAirProgram, type OnAirSchedule } from '../onairApi'
import { type OnAirReserveItem, type OnAirReserveLists } from '../onairRequests'

export function resolveDefaultFetch(): ServerApiFetch {
  return globalThis.fetch.bind(globalThis)
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export async function fetchJson(
  fetcher: ServerApiFetch,
  url: string,
  init?: RequestInit,
): Promise<unknown | null> {
  try {
    const response = init === undefined ? await fetcher(url) : await fetcher(url, init)

    if (!response.ok) {
      return null
    }

    return await response.json()
  } catch {
    return null
  }
}

export async function fetchAction(
  fetcher: ServerApiFetch,
  url: string,
  init?: RequestInit,
): Promise<boolean> {
  try {
    const response = await fetcher(url, init)

    return response.ok
  } catch {
    return false
  }
}

export function adaptReserveItem(value: unknown): OnAirReserveItem | null {
  if (!isRecord(value) || typeof value.reserveId !== 'number') {
    return null
  }

  const item: OnAirReserveItem = {
    reserveId: value.reserveId,
  }

  if (typeof value.programId === 'number') {
    item.programId = value.programId
  }
  if (typeof value.ruleId === 'number') {
    item.ruleId = value.ruleId
  }

  return item
}

export function adaptReserveList(value: unknown): OnAirReserveItem[] | null {
  if (!Array.isArray(value)) {
    return null
  }

  const items = value.map(adaptReserveItem)

  return items.every((item): item is OnAirReserveItem => item !== null) ? items : null
}

export function adaptReserveLists(value: unknown): OnAirReserveLists | null {
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

  return {
    normal,
    conflicts,
    skips,
    overlaps,
  }
}

export function adaptChannel(value: unknown): OnAirChannel | undefined {
  if (!isRecord(value)) {
    return undefined
  }

  const channel: OnAirChannel = {}

  if (typeof value.id === 'number') {
    channel.id = value.id
  }
  if (typeof value.name === 'string') {
    channel.name = value.name
  }
  if (isBroadcastWave(value.channelType)) {
    channel.channelType = value.channelType
  }
  if (typeof value.hasLogoData === 'boolean') {
    channel.hasLogoData = value.hasLogoData
  }

  return channel
}

export function adaptProgram(value: unknown): OnAirProgram | null {
  if (!isRecord(value)) {
    return null
  }

  const program: OnAirProgram = {}

  if (typeof value.id === 'number') {
    program.id = value.id
  }
  if (typeof value.name === 'string') {
    program.name = value.name
  }
  if (typeof value.description === 'string') {
    program.description = value.description
  }
  if (typeof value.extended === 'string') {
    program.extended = value.extended
  }
  if (typeof value.startAt === 'number') {
    program.startAt = value.startAt
  }
  if (typeof value.endAt === 'number') {
    program.endAt = value.endAt
  }
  if (typeof value.channelId === 'number') {
    program.channelId = value.channelId
  }
  if (typeof value.genre1 === 'number') {
    program.genre1 = value.genre1
  }
  if (typeof value.subGenre1 === 'number') {
    program.subGenre1 = value.subGenre1
  }
  if (typeof value.genre2 === 'number') {
    program.genre2 = value.genre2
  }
  if (typeof value.subGenre2 === 'number') {
    program.subGenre2 = value.subGenre2
  }
  if (typeof value.genre3 === 'number') {
    program.genre3 = value.genre3
  }
  if (typeof value.subGenre3 === 'number') {
    program.subGenre3 = value.subGenre3
  }
  if (typeof value.videoComponentType === 'number') {
    program.videoComponentType = value.videoComponentType
  }
  if (typeof value.audioComponentType === 'number') {
    program.audioComponentType = value.audioComponentType
  }
  if (typeof value.audioSamplingRate === 'number') {
    program.audioSamplingRate = value.audioSamplingRate
  }
  if (typeof value.isFree === 'boolean') {
    program.isFree = value.isFree
  }

  return program
}

export function adaptAddReserveResponse(value: unknown): { reserveId: number } | null {
  if (!isRecord(value) || typeof value.reserveId !== 'number') {
    return null
  }

  return {
    reserveId: value.reserveId,
  }
}

export function adaptSchedules(value: unknown): OnAirSchedule[] | null {
  if (!Array.isArray(value)) {
    return null
  }

  return value.map((entry) => {
    if (!isRecord(entry)) {
      return {}
    }

    const schedule: OnAirSchedule = {}
    const channel = adaptChannel(entry.channel)
    if (channel !== undefined) {
      schedule.channel = channel
    }
    if (Array.isArray(entry.programs)) {
      schedule.programs = entry.programs
        .map(adaptProgram)
        .filter((program): program is OnAirProgram => program !== null)
    }

    return schedule
  })
}
