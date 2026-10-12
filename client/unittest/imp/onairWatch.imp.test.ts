import { describe, expect, it } from 'vitest'
import {
  adaptOnAirReserveIndexForProgramDialog,
  calculateOnAirProgress,
  clampOnAirProgress,
  MAX_UPDATE_DELAY_MS,
  resolveOnAirUpdateDelay,
  resolveWatchInfoDisplay,
  resolveWatchInfoUpdateDelay,
  writeReserveIndex,
  type OnAirReserveIndex,
  type OnAirTimerSchedule,
} from '@/features/onair/onairRequests'

describe('onairWatch pure helpers', () => {
  it('resolveWatchInfoDisplay returns null when no matching item is found or its endAt is missing', () => {
    expect(resolveWatchInfoDisplay({ items: [], channelId: 1, mode: 0 })).toBeNull()
    expect(
      resolveWatchInfoDisplay({
        items: [{ channelId: 1, mode: 0 }],
        channelId: 1,
        mode: 0,
      }),
    ).toBeNull()
  })

  it('resolveWatchInfoDisplay falls back to the raw channelId and empty name/description', () => {
    expect(
      resolveWatchInfoDisplay({
        items: [{ channelId: 1, mode: 0, endAt: 2000, startAt: 1000 }],
        channelId: 1,
        mode: 0,
      }),
    ).toStrictEqual({
      channelName: '1',
      time: expect.any(String),
      name: '',
      description: '',
      endAt: 2000,
    })
  })

  it('resolveWatchInfoDisplay prefers the explicit channelName argument, then the item channelName', () => {
    const items = [{ channelId: 1, mode: 0, endAt: 2000, channelName: 'Item Channel' }]

    expect(
      resolveWatchInfoDisplay({ items, channelId: 1, mode: 0, channelName: 'Explicit' })
        ?.channelName,
    ).toBe('Explicit')
    expect(resolveWatchInfoDisplay({ items, channelId: 1, mode: 0 })?.channelName).toBe(
      'Item Channel',
    )
  })

  it('resolveWatchInfoUpdateDelay defaults to 1000ms when there is no item or the delay is non-positive', () => {
    expect(resolveWatchInfoUpdateDelay({ item: undefined, now: 0 })).toBe(1000)
    expect(resolveWatchInfoUpdateDelay({ item: { endAt: 500 }, now: 1000 })).toBe(1000)
    expect(resolveWatchInfoUpdateDelay({ item: { endAt: 1000 }, now: 1000 })).toBe(1000)
  })

  it('resolveWatchInfoUpdateDelay returns the remaining time when it is positive', () => {
    expect(resolveWatchInfoUpdateDelay({ item: { endAt: 5000 }, now: 1000 })).toBe(4000)
  })

  it('writeReserveIndex skips reserve items without a programId', () => {
    const index: OnAirReserveIndex = {}
    writeReserveIndex(index, 'reserve', [{ reserveId: 1 }])

    expect(index).toStrictEqual({})
  })

  it('writeReserveIndex indexes reserve items that do have a programId', () => {
    const index: OnAirReserveIndex = {}
    writeReserveIndex(index, 'skip', [{ reserveId: 1, programId: 10 }])

    expect(index).toStrictEqual({ 10: { type: 'skip', item: { reserveId: 1, programId: 10 } } })
  })

  it('adaptOnAirReserveIndexForProgramDialog omits programId and ruleId from the Guide item when absent', () => {
    const index: OnAirReserveIndex = {
      10: { type: 'reserve', item: { reserveId: 1 } },
    }

    expect(adaptOnAirReserveIndexForProgramDialog(index)).toStrictEqual({
      10: { type: 'reserve', item: { id: 1 } },
    })
  })

  it('adaptOnAirReserveIndexForProgramDialog carries programId and ruleId when present', () => {
    const index: OnAirReserveIndex = {
      10: { type: 'conflict', item: { reserveId: 1, programId: 10, ruleId: 5 } },
    }

    expect(adaptOnAirReserveIndexForProgramDialog(index)).toStrictEqual({
      10: { type: 'conflict', item: { id: 1, programId: 10, ruleId: 5 } },
    })
  })

  it('resolveOnAirUpdateDelay returns the retry delay when there are no schedules', () => {
    expect(resolveOnAirUpdateDelay([], 0)).toBe(1000)
  })

  it('resolveOnAirUpdateDelay ignores schedules without a first program endAt', () => {
    const schedules: OnAirTimerSchedule[] = [{ programs: [] }, { programs: undefined }]

    expect(resolveOnAirUpdateDelay(schedules, 0)).toBe(MAX_UPDATE_DELAY_MS)
  })

  it('resolveOnAirUpdateDelay returns the minimum non-negative delay across schedules', () => {
    const schedules: OnAirTimerSchedule[] = [
      { programs: [{ endAt: 5000 }] },
      { programs: [{ endAt: 3000 }] },
    ]

    expect(resolveOnAirUpdateDelay(schedules, 1000)).toBe(2000)
  })

  it('clampOnAirProgress falls back to zero for non-finite values and clamps the rest to 0-100', () => {
    expect(clampOnAirProgress(Number.NaN)).toBe(0)
    expect(clampOnAirProgress(Number.POSITIVE_INFINITY)).toBe(0)
    expect(clampOnAirProgress(-10)).toBe(0)
    expect(clampOnAirProgress(150)).toBe(100)
    expect(clampOnAirProgress(42)).toBe(42)
  })

  it('calculateOnAirProgress returns zero when startAt/endAt are missing or endAt does not exceed startAt', () => {
    expect(calculateOnAirProgress({ now: 0 })).toBe(0)
    expect(calculateOnAirProgress({ now: 0, startAt: 1000 })).toBe(0)
    expect(calculateOnAirProgress({ now: 0, endAt: 1000 })).toBe(0)
    expect(calculateOnAirProgress({ now: 0, startAt: 1000, endAt: 1000 })).toBe(0)
    expect(calculateOnAirProgress({ now: 0, startAt: 1000, endAt: 500 })).toBe(0)
  })

  it('calculateOnAirProgress computes the elapsed percentage between startAt and endAt', () => {
    expect(calculateOnAirProgress({ now: 500, startAt: 0, endAt: 1000 })).toBe(50)
  })
})
