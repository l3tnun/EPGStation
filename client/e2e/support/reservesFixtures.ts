export const RESERVES_SYNTHETIC_LINK = 'https://example.invalid/reserve-info'

const baseStart = Date.parse('2026-05-05T10:00:00+09:00')

export interface SyntheticReserve {
  id: number
  reserveId: number
  programId: number | null
  ruleId: number | null
  isManual: boolean
  name: string
  channelId: number
  channelName: string
  startAt: number
  endAt: number
  description?: string
  extended?: string
  genres?: readonly string[]
  isConflict: boolean
  isSkip: boolean
  isOverlap: boolean
  isTimeSpecified?: boolean
  allowEndLack?: boolean
  canDelete: boolean
  canUnlockSkip: boolean
  canUnlockOverlap: boolean
  durationMinutes: number
}

function minutesFromBase(minutes: number): number {
  return baseStart + minutes * 60 * 1000
}

export const reserveDialogFull: SyntheticReserve = {
  id: 101,
  reserveId: 101,
  programId: null,
  ruleId: null,
  isManual: true,
  name: 'Synthetic Dialog Full Reserve',
  channelId: 301,
  channelName: 'Synthetic Channel A',
  startAt: minutesFromBase(0),
  endAt: minutesFromBase(30),
  description: 'Synthetic description for normal reserve.',
  extended: `Synthetic extended text ${RESERVES_SYNTHETIC_LINK}`,
  genres: ['Synthetic Genre A'],
  isConflict: false,
  isSkip: false,
  isOverlap: false,
  isTimeSpecified: true,
  allowEndLack: true,
  canDelete: true,
  canUnlockSkip: false,
  canUnlockOverlap: false,
  durationMinutes: 30,
}

export const reserveDeleteTarget: SyntheticReserve = {
  id: 102,
  reserveId: 102,
  programId: 9002,
  ruleId: 502,
  isManual: false,
  name: 'Synthetic Delete Target Reserve With Long Title For Layout Checks',
  channelId: 302,
  channelName: 'Synthetic Channel B',
  startAt: minutesFromBase(45),
  endAt: minutesFromBase(95),
  description: 'Synthetic rule reserve description with enough text to wrap on small screens.',
  genres: ['Synthetic Genre B'],
  isConflict: false,
  isSkip: false,
  isOverlap: false,
  canDelete: true,
  canUnlockSkip: false,
  canUnlockOverlap: false,
  durationMinutes: 50,
}

const syntheticConflictReserve: SyntheticReserve = {
  id: 103,
  reserveId: 103,
  programId: null,
  ruleId: null,
  isManual: false,
  name: 'Synthetic Conflict Reserve',
  channelId: 303,
  channelName: 'Synthetic Channel C',
  startAt: minutesFromBase(100),
  endAt: minutesFromBase(130),
  isConflict: true,
  isSkip: false,
  isOverlap: false,
  canDelete: false,
  canUnlockSkip: false,
  canUnlockOverlap: false,
  durationMinutes: 30,
}

const syntheticSkipReserve: SyntheticReserve = {
  id: 104,
  reserveId: 104,
  programId: null,
  ruleId: null,
  isManual: true,
  name: 'Synthetic Skip Reserve',
  channelId: 304,
  channelName: 'Synthetic Channel D',
  startAt: minutesFromBase(140),
  endAt: minutesFromBase(170),
  isConflict: false,
  isSkip: true,
  isOverlap: false,
  canDelete: false,
  canUnlockSkip: true,
  canUnlockOverlap: false,
  durationMinutes: 30,
}

const syntheticOverlapReserve: SyntheticReserve = {
  id: 105,
  reserveId: 105,
  programId: null,
  ruleId: null,
  isManual: true,
  name: 'Synthetic Overlap Reserve',
  channelId: 305,
  channelName: 'Synthetic Channel E',
  startAt: minutesFromBase(180),
  endAt: minutesFromBase(225),
  isConflict: false,
  isSkip: false,
  isOverlap: true,
  canDelete: false,
  canUnlockSkip: false,
  canUnlockOverlap: true,
  durationMinutes: 45,
}

export const reservesMixedList: readonly SyntheticReserve[] = [
  reserveDialogFull,
  reserveDeleteTarget,
  syntheticConflictReserve,
  syntheticSkipReserve,
  syntheticOverlapReserve,
  ...Array.from({ length: 8 }, (_, index): SyntheticReserve => {
    const id = 200 + index
    const durationMinutes = 30

    return {
      id,
      reserveId: id,
      programId: index % 2 === 0 ? 9200 + index : null,
      ruleId: index % 2 === 0 ? 6200 + index : null,
      isManual: index % 2 !== 0,
      name: `Synthetic Reserve ${index + 1}`,
      channelId: 330 + index,
      channelName: `Synthetic Channel ${index + 1}`,
      startAt: minutesFromBase(240 + index * 40),
      endAt: minutesFromBase(240 + index * 40 + durationMinutes),
      description: `Synthetic reserve row ${index + 1}`,
      isConflict: false,
      isSkip: false,
      isOverlap: false,
      canDelete: true,
      canUnlockSkip: false,
      canUnlockOverlap: false,
      durationMinutes,
    }
  }),
] as const

export const reservesStateFilters = [
  {
    routeType: 'normal',
    expectedFilterType: 'normal',
    reserves: reservesMixedList.filter(
      (reserve) =>
        reserve.isConflict !== true && reserve.isSkip !== true && reserve.isOverlap !== true,
    ),
  },
  {
    routeType: 'conflict',
    expectedFilterType: 'conflict',
    reserves: reservesMixedList.filter((reserve) => reserve.isConflict === true),
  },
  {
    routeType: 'skip',
    expectedFilterType: 'skip',
    reserves: reservesMixedList.filter((reserve) => reserve.isSkip === true),
  },
  {
    routeType: 'overlap',
    expectedFilterType: 'overlap',
    reserves: reservesMixedList.filter((reserve) => reserve.isOverlap === true),
  },
] as const
