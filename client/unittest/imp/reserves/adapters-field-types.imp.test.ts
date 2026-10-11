import { describe, expect, it } from 'vitest'
import {
  adaptChannelIndex,
  adaptReserveItem,
  hydrateReserveChannelNames,
  isNonNegativeSafeInteger,
  isRecord,
  isSafeInteger,
  isValidDateTimestamp,
} from '@/features/reserves/lib/reserveAdapters'
import {
  adaptManualAddResponse,
  adaptManualProgramDetail,
  adaptReservesResponse,
  isManualUpdateResponse,
} from '@/features/reserves/lib/manualReserveAdapters'
import {
  EMPTY_SERVER_OPTIONS,
  adaptManualChannelOptions,
} from '@/features/reserves/lib/manualReserveServerOptions'

const MAX_TIMESTAMP = 8_640_000_000_000_000

describe('reserve adapter guards', () => {
  it('recognises objects, safe integers, non-negative integers and valid timestamps', () => {
    expect(isRecord(null)).toBe(false)
    expect(isRecord('x')).toBe(false)
    expect(isRecord({})).toBe(true)
    expect(isSafeInteger('1')).toBe(false)
    expect(isSafeInteger(1.5)).toBe(false)
    expect(isSafeInteger(-1)).toBe(true)
    expect(isNonNegativeSafeInteger(0)).toBe(true)
    expect(isNonNegativeSafeInteger(-1)).toBe(false)
    expect(isValidDateTimestamp(MAX_TIMESTAMP)).toBe(true)
    expect(isValidDateTimestamp(-MAX_TIMESTAMP)).toBe(true)
    expect(isValidDateTimestamp(MAX_TIMESTAMP + 1)).toBe(false)
    expect(isValidDateTimestamp(-MAX_TIMESTAMP - 1)).toBe(false)
    expect(isValidDateTimestamp('1')).toBe(false)
  })
})

describe('reserve item adapter', () => {
  it('keeps every field of a fully valid reserve', () => {
    const item = {
      id: 1,
      programId: 0,
      name: 'n',
      channelId: 2,
      channelName: 'c',
      channelType: 'GR',
      startAt: 1_000,
      endAt: 2_000,
      description: 'd',
      extended: 'e',
      ruleId: 3,
      genre1: 4,
      subGenre1: 5,
      genre2: 6,
      subGenre2: 0,
      genre3: 8,
      subGenre3: 9,
      isConflict: true,
      isSkip: false,
      isOverlap: true,
      isTimeSpecified: false,
      allowEndLack: true,
      parentDirectoryName: 'p',
      directory: 'd',
      recordedFormat: 'f',
      encodeMode1: 'm1',
      encodeParentDirectoryName1: 'p1',
      encodeDirectory1: 'd1',
      encodeMode2: 'm2',
      encodeParentDirectoryName2: 'p2',
      encodeDirectory2: 'd2',
      encodeMode3: 'm3',
      encodeParentDirectoryName3: 'p3',
      encodeDirectory3: 'd3',
      isDeleteOriginalAfterEncode: true,
      genres: ['g'],
    }

    expect(adaptReserveItem(item)).toStrictEqual(item)
  })

  it('drops every field whose type is wrong', () => {
    const wrong = {
      id: 1,
      programId: -1,
      name: 1,
      channelId: -1,
      channelName: 1,
      channelType: 'XX',
      startAt: 'x',
      endAt: 'x',
      description: 1,
      extended: 1,
      ruleId: -1,
      genre1: -1,
      subGenre1: 'x',
      genre2: 1.5,
      subGenre2: -1,
      genre3: 'x',
      subGenre3: -1,
      isConflict: 'x',
      isSkip: 'x',
      isOverlap: 'x',
      isTimeSpecified: 'x',
      allowEndLack: 'x',
      parentDirectoryName: 1,
      directory: 1,
      recordedFormat: 1,
      encodeMode1: 1,
      encodeParentDirectoryName1: 1,
      encodeDirectory1: 1,
      encodeMode2: 1,
      encodeParentDirectoryName2: 1,
      encodeDirectory2: 1,
      encodeMode3: 1,
      encodeParentDirectoryName3: 1,
      encodeDirectory3: 1,
      isDeleteOriginalAfterEncode: 'x',
      genres: 'x',
    }

    expect(adaptReserveItem(wrong)).toStrictEqual({ id: 1 })
  })

  it('rejects a value that is not an object or has no integer id, and accepts reserveId as the id', () => {
    expect(adaptReserveItem(null)).toBeNull()
    expect(adaptReserveItem({ id: 'x' })).toBeNull()
    expect(adaptReserveItem({ id: 'x', reserveId: 'y' })).toBeNull()
    expect(adaptReserveItem({ reserveId: 7 })).toStrictEqual({ id: 7 })
  })

  it('drops an end time earlier than the start time and keeps an equal one', () => {
    expect(adaptReserveItem({ id: 1, startAt: 2_000, endAt: 1_000 })).toStrictEqual({
      id: 1,
      startAt: 2_000,
    })
    expect(adaptReserveItem({ id: 1, startAt: 2_000, endAt: 2_000 })).toStrictEqual({
      id: 1,
      startAt: 2_000,
      endAt: 2_000,
    })
    expect(adaptReserveItem({ id: 1, endAt: 1_000 })).toStrictEqual({ id: 1, endAt: 1_000 })
    expect(adaptReserveItem({ id: 1, startAt: 2_000 })).toStrictEqual({ id: 1, startAt: 2_000 })
  })

  it('builds genre labels only when no usable genres array is given', () => {
    expect(adaptReserveItem({ id: 1, genres: [], genre1: 1, subGenre1: 2 })?.genres).toStrictEqual([
      'genre 1/2',
    ])
    expect(adaptReserveItem({ id: 1, genres: ['A'], genre1: 1 })?.genres).toStrictEqual(['A'])
    expect(
      adaptReserveItem({ id: 1, genre1: 1, genre2: 2, subGenre2: 3, genre3: 4 })?.genres,
    ).toStrictEqual(['genre 1', 'genre 2/3', 'genre 4'])
    expect(adaptReserveItem({ id: 1 })).toStrictEqual({ id: 1 })
  })
})

