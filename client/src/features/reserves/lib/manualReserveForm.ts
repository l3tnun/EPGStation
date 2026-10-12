import type { ManualProgramDetail, ReserveListItem } from './reservesApiTypes'
import type {
  ManualEncodeOption,
  ManualReservePageInfo,
  ManualSaveOption,
  ManualTimeSpecifiedOption,
} from './manualReserveTypes'

export interface ManualReserveFormState {
  isTimeSpecification: boolean
  timeSpecifiedOption: ManualTimeSpecifiedOption
  reserveOption: {
    allowEndLack: boolean
  }
  saveOption?: ManualSaveOption
  encodeOption: ManualEncodeOption
}

export type ManualOptionPanelIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6

export const EMPTY_TIME_SPECIFIED_OPTION: ManualTimeSpecifiedOption = {
  name: null,
  channelId: null,
  startAt: null,
  endAt: null,
}

export const EMPTY_ENCODE_OPTION: ManualEncodeOption = {
  mode1: null,
  mode2: null,
  mode3: null,
  isDeleteOriginalAfterEncode: false,
}

export function createInitialFormState(): ManualReserveFormState {
  return {
    isTimeSpecification: false,
    timeSpecifiedOption: { ...EMPTY_TIME_SPECIFIED_OPTION },
    reserveOption: {
      allowEndLack: true,
    },
    saveOption: undefined,
    encodeOption: { ...EMPTY_ENCODE_OPTION },
  }
}

export function createFormStateFromPageInfo(
  pageInfo: ManualReservePageInfo,
): ManualReserveFormState {
  return {
    isTimeSpecification: pageInfo.isTimeSpecification,
    timeSpecifiedOption: { ...pageInfo.timeSpecifiedOption },
    reserveOption: { ...pageInfo.reserveOption },
    saveOption: pageInfo.saveOption === undefined ? undefined : { ...pageInfo.saveOption },
    encodeOption: { ...pageInfo.encodeOption },
  }
}

export function createPageInfoFromFormState(
  formState: ManualReserveFormState,
): ManualReservePageInfo {
  return {
    isTimeSpecification: formState.isTimeSpecification,
    timeSpecifiedOption: { ...formState.timeSpecifiedOption },
    reserveOption: { ...formState.reserveOption },
    saveOption: formState.saveOption === undefined ? undefined : { ...formState.saveOption },
    encodeOption: { ...formState.encodeOption },
  }
}

export function createFormStateFromProgram(program: ManualProgramDetail): ManualReserveFormState {
  return {
    ...createInitialFormState(),
    timeSpecifiedOption: {
      name: program.name,
      channelId: program.channelId,
      startAt: program.startAt,
      endAt: program.endAt,
    },
  }
}

export function createFormStateFromReserve(reserve: ReserveListItem): ManualReserveFormState {
  return {
    isTimeSpecification: reserve.isTimeSpecified === true,
    timeSpecifiedOption: {
      name: reserve.name ?? null,
      channelId: reserve.channelId ?? null,
      startAt: reserve.startAt ?? null,
      endAt: reserve.endAt ?? null,
    },
    reserveOption: {
      allowEndLack: reserve.allowEndLack ?? true,
    },
    saveOption: {
      parentDirectoryName: reserve.parentDirectoryName ?? null,
      directory: reserve.directory ?? null,
      recordedFormat: reserve.recordedFormat ?? null,
    },
    encodeOption: {
      mode1: reserve.encodeMode1 ?? null,
      encodeParentDirectoryName1: reserve.encodeParentDirectoryName1 ?? null,
      directory1: reserve.encodeDirectory1 ?? null,
      mode2: reserve.encodeMode2 ?? null,
      encodeParentDirectoryName2: reserve.encodeParentDirectoryName2 ?? null,
      directory2: reserve.encodeDirectory2 ?? null,
      mode3: reserve.encodeMode3 ?? null,
      encodeParentDirectoryName3: reserve.encodeParentDirectoryName3 ?? null,
      directory3: reserve.encodeDirectory3 ?? null,
      isDeleteOriginalAfterEncode: reserve.isDeleteOriginalAfterEncode ?? false,
    },
  }
}

export function normalizeFormState(watched: ManualReserveFormState): ManualReserveFormState {
  return {
    ...createInitialFormState(),
    ...watched,
    timeSpecifiedOption: {
      ...EMPTY_TIME_SPECIFIED_OPTION,
      ...watched.timeSpecifiedOption,
    },
    reserveOption: {
      allowEndLack: watched.reserveOption?.allowEndLack ?? true,
    },
    encodeOption: {
      ...EMPTY_ENCODE_OPTION,
      ...watched.encodeOption,
    },
  }
}

export function valueFromNullableNumber(value: number | null | undefined): string {
  return value === null || value === undefined ? '' : String(value)
}

// 時刻指定予約の入力欄と日時 picker が壁時計として扱う timezone。
export const MANUAL_RESERVE_TIME_ZONE = 'Asia/Tokyo'

export function formatManualDateTimeInput(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return ''
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return ''
  }

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: MANUAL_RESERVE_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((item) => item.type === type)?.value ?? '00'

  return `${part('year')}-${part('month')}-${part('day')} ${part('hour')}:${part('minute')}`
}

export function parseNullableNumber(value: string): number | null {
  if (value === '') {
    return null
  }

  const parsed = Number(value)

  return Number.isSafeInteger(parsed) ? parsed : null
}

export function parseManualDateTimeInput(value: string): number | null {
  const trimmed = value.trim()
  if (trimmed === '') {
    return null
  }

  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/.exec(trimmed)
  if (match === null) {
    // An incomplete or malformed "yyyy-MM-dd HH:mm" string (e.g. mid-keystroke while typing)
    // must not fall back to being parsed as a raw UNIX millisecond number: that fallback would
    // turn a single typed digit into a tiny timestamp that displays as 1970-01-01, corrupting the
    // field on every keystroke. Treat anything that isn't a complete match as "no value yet".
    return null
  }

  const [, yearText, monthText, dayText, hourText, minuteText] = match
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  const hour = Number(hourText)
  const minute = Number(minuteText)

  // `Date.UTC` silently rolls an out-of-range component into the next unit instead of rejecting
  // it (e.g. day 31 of a 28-day February becomes March 3). A format-matching but non-existent
  // date/time like "2026-02-31 25:99" must not turn into a real, different-looking timestamp
  // that the field never displayed. Reject anything outside its component's valid range first.
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInManualReserveMonth(year, month) ||
    hour > 23 ||
    minute > 59
  ) {
    return null
  }

  const parsed = Date.UTC(year, month - 1, day, hour - 9, minute, 0, 0)

  if (Number.isNaN(parsed)) {
    return null
  }

  // Defense in depth: even if the range checks above miss an edge case, require the parsed
  // timestamp to round-trip back to (a normalized form of) exactly what was typed. If it
  // doesn't, `Date.UTC` rolled the value over into an adjacent date/time rather than the one
  // requested, which must never be converted to milliseconds sent to the API.
  const normalizedInput = trimmed.replace('T', ' ')
  if (formatManualDateTimeInput(parsed) !== normalizedInput) {
    return null
  }

  return parsed
}

function daysInManualReserveMonth(year: number, month: number): number {
  // `month` is 1-12; day 0 of the following month is the last day of `month`.
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

export function nullableString(value: string): string | null {
  return value === '' ? null : value
}
