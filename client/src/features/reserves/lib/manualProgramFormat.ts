import { resolveLegacyGenre } from '@/features/guide/ProgramDialog'
import type { ManualProgramDetail } from './reservesApiTypes'

export function formatManualProgramDate(program: ManualProgramDetail): string {
  const duration = Math.floor((program.endAt - program.startAt) / 60000)
  const startParts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tokyo',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(program.startAt))
  const endParts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tokyo',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(program.endAt))
  const startPart = (type: Intl.DateTimeFormatPartTypes): string =>
    startParts.find((part) => part.type === type)?.value ?? '00'
  const endPart = (type: Intl.DateTimeFormatPartTypes): string =>
    endParts.find((part) => part.type === type)?.value ?? '00'
  const weekdayMap: Record<string, string> = {
    Sun: '日',
    Mon: '月',
    Tue: '火',
    Wed: '水',
    Thu: '木',
    Fri: '金',
    Sat: '土',
  }

  return `${startPart('month')}/${startPart('day')}(${
    weekdayMap[startPart('weekday')] ?? '日'
  }) ${startPart('hour')}:${startPart('minute')} ~ ${endPart('hour')}:${endPart(
    'minute',
  )} (${duration}m)`
}

export function manualProgramGenres(program: ManualProgramDetail): readonly string[] {
  if (program.genres !== undefined && program.genres.length > 0) {
    return program.genres
  }

  return [
    resolveLegacyGenre(program.genre1, program.subGenre1),
    resolveLegacyGenre(program.genre2, program.subGenre2),
    resolveLegacyGenre(program.genre3, program.subGenre3),
  ].filter((genre): genre is string => genre !== null)
}
