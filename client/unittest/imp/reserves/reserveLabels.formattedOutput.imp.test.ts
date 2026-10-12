import { describe, expect, it, vi } from 'vitest'
import {
  formatReserveDate,
  formatReserveDialogTimeRange,
  formatReserveTableTimeParts,
  reserveGenreLabels,
  resolveDialogBroadcastWave,
} from '@/features/reserves/lib/reserveLabels'

const START = Date.parse('2026-05-05T10:15:00+09:00')
const END = Date.parse('2026-05-05T10:45:00+09:00')

describe('reserveLabels genre selection', () => {
  it('keeps explicit genres only when they are non-empty and not all placeholder "genre N" labels', () => {
    expect(
      reserveGenreLabels({ id: 1, genres: ['Synthetic genre'], genre1: 0, subGenre1: 0 }),
    ).toStrictEqual(['Synthetic genre'])
    expect(reserveGenreLabels({ id: 1, genres: ['genre 1', 'Synthetic genre'] })).toStrictEqual([
      'genre 1',
      'Synthetic genre',
    ])
    expect(reserveGenreLabels({ id: 1, genres: ['prefix genre 1'] })).toStrictEqual([
      'prefix genre 1',
    ])
    expect(reserveGenreLabels({ id: 1, genres: ['genre x'] })).toStrictEqual(['genre x'])
  })

  it('falls back to the legacy genre fields when genres is empty or only placeholders', () => {
    expect(reserveGenreLabels({ id: 1, genres: [], genre1: 0, subGenre1: 0 })).toStrictEqual([
      'ニュース・報道 / 定時・総合',
    ])
    expect(
      reserveGenreLabels({ id: 1, genres: ['genre 1', 'genre 22'], genre1: 7, subGenre1: 2 }),
    ).toStrictEqual(['アニメ・特撮 / 特撮'])
    expect(reserveGenreLabels({ id: 1, genres: ['genre 1'] })).toStrictEqual([])
  })
})

describe('reserveLabels date and time output', () => {
  it('formats the reserve date with zero padding and the Japanese weekday', () => {
    expect(formatReserveDate(START)).toBe('05/05(火)')
    expect(formatReserveDate(Date.parse('2026-01-04T00:30:00+09:00'))).toBe('01/04(日)')
  })

  it('formats the table time parts as a range and a floored duration in minutes', () => {
    expect(formatReserveTableTimeParts({ id: 1, startAt: START, endAt: END })).toStrictEqual({
      range: '10:15~10:45',
      duration: '(30m)',
    })
    expect(
      formatReserveTableTimeParts({ id: 1, startAt: START, endAt: START + 119_999 }),
    ).toStrictEqual({ range: '10:15~10:16', duration: '(1m)' })
  })

  it('returns null from the table time parts unless both timestamps exist', () => {
    expect(formatReserveTableTimeParts({ id: 1, startAt: START })).toBeNull()
    expect(formatReserveTableTimeParts({ id: 1, endAt: END })).toBeNull()
    expect(formatReserveTableTimeParts({ id: 1 })).toBeNull()
  })

  it('formats the dialog time range with the date, range and minute duration', () => {
    expect(formatReserveDialogTimeRange({ id: 1, startAt: START, endAt: END })).toBe(
      '05/05(火) 10:15 ~ 10:45 (30m)',
    )
    expect(formatReserveDialogTimeRange({ id: 1, startAt: START, endAt: START + 119_999 })).toBe(
      '05/05(火) 10:15 ~ 10:16 (1m)',
    )
  })

  it('returns an empty dialog time range unless both timestamps exist', () => {
    expect(formatReserveDialogTimeRange({ id: 1, startAt: START })).toBe('')
    expect(formatReserveDialogTimeRange({ id: 1, endAt: END })).toBe('')
  })
})

describe('resolveDialogBroadcastWave', () => {
  it('resolves the broadcast wave for the reserve channel when every precondition holds', () => {
    const resolver = vi.fn(() => 'GR' as never)

    expect(
      resolveDialogBroadcastWave({
        isEnableDisplayForEachBroadcastWave: true,
        reserve: { id: 1, channelId: 3 },
        resolveBroadcastWave: resolver,
      }),
    ).toBe('GR')
    expect(resolver).toHaveBeenCalledTimes(1)
    expect(resolver).toHaveBeenCalledWith(3)
  })

  it('returns undefined without calling the resolver when a precondition is missing', () => {
    const resolver = vi.fn(() => 'GR' as never)

    expect(
      resolveDialogBroadcastWave({
        isEnableDisplayForEachBroadcastWave: false,
        reserve: { id: 1, channelId: 3 },
        resolveBroadcastWave: resolver,
      }),
    ).toBeUndefined()
    expect(
      resolveDialogBroadcastWave({
        isEnableDisplayForEachBroadcastWave: true,
        reserve: { id: 1 },
        resolveBroadcastWave: resolver,
      }),
    ).toBeUndefined()
    expect(
      resolveDialogBroadcastWave({
        isEnableDisplayForEachBroadcastWave: true,
        reserve: { id: 1, channelId: 3 },
      }),
    ).toBeUndefined()
    expect(resolver).not.toHaveBeenCalled()
  })
})
