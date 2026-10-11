import { describe, expect, it } from 'vitest'
import { createReserveIndexRequest, programMeta } from '@/features/search/rule/lib/programDisplay'
import { ruleIgnoreKeyword } from '@/features/search/rule/lib/ruleListText'

describe('programMeta output', () => {
  it('formats the local date, weekday, time range and duration in minutes', () => {
    const start = new Date(2026, 0, 4, 9, 5).getTime()
    const end = new Date(2026, 0, 4, 10, 7).getTime()

    expect(programMeta({ id: 1, startAt: start, endAt: end })).toBe(
      '01/04(日) 09:05 ~ 10:07 (62分)',
    )
    expect(programMeta({ id: 1, channelName: 'Ch', startAt: start, endAt: end })).toBe(
      'Ch\n01/04(日) 09:05 ~ 10:07 (62分)',
    )
  })

  it.each([
    [4, '日'],
    [5, '月'],
    [6, '火'],
    [7, '水'],
    [8, '木'],
    [9, '金'],
    [10, '土'],
  ])('labels January %i 2026 with %s', (day, weekday) => {
    const start = new Date(2026, 0, day, 12, 0).getTime()

    expect(programMeta({ id: 1, startAt: start, endAt: start + 60000 })).toBe(
      `01/${String(day).padStart(2, '0')}(${weekday}) 12:00 ~ 12:01 (1分)`,
    )
  })

  it('rounds the duration to the nearest minute and never reports a negative duration', () => {
    const start = new Date(2026, 5, 15, 8, 0).getTime()

    expect(programMeta({ id: 1, startAt: start, endAt: start + 90_000 })).toContain('(2分)')
    expect(programMeta({ id: 1, startAt: start, endAt: start + 89_000 })).toContain('(1分)')
    expect(programMeta({ id: 1, startAt: start + 600_000, endAt: start })).toContain('(0分)')
  })

  it('returns only the channel (or an empty string) unless both timestamps exist', () => {
    expect(programMeta({ id: 1, channelName: 'Ch', startAt: 0 })).toBe('Ch')
    expect(programMeta({ id: 1, channelName: 'Ch', endAt: 60000 })).toBe('Ch')
    expect(programMeta({ id: 1, startAt: 0 })).toBe('')
    expect(programMeta({ id: 1, endAt: 60000 })).toBe('')
  })
})

describe('createReserveIndexRequest ranges', () => {
  it('ignores programs missing a timestamp when finding the earliest start and latest end', () => {
    expect(createReserveIndexRequest([{ id: 1 }, { id: 2, startAt: 5, endAt: 9 }])).toStrictEqual({
      startAt: 5,
      endAt: 9,
    })
    expect(
      createReserveIndexRequest([
        { id: 1, startAt: 5 },
        { id: 2, endAt: 9 },
      ]),
    ).toStrictEqual({ startAt: 5, endAt: 9 })
  })

  it('returns null when no program has a start or no program has an end', () => {
    expect(createReserveIndexRequest([{ id: 1, startAt: 5 }])).toBeNull()
    expect(createReserveIndexRequest([{ id: 1, endAt: 9 }])).toBeNull()
  })
})

describe('ruleIgnoreKeyword fallback', () => {
  it('shows a dash when no ignore keyword is set', () => {
    expect(
      ruleIgnoreKeyword({
        id: 1,
        searchOption: { times: [] },
        reserveOption: {
          enable: true,
          allowEndLack: true,
          avoidDuplicate: false,
          periodToAvoidDuplicate: null,
        },
      }),
    ).toBe('-')
  })
})
