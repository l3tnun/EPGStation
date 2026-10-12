import type { ServerApiFetch } from '@/app/serverApi'
import type { GuideProgram, GuideSchedule } from '../guideApi'
import type { GuideReserveItem, GuideReserveLists } from '../guideRequests'

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
): Promise<{ status: number; body: unknown } | null> {
  try {
    const response = await fetcher(url, init)

    if (!response.ok) {
      return {
        status: response.status,
        body: null,
      }
    }

    return {
      status: response.status,
      body: await response.json(),
    }
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

export function adaptSchedule(value: unknown): GuideSchedule[] | null {
  if (!Array.isArray(value)) {
    return null
  }

  return value.map((entry) => {
    if (!isRecord(entry)) {
      return {}
    }

    const schedule: GuideSchedule = {}
    if (isRecord(entry.channel)) {
      schedule.channel = {}
      if (typeof entry.channel.id === 'number') {
        schedule.channel.id = entry.channel.id
      }
      if (typeof entry.channel.name === 'string') {
        schedule.channel.name = entry.channel.name
      }
      if (typeof entry.channel.type === 'number') {
        schedule.channel.type = entry.channel.type
      }
    }
    if (Array.isArray(entry.programs)) {
      schedule.programs = entry.programs
        .map((program): GuideProgram | null => {
          if (!isRecord(program)) {
            return null
          }

          const adapted: GuideProgram = {}
          if (typeof program.id === 'number') {
            adapted.id = program.id
          }
          if (typeof program.name === 'string') {
            adapted.name = program.name
          }
          if (typeof program.description === 'string') {
            adapted.description = program.description
          }
          if (typeof program.startAt === 'number') {
            adapted.startAt = program.startAt
          }
          if (typeof program.endAt === 'number') {
            adapted.endAt = program.endAt
          }
          if (typeof program.channelId === 'number') {
            adapted.channelId = program.channelId
          }
          if (typeof program.genre1 === 'number') {
            adapted.genre1 = program.genre1
          }
          if (typeof program.subGenre1 === 'number') {
            adapted.subGenre1 = program.subGenre1
          }
          if (typeof program.genre2 === 'number') {
            adapted.genre2 = program.genre2
          }
          if (typeof program.subGenre2 === 'number') {
            adapted.subGenre2 = program.subGenre2
          }
          if (typeof program.genre3 === 'number') {
            adapted.genre3 = program.genre3
          }
          if (typeof program.subGenre3 === 'number') {
            adapted.subGenre3 = program.subGenre3
          }
          if (typeof program.extended === 'string') {
            adapted.extended = program.extended
          }
          if (typeof program.videoComponentType === 'number') {
            adapted.videoComponentType = program.videoComponentType
          }
          if (typeof program.audioComponentType === 'number') {
            adapted.audioComponentType = program.audioComponentType
          }
          if (typeof program.audioSamplingRate === 'number') {
            adapted.audioSamplingRate = program.audioSamplingRate
          }
          if (typeof program.isFree === 'boolean') {
            adapted.isFree = program.isFree
          }

          return adapted
        })
        .filter((program): program is GuideProgram => program !== null)
    }

    return schedule
  })
}

export function adaptReserveItem(value: unknown): GuideReserveItem | null {
  if (!isRecord(value)) {
    return null
  }
  const id = typeof value.reserveId === 'number' ? value.reserveId : value.id

  if (typeof id !== 'number') {
    return null
  }

  const item: GuideReserveItem = {
    id,
  }

  if (typeof value.programId === 'number') {
    item.programId = value.programId
  }
  if (typeof value.ruleId === 'number') {
    item.ruleId = value.ruleId
  }

  return item
}

export function adaptAddReserveResponse(value: unknown): { reserveId: number } | null {
  if (!isRecord(value) || typeof value.reserveId !== 'number') {
    return null
  }

  return {
    reserveId: value.reserveId,
  }
}

export function adaptReserveList(value: unknown): GuideReserveItem[] | null {
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

  return {
    normal,
    conflicts,
    skips,
    overlaps,
  }
}
