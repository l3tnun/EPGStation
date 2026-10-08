import { describe, expect, it } from 'vitest'
import {
  buildManualProgramDetailRequestUrl,
  buildManualReserveAddPayload,
  buildManualReserveDetailRequestUrl,
  buildManualReserveEditPayload,
  canSaveManualReserveAdd,
  manualTimeSpecifiedOptionSchema,
  parseManualReserveMode,
  resolveManualReservePageInfoForRoute,
  shouldSaveManualReservePageInfo,
} from '@/features/reserves/reservesRequests'

describe('Manual Reserve implementation edges', () => {
  const timeSpecifiedOption = {
    name: 'Synthetic manual reserve',
    channelId: 301,
    startAt: Date.parse('2026-05-05T10:15:00+09:00'),
    endAt: Date.parse('2026-05-05T10:45:00+09:00'),
  }

  it('parses Manual Reserve mode with reserveId precedence over programId', () => {
    expect(parseManualReserveMode('?reserveId=11&programId=22')).toStrictEqual({
      kind: 'edit',
      reserveId: 11,
    })
    expect(parseManualReserveMode('?programId=22')).toStrictEqual({
      kind: 'program',
      programId: 22,
    })
    expect(parseManualReserveMode('')).toStrictEqual({ kind: 'add' })
    expect(parseManualReserveMode('?reserveId=-1&programId=22')).toStrictEqual({
      kind: 'program',
      programId: 22,
    })
    expect(parseManualReserveMode('?reserveId=abc&programId=def')).toStrictEqual({ kind: 'add' })
  })

  it('builds Manual Reserve fetch URLs with isHalfWidth and a single base path join', () => {
    expect(
      buildManualReserveDetailRequestUrl({
        reserveId: 11,
        isHalfWidth: false,
        basePath: '/api/',
      }),
    ).toBe('/api/reserves/11?isHalfWidth=false')
    expect(
      buildManualProgramDetailRequestUrl({
        programId: 22,
        isHalfWidth: true,
        basePath: '/api',
      }),
    ).toBe('/api/schedules/detail/22?isHalfWidth=true')
  })

  it('builds add payloads for program and time-specified modes and rejects no-query off mode', () => {
    expect(
      canSaveManualReserveAdd({
        mode: { kind: 'add' },
        isTimeSpecification: false,
        timeSpecifiedOption,
      }),
    ).toBe(false)
    expect(
      buildManualReserveAddPayload({
        mode: { kind: 'program', programId: 22 },
        isTimeSpecification: false,
        timeSpecifiedOption,
        reserveOption: { allowEndLack: true },
        saveOption: undefined,
        encodeOption: {
          mode1: null,
          mode2: null,
          mode3: null,
          isDeleteOriginalAfterEncode: true,
        },
      }),
    ).toStrictEqual({
      ok: true,
      value: {
        allowEndLack: true,
        programId: 22,
      },
    })
    expect(
      buildManualReserveAddPayload({
        mode: { kind: 'add' },
        isTimeSpecification: true,
        timeSpecifiedOption,
        reserveOption: { allowEndLack: false },
        saveOption: {},
        encodeOption: {
          mode1: 'h264',
          encodeParentDirectoryName1: 'parent',
          directory1: 'encoded',
          mode2: null,
          mode3: null,
          isDeleteOriginalAfterEncode: true,
        },
      }),
    ).toStrictEqual({
      ok: true,
      value: {
        allowEndLack: false,
        timeSpecifiedOption,
        saveOption: {},
        encodeOption: {
          mode1: 'h264',
          encodeParentDirectoryName1: 'parent',
          directory1: 'encoded',
          isDeleteOriginalAfterEncode: true,
        },
      },
    })
  })

  it('rejects invalid time-specified payloads at the Zod validation boundary', () => {
    expect(
      manualTimeSpecifiedOptionSchema.safeParse({
        name: '   ',
        channelId: 301,
        startAt: Date.parse('2026-05-05T10:15:00+09:00'),
        endAt: Date.parse('2026-05-05T10:45:00+09:00'),
      }).success,
    ).toBe(false)
    expect(
      manualTimeSpecifiedOptionSchema.safeParse({
        name: 'Synthetic manual reserve',
        channelId: -1,
        startAt: Date.parse('2026-05-05T10:15:00+09:00'),
        endAt: Date.parse('2026-05-05T10:45:00+09:00'),
      }).success,
    ).toBe(false)
    expect(
      manualTimeSpecifiedOptionSchema.safeParse({
        name: 'Synthetic manual reserve',
        channelId: 301,
        startAt: Date.parse('2026-05-05T10:45:00+09:00'),
        endAt: Date.parse('2026-05-05T10:15:00+09:00'),
      }).success,
    ).toBe(false)
    expect(
      buildManualReserveAddPayload({
        mode: { kind: 'add' },
        isTimeSpecification: true,
        timeSpecifiedOption: {
          name: '   ',
          channelId: -1,
          startAt: Date.parse('2026-05-05T10:45:00+09:00'),
          endAt: Date.parse('2026-05-05T10:15:00+09:00'),
        },
        reserveOption: { allowEndLack: true },
        saveOption: undefined,
        encodeOption: undefined,
      }),
    ).toStrictEqual({
      ok: false,
      error: 'manual-reserve-invalid',
      message: '予約の追加に失敗しました。',
    })
  })

  it('builds edit payloads without target fields and with only non-null option fields', () => {
    expect(
      buildManualReserveEditPayload({
        reserveOption: { allowEndLack: true },
        saveOption: {},
        encodeOption: {
          mode1: null,
          mode2: 'aac',
          encodeParentDirectoryName2: 'parent',
          directory2: null,
          mode3: null,
          isDeleteOriginalAfterEncode: false,
        },
      }),
    ).toStrictEqual({
      allowEndLack: true,
      saveOption: {},
      encodeOption: {
        mode2: 'aac',
        encodeParentDirectoryName2: 'parent',
        isDeleteOriginalAfterEncode: false,
      },
    })
  })

  it('restores Manual Reserve PageInfo only for program add mode with history state', () => {
    const pageInfo = {
      isTimeSpecification: true,
      timeSpecifiedOption,
      reserveOption: { allowEndLack: false },
      saveOption: {},
      encodeOption: { mode1: null, mode2: null, mode3: null, isDeleteOriginalAfterEncode: false },
    }

    expect(
      resolveManualReservePageInfoForRoute({
        mode: { kind: 'program', programId: 22 },
        shouldRestoreHistory: true,
        pageInfo,
      }),
    ).toStrictEqual(pageInfo)
    expect(
      resolveManualReservePageInfoForRoute({
        mode: { kind: 'add' },
        shouldRestoreHistory: true,
        pageInfo,
      }),
    ).toBeNull()
    expect(
      resolveManualReservePageInfoForRoute({
        mode: { kind: 'edit', reserveId: 11 },
        shouldRestoreHistory: true,
        pageInfo,
      }),
    ).toBeNull()
    expect(
      resolveManualReservePageInfoForRoute({
        mode: { kind: 'program', programId: 22 },
        shouldRestoreHistory: false,
        pageInfo,
      }),
    ).toBeNull()
  })

  it('[AC 4.6] evaluates canSaveManualReserveAdd against the time-specified schema when time specification is on', () => {
    expect(
      canSaveManualReserveAdd({
        mode: { kind: 'add' },
        isTimeSpecification: true,
        timeSpecifiedOption,
      }),
    ).toBe(true)
    expect(
      canSaveManualReserveAdd({
        mode: { kind: 'add' },
        isTimeSpecification: true,
        timeSpecifiedOption: { name: null, channelId: null, startAt: null, endAt: null },
      }),
    ).toBe(false)
  })

  it('[AC 4.15] omits encodeOption from an edit payload when no encode option is supplied', () => {
    expect(
      buildManualReserveEditPayload({
        reserveOption: { allowEndLack: true },
        saveOption: undefined,
        encodeOption: undefined,
      }),
    ).toStrictEqual({ allowEndLack: true })
  })

  it('saves Manual Reserve PageInfo only while leaving add mode routes', () => {
    expect(shouldSaveManualReservePageInfo({ mode: { kind: 'add' } })).toBe(true)
    expect(shouldSaveManualReservePageInfo({ mode: { kind: 'program', programId: 22 } })).toBe(true)
    expect(shouldSaveManualReservePageInfo({ mode: { kind: 'edit', reserveId: 11 } })).toBe(false)
  })
})