describe('reserve channel names', () => {
  it('prefers the half-width name, ignores non-string names and keeps a given name', () => {
    expect(
      adaptChannelIndex([
        null,
        { id: -1, name: 'negative' },
        { id: 1, name: 'Full', halfWidthName: 'Half' },
        { id: 2, name: 5 },
        { id: 3, name: 'OnlyFull' },
      ]),
    ).toStrictEqual(
      new Map([
        [1, 'Half'],
        [3, 'OnlyFull'],
      ]),
    )

    const given = { id: 1, channelId: 1, channelName: 'Given' }
    const unknown = { id: 2, channelId: 9 }
    const noChannel = { id: 3 }

    expect(
      hydrateReserveChannelNames(
        { reserves: [given, unknown, noChannel, { id: 4, channelId: 1 }], total: 4 },
        new Map([[1, 'Indexed']]),
      ).reserves,
    ).toStrictEqual([given, unknown, noChannel, { id: 4, channelId: 1, channelName: 'Indexed' }])
  })
})

describe('manual reserve adapters', () => {
  const program = { id: 1, name: 'n', channelId: 2, startAt: 1_000, endAt: 2_000 }

  it('requires every mandatory field of a manual program and an end not before the start', () => {
    expect(adaptManualProgramDetail(program)).toStrictEqual(program)
    expect(adaptManualProgramDetail({ ...program, endAt: 1_000 })).toStrictEqual({
      ...program,
      endAt: 1_000,
    })
    expect(adaptManualProgramDetail(null)).toBeNull()
    for (const bad of [
      { id: -1 },
      { id: 'x' },
      { name: 1 },
      { channelId: -1 },
      { startAt: 'x' },
      { endAt: 'x' },
      { endAt: 999 },
    ]) {
      expect(adaptManualProgramDetail({ ...program, ...bad })).toBeNull()
    }
  })

  it('accepts a zero total and rejects a negative one', () => {
    expect(adaptReservesResponse({ reserves: [], total: 0 })).toStrictEqual({
      reserves: [],
      total: 0,
    })
    expect(adaptReservesResponse({ reserves: [], total: -1 })).toBeNull()
    expect(adaptReservesResponse({ reserves: [{ id: 1 }, 'x'], total: 2 })).toBeNull()
    expect(adaptReservesResponse({ reserves: 'x', total: 0 })).toBeNull()
    expect(adaptReservesResponse(null)).toBeNull()
  })

  it('reads the created reserve id and recognises only the success update response', () => {
    expect(adaptManualAddResponse({ reserveId: 3 })).toStrictEqual({ reserveId: 3 })
    expect(adaptManualAddResponse({ reserveId: -1 })).toBeNull()
    expect(isManualUpdateResponse({ code: 201, message: 'ok' })).toBe(true)
    expect(isManualUpdateResponse({ code: 201, message: 'ng' })).toBe(false)
    expect(isManualUpdateResponse({ code: 200, message: 'ok' })).toBe(false)
    expect(isManualUpdateResponse(null)).toBe(false)
  })
})

describe('manual server options', () => {
  it('starts empty', () => {
    expect(EMPTY_SERVER_OPTIONS).toStrictEqual({ channels: [], directories: [], encodeModes: [] })
  })

  it('keeps only usable channels and prefers the half-width name', () => {
    expect(
      adaptManualChannelOptions([
        null,
        'x',
        { id: 'x', name: 'string id' },
        { id: 1, type: 2, name: 'other type' },
        { id: 2, type: 1, name: 'Full', halfWidthName: 'Half' },
        { id: 3, name: 'OnlyFull' },
        { id: 4, name: 5 },
        { id: 5 },
      ]),
    ).toStrictEqual([
      { id: 2, name: 'Half' },
      { id: 3, name: 'OnlyFull' },
    ])
  })
})
