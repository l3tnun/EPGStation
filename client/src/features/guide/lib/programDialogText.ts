import type { GuideProgramDialogProgram, ProgramAction } from '../ProgramDialog'
import {
  AUDIO_COMPONENT_TYPES,
  AUDIO_SAMPLING_RATES,
  GENRE_NAMES,
  SUB_GENRE_NAMES,
  VIDEO_COMPONENT_TYPES,
} from './programGenreLabels'

export function programName(program: GuideProgramDialogProgram): string {
  return program.name ?? `番組 ${program.id}`
}

// These legacy formatting helpers are also reused by the manual reserve screen.
export function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

export function formatLegacyProgramTime(program: GuideProgramDialogProgram): string | null {
  if (program.startAt === undefined || program.endAt === undefined) {
    return null
  }

  const startParts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tokyo',
    month: '2-digit',
    day: '2-digit',
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
  const durationMinutes = Math.round((program.endAt - program.startAt) / 60000)

  return `${startPart('month')}/${startPart('day')} ${startPart('hour')}:${startPart(
    'minute',
  )} ~ ${endPart('hour')}:${endPart('minute')}(${durationMinutes}分)`
}

export function resolveLegacyGenre(
  genre: number | undefined,
  subGenre: number | undefined,
): string | null {
  if (genre === undefined || GENRE_NAMES[genre] === undefined) {
    return null
  }

  const subGenreName =
    subGenre === undefined || SUB_GENRE_NAMES[genre]?.[subGenre] === undefined
      ? undefined
      : SUB_GENRE_NAMES[genre][subGenre]

  return subGenreName === undefined ? GENRE_NAMES[genre] : `${GENRE_NAMES[genre]} / ${subGenreName}`
}

export function resolveLegacyGenres(program: GuideProgramDialogProgram): readonly string[] {
  return [
    resolveLegacyGenre(program.genre1, program.subGenre1),
    resolveLegacyGenre(program.genre2, program.subGenre2),
    resolveLegacyGenre(program.genre3, program.subGenre3),
  ].filter((genre): genre is string => genre !== null)
}

export function resolveLegacyComponentDetails(program: {
  videoComponentType?: number
  audioComponentType?: number
  audioSamplingRate?: number
}): readonly string[] {
  return [
    program.videoComponentType === undefined
      ? undefined
      : VIDEO_COMPONENT_TYPES[program.videoComponentType],
    program.audioComponentType === undefined
      ? undefined
      : AUDIO_COMPONENT_TYPES[program.audioComponentType],
    program.audioSamplingRate === undefined
      ? undefined
      : AUDIO_SAMPLING_RATES[program.audioSamplingRate],
  ].filter((value): value is string => value !== undefined)
}

export function actionSnackbarText({
  name,
  action,
  ok,
}: {
  name: string
  action: ProgramAction
  ok: boolean
}): string {
  const suffix = {
    add: ok ? '予約' : '予約失敗',
    delete: ok ? 'キャンセル' : 'キャンセル失敗',
    exclude: ok ? 'キャンセル' : 'キャンセル失敗',
    unskip: ok ? '除外解除' : '除外解除失敗',
    unoverlap: ok ? '重複解除' : '重複解除失敗',
  }[action]

  return `${name} ${suffix}`
}
