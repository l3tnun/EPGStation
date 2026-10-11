import { describe, expect, it } from 'vitest'
import {
  calculateOnAirProgress,
  resolveWatchInfoDisplay,
  transformOnAirReserveListsToIndex,
} from '@/features/onair/lib/onairWatch'

describe('onairWatch reserve index and progress', () => {
  it('transformOnAirReserveListsToIndex tags each list with its visual state', () => {
    const index = transformOnAirReserveListsToIndex({
      normal: [{ reserveId: 1, programId: 10 }],
      conflicts: [{ reserveId: 2, programId: 20 }],
      skips: [{ reserveId: 3, programId: 30 }],
      overlaps: [{ reserveId: 4, programId: 40 }],
    })
    expect(index[10]?.type).toBe('reserve')
    expect(index[20]?.type).toBe('conflict')
    expect(index[30]?.type).toBe('skip')
    expect(index[40]?.type).toBe('overlap')
  })

  it('resolveWatchInfoDisplay requires both the channel and the mode to match', () => {
    const items = [
      { channelId: 1, mode: 0, endAt: 100, name: 'wrong channel' },
      { channelId: 2, mode: 1, endAt: 200, name: 'wrong mode' },
      { channelId: 2, mode: 0, endAt: 300, name: 'right' },
    ]
    expect(resolveWatchInfoDisplay({ items, channelId: 2, mode: 0 })?.name).toBe('right')
    expect(resolveWatchInfoDisplay({ items, channelId: 3, mode: 0 })).toBeNull()
    expect(resolveWatchInfoDisplay({ items, channelId: 1, mode: 1 })).toBeNull()
  })

  it('calculateOnAirProgress is 0 for missing or non-increasing ranges and proportional otherwise', () => {
    expect(calculateOnAirProgress({ now: 50, endAt: 100 })).toBe(0)
    expect(calculateOnAirProgress({ now: 50, startAt: 0 })).toBe(0)
    expect(calculateOnAirProgress({ now: 50, startAt: 100, endAt: 100 })).toBe(0)
    // reversed range: now lies between the two values and would give 50 if not rejected
    expect(calculateOnAirProgress({ now: 75, startAt: 100, endAt: 50 })).toBe(0)
    expect(calculateOnAirProgress({ now: 25, startAt: 0, endAt: 100 })).toBe(25)
  })
})
