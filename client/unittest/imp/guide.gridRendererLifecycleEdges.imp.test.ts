import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  GuideGridRenderer,
  type GuideGridRendererSchedule,
} from '@/features/guide/GuideGridRenderer'

describe('GuideGridRenderer lifecycle guard clauses', () => {
  const startAt = Date.parse('2026-05-05T00:00:00+09:00')

  afterEach(() => {
    vi.useRealTimers()
  })

  it('ignores reserve-index and genre-visibility updates before mount() has run', () => {
    const renderer = new GuideGridRenderer()

    expect(() => renderer.updateReserveIndex({})).not.toThrow()
    expect(() => renderer.updateGenreVisibility({})).not.toThrow()
  })

  it('ignores a scroll restore before mount() has run (no program grid to update)', () => {
    const renderer = new GuideGridRenderer()

    expect(() => renderer.restoreScroll({ scrollLeft: 10, scrollTop: 20 })).not.toThrow()
    expect(renderer.getScrollData()).toStrictEqual({ scrollLeft: 10, scrollTop: 20 })
  })

  it('ignores a click dispatched on the mounted grid if the input was cleared out-of-band', async () => {
    const renderer = new GuideGridRenderer()
    const container = document.createElement('div')
    document.body.appendChild(container)

    await renderer.mount(container, {
      schedules: [],
      mode: 'normal',
      startAt,
      hours: 4,
      reserveIndex: {},
      genreVisibility: {},
      guideMode: 'all',
    })

    // Simulate the renderer's input having been cleared without a full destroy(),
    // exercising the defensive null-check in the attached click listener.
    ;(renderer as unknown as { input: unknown }).input = null
    const programGrid = container.querySelector('[data-testid="guide-program-grid"]')
    expect(() =>
      programGrid?.dispatchEvent(new MouseEvent('click', { bubbles: true })),
    ).not.toThrow()

    renderer.destroy()
    container.remove()
  })

  it('completes chunked rendering for large program sets without being destroyed mid-flight', async () => {
    const renderer = new GuideGridRenderer()
    const container = document.createElement('div')
    document.body.appendChild(container)
    const manyPrograms = Array.from({ length: 501 }, (_, index) => ({
      id: index + 1,
      name: `Synthetic Chunk ${index + 1}`,
      startAt: startAt + index * 60 * 1000,
      endAt: startAt + (index + 1) * 60 * 1000,
    }))
    const schedules: GuideGridRendererSchedule[] = [
      {
        channel: { id: 20, name: 'Synthetic Chunk Channel', type: 0x01 },
        programs: manyPrograms,
      },
    ]

    await renderer.mount(container, {
      schedules,
      mode: 'normal',
      startAt,
      hours: 24,
      reserveIndex: {},
      genreVisibility: {},
      guideMode: 'all',
    })

    expect(container.querySelector('[data-testid="guide-program-501"]')).not.toBeNull()

    renderer.destroy()
    container.remove()
  })

  it('does not touch the channel header or time scale scroll position when they are absent', async () => {
    const renderer = new GuideGridRenderer()
    const container = document.createElement('div')
    document.body.appendChild(container)

    await renderer.mount(container, {
      schedules: [],
      mode: 'normal',
      startAt,
      hours: 4,
      reserveIndex: {},
      genreVisibility: {},
      guideMode: 'all',
    })

    const withPrivateFields = renderer as unknown as {
      channelHeader: HTMLElement | null
      timeScale: HTMLElement | null
    }
    withPrivateFields.channelHeader = null
    withPrivateFields.timeScale = null

    const programGrid = container.querySelector('[data-testid="guide-program-grid"]')
    expect(() => programGrid?.dispatchEvent(new Event('scroll', { bubbles: true }))).not.toThrow()

    renderer.destroy()
    container.remove()
  })

  it('does not throw when the internal scroll-sync handler runs before a program grid exists', () => {
    // syncScrollFromProgramGrid is only ever wired to listeners attached after the program
    // grid element exists, so this guard is exercised directly to prove it defends the
    // (unreachable-in-practice) call-before-mount ordering.
    const renderer = new GuideGridRenderer() as unknown as {
      syncScrollFromProgramGrid: () => void
    }

    expect(() => renderer.syncScrollFromProgramGrid()).not.toThrow()
  })

  it('does not throw when the internal timeline-position update runs before mount() has set state', () => {
    const renderer = new GuideGridRenderer() as unknown as {
      updateTimelinePosition: () => void
    }

    expect(() => renderer.updateTimelinePosition()).not.toThrow()
  })

  it('throws when internal layout/input accessors are used before mount() has populated them', () => {
    const renderer = new GuideGridRenderer() as unknown as {
      requireLayout: () => unknown
      requireInput: () => unknown
    }

    expect(() => renderer.requireLayout()).toThrow('GuideGridRendererLayoutMissing')
    expect(() => renderer.requireInput()).toThrow('GuideGridRendererInputMissing')
  })

  it('reschedules the current-time position every minute and stops once the generation changes', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-05T00:00:00+09:00'))

    const renderer = new GuideGridRenderer()
    const container = document.createElement('div')
    document.body.appendChild(container)

    await renderer.mount(container, {
      schedules: [],
      mode: 'normal',
      startAt,
      hours: 4,
      reserveIndex: {},
      genreVisibility: {},
      guideMode: 'all',
    })

    const timelineBefore = container.querySelector<HTMLElement>('.guide-current-time-line')?.style
      .top

    vi.advanceTimersByTime(60_000)

    const timelineAfter = container.querySelector<HTMLElement>('.guide-current-time-line')?.style
      .top
    expect(timelineAfter).not.toBe(timelineBefore)

    // Bump the generation without going through destroy()/mount() again so the already
    // scheduled callback observes a stale generation and exits without rescheduling.
    ;(renderer as unknown as { generation: number }).generation += 1
    expect(() => vi.advanceTimersByTime(60_000)).not.toThrow()

    renderer.destroy()
    container.remove()
  })
})
