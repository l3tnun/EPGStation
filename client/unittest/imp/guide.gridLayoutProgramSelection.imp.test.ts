import { describe, expect, it } from 'vitest'
import type { GuideSchedule } from '@/features/guide/guideApi'
import {
  createGuideGridLayout,
  createProgramCellClassList,
  shouldUpdateGuideVisibility,
} from '@/features/guide/lib/guideGridLayout'

const MINUTE = 60_000
const DAY = 24 * 60 * MINUTE
const base = Date.parse('2026-05-05T00:00:00+09:00')

describe('createGuideGridLayout program selection', () => {
  it('skips every program whose id, startAt, or endAt is not a finite number', () => {
    const programs = [
      { id: Number.NaN, startAt: base, endAt: base + 30 * MINUTE },
      { id: Number.POSITIVE_INFINITY, startAt: base, endAt: base + 30 * MINUTE },
      { id: '4', startAt: base, endAt: base + 30 * MINUTE },
      { id: 1, startAt: Number.NaN, endAt: base + 30 * MINUTE },
      { id: 2, startAt: String(base), endAt: base + 30 * MINUTE },
      { id: 3, startAt: base, endAt: Number.NaN },
      { id: 6, startAt: base, endAt: Number.POSITIVE_INFINITY },
      { id: 5, startAt: base, endAt: base + 30 * MINUTE },
    ] as unknown as GuideSchedule['programs']
    const layout = createGuideGridLayout({
      schedules: [{ channel: { type: 0x01 }, programs }],
      mode: 'normal',
      startAt: base,
      hours: 2,
    })

    expect(layout.programs.map((program) => program.program.id)).toStrictEqual([5])
  })

  it('drops programs that touch the displayed window without overlapping it', () => {
    const layout = createGuideGridLayout({
      schedules: [
        {
          channel: { type: 0x01 },
          programs: [
            { id: 1, startAt: base - 30 * MINUTE, endAt: base },
            { id: 2, startAt: base + 120 * MINUTE, endAt: base + 150 * MINUTE },
            { id: 3, startAt: base, endAt: base + MINUTE },
          ],
        },
      ],
      mode: 'normal',
      startAt: base,
      hours: 2,
    })

    expect(layout.programs.map((program) => program.program.id)).toStrictEqual([3])
    expect(layout.programs[0]).toMatchObject({ topMinutes: 0, heightMinutes: 1 })
  })

  it('shifts each single-channel column to its own day and ignores programs of other days', () => {
    const layout = createGuideGridLayout({
      schedules: [
        {
          channel: { id: 1 },
          programs: [{ id: 1, startAt: base + 60 * MINUTE, endAt: base + 90 * MINUTE }],
        },
        {
          channel: { id: 1 },
          programs: [
            { id: 2, startAt: base + DAY + 120 * MINUTE, endAt: base + DAY + 150 * MINUTE },
            { id: 3, startAt: base + 120 * MINUTE, endAt: base + 150 * MINUTE },
          ],
        },
      ],
      mode: 'singleChannel',
      startAt: base,
      hours: 24,
    })

    expect(layout.programs.map((program) => program.program.id)).toStrictEqual([1, 2])
    expect(layout.programs[0]).toMatchObject({ channelIndex: 0, topMinutes: 60, heightMinutes: 30 })
    expect(layout.programs[1]).toMatchObject({
      channelIndex: 1,
      topMinutes: 120,
      heightMinutes: 30,
    })
  })

  it('uses the same window for every channel column in normal mode', () => {
    const layout = createGuideGridLayout({
      schedules: [
        {
          channel: { id: 1, type: 0x01 },
          programs: [{ id: 1, startAt: base + 60 * MINUTE, endAt: base + 90 * MINUTE }],
        },
        {
          channel: { id: 2, type: 0x01 },
          programs: [{ id: 2, startAt: base + 60 * MINUTE, endAt: base + 90 * MINUTE }],
        },
      ],
      mode: 'normal',
      startAt: base,
      hours: 3,
    })

    expect(
      layout.programs.map((program) => [program.channelIndex, program.topMinutes]),
    ).toStrictEqual([
      [0, 60],
      [1, 60],
    ])
  })

  it('keeps a channel column even when its schedule has no programs list', () => {
    const layout = createGuideGridLayout({
      schedules: [{ channel: { id: 7, type: 0x01 } }],
      mode: 'normal',
      startAt: base,
      hours: 1,
    })

    expect(layout.channels).toStrictEqual([{ id: 7, type: 0x01 }])
    expect(layout.programs).toStrictEqual([])
  })
})

