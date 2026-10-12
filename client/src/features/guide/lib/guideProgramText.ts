import {
  DEFAULT_GUIDE_PROGRAM_DETAIL_SETTING,
  GUIDE_PROGRAM_DETAIL_STORAGE_KEY,
  GUIDE_RESERVE_INDEX_QUERY_KEY,
  GUIDE_SCHEDULE_QUERY_KEY,
  type GuideFetchRequestSet,
  type GuideProgramDetailSetting,
  type GuideProgramExtendedTextToken,
  type GuideQuery,
  type GuideReserveIndex,
  type GuideReserveItem,
  type GuideReserveLists,
  type ReserveVisualState,
} from './guideRequestTypes'
import { WEEKDAYS } from './guideRoute'

export function isSafeHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)

    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

export function linkifyGuideProgramExtendedText(
  text: string | undefined,
): GuideProgramExtendedTextToken[] {
  if (text === undefined || text === '') {
    return []
  }

  const tokens: GuideProgramExtendedTextToken[] = []
  const urlPattern = /https?:\/\/[^\s<>"']+/gi
  let index = 0

  for (const match of text.matchAll(urlPattern)) {
    const value = match[0]
    const matchIndex = match.index ?? 0

    if (matchIndex > index) {
      tokens.push({ type: 'text', text: text.slice(index, matchIndex) })
    }

    tokens.push(
      isSafeHttpUrl(value)
        ? { type: 'link', text: value, href: value }
        : { type: 'text', text: value },
    )
    index = matchIndex + value.length
  }

  if (index < text.length) {
    tokens.push({ type: 'text', text: text.slice(index) })
  }

  return tokens
}

export function parseGuideProgramDetailSetting(value: string | null): GuideProgramDetailSetting {
  if (value === null) {
    return { ...DEFAULT_GUIDE_PROGRAM_DETAIL_SETTING }
  }

  try {
    const parsed: unknown = JSON.parse(value)

    if (typeof parsed !== 'object' || parsed === null) {
      return { ...DEFAULT_GUIDE_PROGRAM_DETAIL_SETTING }
    }

    const record = parsed as Record<string, unknown>

    return {
      encode: typeof record.encode === 'string' && record.encode !== '' ? record.encode : 'TS',
      isDeleteOriginalAfterEncode:
        typeof record.isDeleteOriginalAfterEncode === 'boolean'
          ? record.isDeleteOriginalAfterEncode
          : false,
    }
  } catch {
    return { ...DEFAULT_GUIDE_PROGRAM_DETAIL_SETTING }
  }
}

export function readGuideProgramDetailSetting(
  storage: Pick<Storage, 'getItem'> | undefined,
): GuideProgramDetailSetting {
  return parseGuideProgramDetailSetting(storage?.getItem(GUIDE_PROGRAM_DETAIL_STORAGE_KEY) ?? null)
}

export function writeGuideProgramDetailSetting(
  storage: Pick<Storage, 'setItem'> | undefined,
  setting: GuideProgramDetailSetting,
): void {
  storage?.setItem(
    GUIDE_PROGRAM_DETAIL_STORAGE_KEY,
    JSON.stringify({
      encode: setting.encode === '' ? 'TS' : setting.encode,
      isDeleteOriginalAfterEncode: setting.isDeleteOriginalAfterEncode,
    }),
  )
}

export function createGuideQueryKeys(requestSet: GuideFetchRequestSet) {
  return {
    schedule: [...GUIDE_SCHEDULE_QUERY_KEY, requestSet.schedule] as const,
    reserveIndex: [...GUIDE_RESERVE_INDEX_QUERY_KEY, requestSet.reserveIndex] as const,
  }
}

export function formatGuideDate(timestamp: number): string {
  const date = new Date(timestamp)
  const month = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tokyo',
    month: '2-digit',
  }).format(date)
  const day = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tokyo',
    day: '2-digit',
  }).format(date)
  const weekdayLabel = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tokyo',
    weekday: 'short',
  }).format(date)
  const weekdayMap: Record<string, (typeof WEEKDAYS)[number]> = {
    Sun: '日',
    Mon: '月',
    Tue: '火',
    Wed: '水',
    Thu: '木',
    Fri: '金',
    Sat: '土',
  }
  const weekday = weekdayMap[weekdayLabel] ?? WEEKDAYS[date.getUTCDay()]

  return `${month}/${day}(${weekday})`
}

export function resolveGuideTitle(
  query: GuideQuery,
  scheduleChannelName?: string,
  options: { showDate?: boolean } = {},
): string {
  if (query.mode === 'singleChannel' && scheduleChannelName !== undefined) {
    return scheduleChannelName
  }

  return `番組表${query.type ?? ''}${
    options.showDate === false ? '' : ` ${formatGuideDate(query.startAt)}`
  }`
}

export function assignReserveIndex(
  index: GuideReserveIndex,
  type: ReserveVisualState,
  items: readonly GuideReserveItem[],
): void {
  items.forEach((item) => {
    if (item.programId !== undefined) {
      index[item.programId] = {
        type,
        item,
      }
    }
  })
}

export function transformReserveListsToIndex(lists: GuideReserveLists): GuideReserveIndex {
  const index: GuideReserveIndex = {}

  assignReserveIndex(index, 'reserve', lists.normal)
  assignReserveIndex(index, 'conflict', lists.conflicts)
  assignReserveIndex(index, 'skip', lists.skips)
  assignReserveIndex(index, 'overlap', lists.overlaps)

  return index
}
