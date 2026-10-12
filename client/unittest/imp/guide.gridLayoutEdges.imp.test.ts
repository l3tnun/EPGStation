import { describe, expect, it, vi } from 'vitest'
import {
  createGuideGridLayout,
  createProgramCellClassList,
  firstGenre,
} from '@/features/guide/lib/guideGridLayout'
import { WEEKDAYS } from '@/features/guide/lib/guideGridTypes'

describe('firstGenre', () => {
  it('[AC 2.16] falls back to genre3 when genre1 and genre2 are absent', () => {
    expect(firstGenre({ genre3: 9 })).toBe(9)
  })
})

describe('createGuideGridLayout malformed-program and missing-channel handling', () => {
  const startAt = Date.parse('2026-05-05T00:00:00+09:00')

  it('skips a program missing a finite id/startAt/endAt instead of rendering it', () => {
    const layout = createGuideGridLayout({
      schedules: [
        {
          channel: { type: 0x01 },
          programs: [{ name: 'no id or times' }, { id: 1, startAt, endAt: startAt + 1_000 }],
        },
      ],
      mode: 'normal',
      startAt,
      hours: 1,
    })

    expect(layout.programs.map((program) => program.program.id)).toStrictEqual([1])
  })

  it('defaults a program and normal-mode channel to an empty object when schedule.channel is absent', () => {
    const layout = createGuideGridLayout({
      schedules: [
        {
          programs: [{ id: 1, startAt, endAt: startAt + 60_000 }],
        },
      ],
      mode: 'normal',
      startAt,
      hours: 1,
    })

    expect(layout.channels).toStrictEqual([{}])
    expect(layout.programs[0]?.channel).toStrictEqual({})
  })

  it('falls back to default month/day and UTC weekday when Intl.DateTimeFormat omits expected parts', () => {
    const spy = vi.spyOn(Intl.DateTimeFormat.prototype, 'formatToParts').mockReturnValue([
      { type: 'hour', value: '09' },
      { type: 'minute', value: '15' },
      { type: 'weekday', value: 'Unknown' },
    ] as unknown as Intl.DateTimeFormatPart[])

    try {
      const layout = createGuideGridLayout({
        schedules: [{ channel: { type: 0x01 }, programs: [] }],
        mode: 'singleChannel',
        startAt,
        hours: 1,
      })
      const expectedWeekday = WEEKDAYS[new Date(startAt).getUTCDay()]

      expect(layout.channels[0]?.name).toBe(`00/00(${expectedWeekday})`)
    } finally {
      spy.mockRestore()
    }
  })
})

describe('createProgramCellClassList without a numeric program id', () => {
  it('does not look up a reserve state when the program has no numeric id', () => {
    expect(
      createProgramCellClassList({
        program: { name: 'no id' },
        reserveIndex: {},
        genreVisibility: {},
        hidden: false,
      }),
    ).toStrictEqual(['guide-program-cell', 'ctg-empty'])
  })
})
