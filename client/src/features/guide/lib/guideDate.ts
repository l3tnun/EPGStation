import { formatGuideRouteTime } from '../guideRequests'

export const HOUR_MS = 60 * 60 * 1000

export type WeekdayLabel = '日' | '月' | '火' | '水' | '木' | '金' | '土'

export interface GuideDateOption {
  label: string
  value: number
  routeTime: string
  dayStartAt: number
  dayRouteTime: string
}

export function createJapanTimestamp(
  year: number,
  month: number,
  day: number,
  hour: number,
): number {
  return Date.UTC(year, month - 1, day, hour) - 9 * HOUR_MS
}

export function getJapanDateParts(timestamp: number): {
  year: number
  month: number
  day: number
  hour: number
  weekday: WeekdayLabel
} {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
    weekday: 'short',
  }).formatToParts(new Date(timestamp))
  const value = (type: string): string => parts.find((part) => part.type === type)?.value ?? '0'
  const weekdayMap: Record<string, WeekdayLabel> = {
    Sun: '日',
    Mon: '月',
    Tue: '火',
    Wed: '水',
    Thu: '木',
    Fri: '金',
    Sat: '土',
  }

  return {
    year: Number(value('year')),
    month: Number(value('month')),
    day: Number(value('day')),
    hour: Number(value('hour')),
    weekday: weekdayMap[value('weekday')] ?? '日',
  }
}

export function formatDayLabel(timestamp: number): string {
  const parts = getJapanDateParts(timestamp)

  return `${String(parts.month).padStart(2, '0')}/${String(parts.day).padStart(2, '0')}(${
    parts.weekday
  })`
}

export function createGuideDateOptions(baseTimestamp: number): GuideDateOption[] {
  const baseParts = getJapanDateParts(baseTimestamp)

  return Array.from({ length: 8 }, (_, index) => {
    const dayStartAt = createJapanTimestamp(
      baseParts.year,
      baseParts.month,
      baseParts.day + index,
      0,
    )
    const value = index === 0 ? dayStartAt + baseParts.hour * HOUR_MS : dayStartAt

    return {
      label: formatDayLabel(value),
      value,
      routeTime: formatGuideRouteTime(value),
      dayStartAt,
      dayRouteTime: formatGuideRouteTime(dayStartAt),
    }
  })
}

export function formatGuideRouteDay(timestamp: number): string {
  return formatGuideRouteTime(timestamp).slice(0, 6)
}
