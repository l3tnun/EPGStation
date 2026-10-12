import type { BroadcastWave } from '@/app/navigation'
import type { SettingsConsumerValue } from '@/shared/settings'
import {
  BROADCAST_WAVES,
  HOUR_MS,
  JAPAN_TIME_OFFSET_MS,
  SINGLE_CHANNEL_GUIDE_DAYS,
  SINGLE_CHANNEL_GUIDE_DAY_HOURS,
  type GuideFetchRequestSet,
  type GuideQuery,
  type NormalGuideScheduleRequest,
} from './guideRequestTypes'

export const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'] as const

export function parseChannelId(
  value: string | null,
  invalidChannelIds: ReadonlySet<number>,
): number | undefined {
  if (value === null || value === '') {
    return undefined
  }

  const parsed = Number(value)

  return Number.isSafeInteger(parsed) && parsed > 0 && !invalidChannelIds.has(parsed)
    ? parsed
    : undefined
}

export function parseBroadcastWave(value: string | null): BroadcastWave | undefined {
  if (value === null) {
    return undefined
  }

  return BROADCAST_WAVES.includes(value as BroadcastWave) ? (value as BroadcastWave) : undefined
}

export function createJapanTimestamp(
  year: number,
  month: number,
  day: number,
  hour: number,
): number {
  return Date.UTC(year, month - 1, day, hour) - JAPAN_TIME_OFFSET_MS
}

export function getJapanDateParts(timestamp: number): {
  year: number
  month: number
  day: number
  hour: number
} {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(timestamp))
  const valueOf = (type: string): number => {
    const value = parts.find((part) => part.type === type)?.value

    return value === undefined ? 0 : Number(value)
  }

  return {
    year: valueOf('year'),
    month: valueOf('month'),
    day: valueOf('day'),
    hour: valueOf('hour'),
  }
}

export function formatGuideRouteTime(timestamp: number): string {
  const parts = getJapanDateParts(timestamp)

  return `${String(parts.year % 100).padStart(2, '0')}${String(parts.month).padStart(
    2,
    '0',
  )}${String(parts.day).padStart(2, '0')}${String(parts.hour).padStart(2, '0')}`
}

export function buildGuideRouteWithTime({
  time,
  currentQuery,
  selectedType,
}: {
  time: number
  currentQuery: GuideQuery
  selectedType?: BroadcastWave
}): string {
  const parameters = new URLSearchParams()
  parameters.set('time', formatGuideRouteTime(time))
  const type = selectedType ?? currentQuery.type

  if (type !== undefined) {
    parameters.set('type', type)
  }
  if (currentQuery.channelId !== undefined) {
    parameters.set('channelId', String(currentQuery.channelId))
  }

  return `/guide?${parameters.toString()}`
}

export function parseGuideTime(
  value: string | null,
): { startAt: number; isValid: boolean } | undefined {
  if (value === null) {
    return undefined
  }

  if (!/^\d{8}$/.test(value)) {
    return {
      startAt: Number.NaN,
      isValid: false,
    }
  }

  const year = 2000 + Number(value.slice(0, 2))
  const month = Number(value.slice(2, 4))
  const day = Number(value.slice(4, 6))
  const hour = Number(value.slice(6, 8))

  if (hour < 0 || hour > 23) {
    return {
      startAt: Number.NaN,
      isValid: false,
    }
  }

  const startAt = createJapanTimestamp(year, month, day, hour)
  const parts = getJapanDateParts(startAt)

  if (parts.year !== year || parts.month !== month || parts.day !== day || parts.hour !== hour) {
    return {
      startAt,
      isValid: false,
    }
  }

  return {
    startAt,
    isValid: true,
  }
}

