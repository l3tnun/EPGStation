import type { GuideProgram } from '../guideApi'
import type { GuideReserveIndex } from '../guideRequests'
import {
  DAY_MS,
  HOUR_MS,
  MINUTE_MS,
  WEEKDAYS,
  type GuideGenreVisibility,
  type GuideGridLayout,
  type GuideGridLayoutInput,
  type GuideGridLayoutProgram,
  type GuideGridViewport,
} from './guideGridTypes'

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

export function isAudioVideoService(serviceType?: number): boolean {
  switch (serviceType) {
    case 0x01:
    case 0x02:
    case 0xa1:
    case 0xa2:
    case 0xa5:
    case 0xa6:
    case 0xad:
    case undefined:
      return true
    default:
      return false
  }
}

function getJapanDateParts(timestamp: number): {
  month: number
  day: number
  hour: number
  minute: number
  weekday: (typeof WEEKDAYS)[number]
} {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tokyo',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
    minute: '2-digit',
    weekday: 'short',
  }).formatToParts(new Date(timestamp))
  const part = (type: string): string => parts.find((entry) => entry.type === type)?.value ?? '0'
  const weekdayMap: Record<string, (typeof WEEKDAYS)[number]> = {
    Sun: '日',
    Mon: '月',
    Tue: '火',
    Wed: '水',
    Thu: '木',
    Fri: '金',
    Sat: '土',
  }

  return {
    month: Number(part('month')),
    day: Number(part('day')),
    hour: Number(part('hour')),
    minute: Number(part('minute')),
    weekday: weekdayMap[part('weekday')] ?? WEEKDAYS[new Date(timestamp).getUTCDay()],
  }
}

export function formatProgramStartTime(timestamp: number): string {
  const parts = getJapanDateParts(timestamp)

  return `${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`
}

function formatDateHeader(timestamp: number): string {
  const parts = getJapanDateParts(timestamp)

  return `${String(parts.month).padStart(2, '0')}/${String(parts.day).padStart(2, '0')}(${
    parts.weekday
  })`
}

export function firstGenre(program: GuideProgram): number | undefined {
  if (typeof program.genre1 === 'number') {
    return program.genre1
  }
  if (typeof program.genre2 === 'number') {
    return program.genre2
  }
  if (typeof program.genre3 === 'number') {
    return program.genre3
  }

  return undefined
}

function toRenderableProgram(program: GuideProgram): GuideGridLayoutProgram['program'] | null {
  if (
    !isFiniteNumber(program.id) ||
    !isFiniteNumber(program.startAt) ||
    !isFiniteNumber(program.endAt)
  ) {
    return null
  }

  return {
    ...program,
    id: program.id,
    startAt: program.startAt,
    endAt: program.endAt,
  }
}

function createTimeLabels(startAt: number, hours: number): number[] {
  const startHour = getJapanDateParts(startAt).hour

  return Array.from({ length: hours }, (_, index) => (startHour + index) % 24)
}

export function createGuideGridLayout(input: GuideGridLayoutInput): GuideGridLayout {
  const schedules =
    input.mode === 'normal'
      ? input.schedules.filter((schedule) => isAudioVideoService(schedule.channel?.type))
      : input.schedules
  const programs: GuideGridLayoutProgram[] = []

  schedules.forEach((schedule, scheduleIndex) => {
    const baseStartAt =
      input.mode === 'singleChannel' ? input.startAt + scheduleIndex * DAY_MS : input.startAt
    const baseEndAt = baseStartAt + input.hours * HOUR_MS

    schedule.programs?.forEach((rawProgram) => {
      const program = toRenderableProgram(rawProgram)

      if (program === null) {
        return
      }

      const clippedStartAt = Math.max(baseStartAt, program.startAt)
      const clippedEndAt = Math.min(baseEndAt, program.endAt)
      const heightMinutes = Math.ceil((clippedEndAt - clippedStartAt) / MINUTE_MS)

      if (heightMinutes <= 0) {
        return
      }

      programs.push({
        channel: schedule.channel ?? {},
        program,
        channelIndex: scheduleIndex,
        topMinutes:
          clippedStartAt === baseStartAt
            ? 0
            : Math.ceil(Math.floor((clippedStartAt - baseStartAt) / 1000) / 60),
        heightMinutes,
      })
    })
  })

  return {
    channels: schedules.map((schedule, index) =>
      input.mode === 'singleChannel'
        ? {
            ...schedule.channel,
            name: formatDateHeader(input.startAt + index * DAY_MS),
          }
        : (schedule.channel ?? {}),
    ),
    programs,
    timeLabels: createTimeLabels(input.startAt, input.hours),
    contentMinutes: input.hours * 60,
  }
}

export function createProgramCellClassList({
  program,
  reserveIndex,
  genreVisibility,
  hidden,
}: {
  program: GuideProgram
  reserveIndex: GuideReserveIndex
  genreVisibility: GuideGenreVisibility
  hidden: boolean
}): string[] {
  const classes = ['guide-program-cell']
  const genre = firstGenre(program)

  classes.push(genre === undefined ? 'ctg-empty' : `ctg-${genre}`)

  if (program.isFree === true) {
    classes.push('is-free')
  } else if (program.isFree === false) {
    classes.push('is-paid')
  }

  if (genre !== undefined && genreVisibility[genre] === false) {
    classes.push('hide')
  }

  if (typeof program.id === 'number') {
    const reserveState = reserveIndex[program.id]?.type

    if (reserveState !== undefined) {
      classes.push(reserveState)
    }
  }

  if (hidden) {
    classes.push('hidden')
  }

  return classes
}

export function shouldUpdateGuideVisibility(viewport: GuideGridViewport): boolean {
  const normalized = normalizeGuideViewport(viewport)

  return (
    Number.isFinite(normalized.scrollLeft) &&
    Number.isFinite(normalized.scrollTop) &&
    Number.isFinite(normalized.width) &&
    Number.isFinite(normalized.height)
  )
}

export function normalizeGuideViewport(viewport: GuideGridViewport): GuideGridViewport {
  const maxScrollLeft = Math.max(0, viewport.contentWidth - viewport.width)
  const maxScrollTop = Math.max(0, viewport.contentHeight - viewport.height)

  return {
    ...viewport,
    scrollLeft: Math.min(Math.max(viewport.scrollLeft, 0), maxScrollLeft),
    scrollTop: Math.min(Math.max(viewport.scrollTop, 0), maxScrollTop),
  }
}
