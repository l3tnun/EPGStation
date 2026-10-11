import { describe, expect, it } from 'vitest'
import { createGuideGridLayout, formatProgramStartTime } from '@/features/guide/lib/guideGridLayout'

describe('Guide grid Japan-time labels', () => {
  it('labels single-channel day columns with the Japan-time weekday even when UTC is still the previous day', () => {
    // 02:00 JST is 17:00 UTC of the previous day, so a UTC-derived weekday would be off by one.
    const startAt = Date.parse('2026-05-03T02:00:00+09:00')
    const layout = createGuideGridLayout({
      schedules: Array.from({ length: 7 }, (_, index) => ({
        channel: { id: index },
        programs: [],
      })),
      mode: 'singleChannel',
      startAt,
      hours: 24,
    })

    expect(layout.channels.map((channel) => channel.name)).toStrictEqual([
      '05/03(日)',
      '05/04(月)',
      '05/05(火)',
      '05/06(水)',
      '05/07(木)',
      '05/08(金)',
      '05/09(土)',
    ])
    expect(layout.channels.map((channel) => channel.id)).toStrictEqual([0, 1, 2, 3, 4, 5, 6])
  })

  it('advances the day header by one day per column across a month boundary', () => {
    const startAt = Date.parse('2026-04-29T12:00:00+09:00')
    const layout = createGuideGridLayout({
      schedules: [{ programs: [] }, { programs: [] }, { programs: [] }],
      mode: 'singleChannel',
      startAt,
      hours: 24,
    })

    expect(layout.channels.map((channel) => channel.name)).toStrictEqual([
      '04/29(水)',
      '04/30(木)',
      '05/01(金)',
    ])
  })

  it('formats a program start time as zero-padded Japan-time hours and minutes', () => {
    expect(formatProgramStartTime(Date.parse('2026-05-05T09:05:00+09:00'))).toBe('09:05')
    expect(formatProgramStartTime(Date.parse('2026-05-05T00:00:00+09:00'))).toBe('00:00')
    expect(formatProgramStartTime(Date.parse('2026-05-05T23:59:00+09:00'))).toBe('23:59')
  })
})