export function resolveStartAt(
  searchParameters: URLSearchParams,
  now: number,
): {
  startAt: number
  isTimeQueryValid: boolean
} {
  const parsedTime = parseGuideTime(searchParameters.get('time'))

  if (parsedTime === undefined) {
    const nowParts = getJapanDateParts(now)

    return {
      startAt: createJapanTimestamp(nowParts.year, nowParts.month, nowParts.day, nowParts.hour),
      isTimeQueryValid: true,
    }
  }

  if (!parsedTime.isValid) {
    const nowParts = getJapanDateParts(now)

    return {
      startAt: createJapanTimestamp(nowParts.year, nowParts.month, nowParts.day, nowParts.hour),
      isTimeQueryValid: false,
    }
  }

  return {
    startAt: parsedTime.startAt,
    isTimeQueryValid: true,
  }
}

export function createNormalScheduleRequest({
  settings,
  type,
  startAt,
  enabledBroadcastWaves = [],
}: {
  settings: SettingsConsumerValue
  type: BroadcastWave | undefined
  startAt: number
  // BS4K が無い環境（enabledBroadcastWaves に BS4K を含まない）と互換の request を
  // 作るため、type 未指定（全種別表示）時に BS4K を含めるかはここで判定する。GR/BS/CS/SKY は
  // enabled 状態に関わらず従来通り type だけで決める。
  enabledBroadcastWaves?: readonly BroadcastWave[]
}): NormalGuideScheduleRequest {
  const waves = {
    GR: type === undefined,
    BS: type === undefined,
    CS: type === undefined,
    SKY: type === undefined,
    BS4K: type === undefined ? enabledBroadcastWaves.includes('BS4K') : false,
  }

  if (type !== undefined) {
    waves[type] = true
  }

  return {
    mode: 'normal',
    startAt,
    endAt: startAt + settings.guideLength * HOUR_MS,
    isHalfWidth: settings.isHalfWidthDisplayed,
    isFree: settings.isShowOnlyFreePrograms,
    ...waves,
  }
}

export function buildGuideFetchRequestSet({
  settings,
  search,
  now = Date.now(),
  invalidChannelIds,
  enabledBroadcastWaves = [],
}: {
  settings: SettingsConsumerValue
  search: string
  now?: number
  invalidChannelIds?: ReadonlySet<number>
  enabledBroadcastWaves?: readonly BroadcastWave[]
}): GuideFetchRequestSet {
  const searchParameters = new URLSearchParams(search)
  const type = parseBroadcastWave(searchParameters.get('type'))
  const channelId = parseChannelId(
    searchParameters.get('channelId'),
    invalidChannelIds ?? new Set(),
  )
  const startTime = resolveStartAt(searchParameters, now)
  const guideQuery: GuideQuery = {
    mode: channelId === undefined ? 'normal' : 'singleChannel',
    startAt: startTime.startAt,
    isTimeQueryValid: startTime.isTimeQueryValid,
  }

  if (type !== undefined) {
    guideQuery.type = type
  }
  if (channelId !== undefined) {
    guideQuery.channelId = channelId
  }

  if (channelId !== undefined) {
    const endAt =
      startTime.startAt + SINGLE_CHANNEL_GUIDE_DAYS * SINGLE_CHANNEL_GUIDE_DAY_HOURS * HOUR_MS

    return {
      guideQuery,
      schedule: {
        mode: 'singleChannel',
        channelId,
        startAt: startTime.startAt,
        days: SINGLE_CHANNEL_GUIDE_DAYS,
        isHalfWidth: settings.isHalfWidthDisplayed,
        isFree: settings.isShowOnlyFreePrograms,
      },
      reserveIndex: {
        startAt: startTime.startAt,
        endAt,
      },
    }
  }

  const schedule = createNormalScheduleRequest({
    settings,
    type,
    startAt: startTime.startAt,
    enabledBroadcastWaves,
  })

  return {
    guideQuery,
    schedule,
    reserveIndex: {
      startAt: schedule.startAt,
      endAt: schedule.endAt,
    },
  }
}
