import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  createGuideGridLayout,
  createProgramCellClassList,
  isAudioVideoService,
  normalizeGuideViewport,
  shouldUpdateGuideVisibility,
  type GuideGridRendererSchedule,
} from '@/features/guide/GuideGridRenderer'

describe('GuideGridRenderer deterministic visual model', () => {
  const startAt = Date.parse('2026-05-05T22:00:00+09:00')

  const schedules: readonly GuideGridRendererSchedule[] = [
    {
      channel: {
        id: 10,
        name: 'Synthetic Video',
        type: 0x01,
      },
      programs: [
        {
          id: 100,
          name: 'Synthetic Clipped',
          description: 'First line\nSecond line',
          startAt: startAt - 10 * 60 * 1000,
          endAt: startAt + 30 * 60 * 1000,
          genre1: 1,
          isFree: true,
        },
        {
          id: 101,
          name: 'Synthetic Wrapped',
          startAt: startAt + 70 * 60 * 1000,
          endAt: startAt + 130 * 60 * 1000,
          genre2: 6,
          isFree: false,
        },
      ],
    },
    {
      channel: {
        id: 11,
        name: 'Synthetic Data',
        type: 0xc0,
      },
      programs: [
        {
          id: 200,
          name: 'Synthetic Hidden Service',
          startAt,
          endAt: startAt + 60 * 60 * 1000,
        },
      ],
    },
    {
      channel: {
        id: 12,
        name: 'Synthetic Audio',
        type: 0xa2,
      },
      programs: [
        {
          id: 300,
          name: 'Synthetic Audio Program',
          startAt: startAt + 24 * 60 * 60 * 1000,
          endAt: startAt + 25 * 60 * 60 * 1000,
        },
      ],
    },
  ]

  it('filters full-guide channels to audio/video services and computes clipped geometry with 24h wrapped time labels', () => {
    const layout = createGuideGridLayout({
      schedules,
      mode: 'normal',
      startAt,
      hours: 4,
    })

    expect(layout.channels.map((channel) => channel.name)).toStrictEqual([
      'Synthetic Video',
      'Synthetic Audio',
    ])
    expect(layout.timeLabels).toStrictEqual([22, 23, 0, 1])
    expect(layout.contentMinutes).toBe(240)
    expect(layout.programs.map((program) => program.program.id)).toStrictEqual([100, 101])
    expect(layout.programs[0]).toMatchObject({
      channelIndex: 0,
      topMinutes: 0,
      heightMinutes: 30,
    })
    expect(layout.programs[1]).toMatchObject({
      channelIndex: 0,
      topMinutes: 70,
      heightMinutes: 60,
    })
  })

  it('keeps single-channel schedules as day columns without audio/video filtering', () => {
    const layout = createGuideGridLayout({
      schedules: [schedules[1]],
      mode: 'singleChannel',
      startAt,
      hours: 24,
    })

    expect(layout.channels.map((channel) => channel.name)).toStrictEqual(['05/05(火)'])
    expect(layout.programs).toHaveLength(1)
    expect(layout.programs[0]).toMatchObject({
      channelIndex: 0,
      topMinutes: 0,
      heightMinutes: 60,
    })
  })

  it('builds reserve, genre, free, and lazy visibility classes with reserve priority already resolved by the index', () => {
    const program = schedules[0]?.programs?.[0]

    expect(program).toBeDefined()
    expect(
      createProgramCellClassList({
        program: program!,
        reserveIndex: {
          100: {
            type: 'overlap',
            item: { id: 400, programId: 100 },
          },
        },
        genreVisibility: {
          1: false,
        },
        hidden: true,
      }),
    ).toStrictEqual(['guide-program-cell', 'ctg-1', 'is-free', 'hide', 'overlap', 'hidden'])
  })

  it('keeps genre-hidden Guide programs visible as muted cells instead of removing them', () => {
    const css = readFileSync('src/features/guide/GuidePage.module.css', 'utf8')

    expect(css).toContain('.guidePage :global(.guide-program-cell.hide) {')
    expect(css).toContain('background: #f8f8f8;')
    expect(css).toContain('color: #888;')
    expect(css).toMatch(
      /:global\(\[data-theme-mode='dark'\]\)\s+\.guidePage:not\(\[data-guide-dark-colors='disabled'\]\)\s+:global\(\.guide-program-cell\.hide\)/,
    )
    expect(css).toContain('background: #272121;')
    expect(css).not.toContain(
      '.guidePage :global(.guide-program-cell.hide) {\n  visibility: hidden;',
    )
    expect(css).not.toContain('.guidePage :global(.guide-program-cell.hide) {\n  display: none;')
  })

  it('keeps Guide title day selector as a single vertical list instead of inheriting genre grid columns', () => {
    const css = readFileSync('src/features/guide/GuidePage.module.css', 'utf8')

    expect(css).toContain('.daySelectContent .dayOptionList {')
    expect(css).toContain('grid-template-columns: 1fr;')
  })

  it('normalizes out-of-range bounce scroll values instead of dropping visibility updates', () => {
    expect(isAudioVideoService(0x01)).toBe(true)
    expect(isAudioVideoService(0xa2)).toBe(true)
    expect(isAudioVideoService(0xc0)).toBe(false)
    expect(
      normalizeGuideViewport({
        scrollLeft: -1,
        scrollTop: 481,
        width: 240,
        height: 120,
        contentWidth: 800,
        contentHeight: 600,
      }),
    ).toMatchObject({
      scrollLeft: 0,
      scrollTop: 480,
    })
    expect(
      normalizeGuideViewport({
        scrollLeft: 561,
        scrollTop: 481,
        width: 240,
        height: 120,
        contentWidth: 800,
        contentHeight: 600,
      }),
    ).toMatchObject({
      scrollLeft: 560,
      scrollTop: 480,
    })
    expect(
      shouldUpdateGuideVisibility({
        scrollLeft: -1,
        scrollTop: 0,
        width: 240,
        height: 120,
        contentWidth: 800,
        contentHeight: 600,
      }),
    ).toBe(true)
    expect(
      shouldUpdateGuideVisibility({
        scrollLeft: 561,
        scrollTop: 481,
        width: 240,
        height: 120,
        contentWidth: 800,
        contentHeight: 600,
      }),
    ).toBe(true)
  })
})