describe('createProgramCellClassList genre and reserve classes', () => {
  const classesFor = (
    program: Parameters<typeof createProgramCellClassList>[0]['program'],
    genreVisibility: Record<number, boolean>,
    reserveIndex: Parameters<typeof createProgramCellClassList>[0]['reserveIndex'] = {},
  ): string[] =>
    createProgramCellClassList({ program, reserveIndex, genreVisibility, hidden: false })

  it('adds hide only for a program whose genre is explicitly switched off', () => {
    expect(classesFor({ id: 1, genre1: 1 }, { 1: false })).toStrictEqual([
      'guide-program-cell',
      'ctg-1',
      'hide',
    ])
    expect(classesFor({ id: 1, genre1: 1 }, { 1: true })).toStrictEqual([
      'guide-program-cell',
      'ctg-1',
    ])
    expect(classesFor({ id: 1, genre1: 1 }, {})).toStrictEqual(['guide-program-cell', 'ctg-1'])
    expect(classesFor({ id: 1, genre1: 1 }, { 2: false })).toStrictEqual([
      'guide-program-cell',
      'ctg-1',
    ])
  })

  it('never hides a program without a genre', () => {
    expect(classesFor({ id: 1 }, { 1: false, 0: false })).toStrictEqual([
      'guide-program-cell',
      'ctg-empty',
    ])
  })

  it('adds no reserve class when the numeric program id has no reserve entry', () => {
    expect(
      classesFor({ id: 1, genre1: 2 }, {}, { 99: { type: 'reserve', item: { id: 1 } } }),
    ).toStrictEqual(['guide-program-cell', 'ctg-2'])
  })

  it('does not take a reserve entry for a program that has no id', () => {
    const reserveIndex = {
      undefined: { type: 'reserve', item: { id: 1 } },
    } as unknown as Parameters<typeof createProgramCellClassList>[0]['reserveIndex']

    expect(classesFor({ name: 'no id' }, {}, reserveIndex)).toStrictEqual([
      'guide-program-cell',
      'ctg-empty',
    ])
  })

  it('adds the reserve state of the program id when present', () => {
    expect(
      classesFor({ id: 5 }, {}, { 5: { type: 'conflict', item: { id: 1, programId: 5 } } }),
    ).toStrictEqual(['guide-program-cell', 'ctg-empty', 'conflict'])
  })
})

describe('shouldUpdateGuideVisibility with non-finite measurements', () => {
  const valid = {
    scrollLeft: 10,
    scrollTop: 10,
    width: 240,
    height: 120,
    contentWidth: 800,
    contentHeight: 600,
  }

  it('accepts a fully finite viewport', () => {
    expect(shouldUpdateGuideVisibility(valid)).toBe(true)
  })

  it('rejects a viewport whose horizontal scroll is not finite', () => {
    expect(shouldUpdateGuideVisibility({ ...valid, scrollLeft: Number.NaN })).toBe(false)
    expect(shouldUpdateGuideVisibility({ ...valid, scrollLeft: Number.POSITIVE_INFINITY })).toBe(
      true,
    )
  })

  it('rejects a viewport whose vertical scroll is not finite', () => {
    expect(shouldUpdateGuideVisibility({ ...valid, scrollTop: Number.NaN })).toBe(false)
  })

  it('rejects a viewport whose size is not finite', () => {
    expect(shouldUpdateGuideVisibility({ ...valid, width: Number.NaN })).toBe(false)
    expect(shouldUpdateGuideVisibility({ ...valid, height: Number.NaN })).toBe(false)
  })
})
