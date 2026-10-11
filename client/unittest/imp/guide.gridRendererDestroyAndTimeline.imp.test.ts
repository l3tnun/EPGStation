import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  GuideGridRenderer,
  type GuideGridRendererInput,
  type GuideGridRendererSchedule,
} from '@/features/guide/GuideGridRenderer'

interface RendererInternals {
  container: HTMLElement | null
  input: unknown
  generation: number
  programGrid: HTMLElement | null
  currentTimeline: HTMLElement | null
  timerId: unknown
  programDoms: { element: HTMLElement; isVisible: boolean }[]
  programDomIndex: Map<number, HTMLElement[]>
  dragScroller: { detach: () => void }
  onScroll: () => void
  onClick: (event: MouseEvent) => void
  updateVisibility: () => void
  updateTimelinePosition: () => void
  scheduleTimelineUpdate: () => void
  isCurrentGeneration: (generation: number) => boolean
}

const internalsOf = (renderer: GuideGridRenderer): RendererInternals =>
  renderer as unknown as RendererInternals

describe('GuideGridRenderer teardown, chunked rendering and timeline scheduling', () => {
  const startAt = Date.parse('2026-05-05T00:00:00+09:00')
  const MIN = 60 * 1000
  const containers: HTMLElement[] = []

  const makeContainer = (): HTMLElement => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    containers.push(container)

    return container
  }

  const channel = { id: 10, name: 'Synthetic Channel', type: 0x01 }

  const smallSchedules: GuideGridRendererSchedule[] = [
    {
      channel,
      programs: [
        { id: 1, name: 'Near', startAt, endAt: startAt + 30 * MIN },
        { id: 2, name: 'Far', startAt: startAt + 600 * MIN, endAt: startAt + 630 * MIN },
      ],
    },
  ]

  const manySchedules: GuideGridRendererSchedule[] = [
    {
      channel,
      programs: Array.from({ length: 501 }, (_, index) => ({
        id: index + 1,
        name: `Synthetic ${index + 1}`,
        startAt: startAt + index * MIN,
        endAt: startAt + (index + 1) * MIN,
      })),
    },
  ]

  const makeInput = (overrides: Partial<GuideGridRendererInput> = {}): GuideGridRendererInput => ({
    schedules: smallSchedules,
    mode: 'normal',
    startAt,
    hours: 24,
    reserveIndex: {},
    genreVisibility: {},
    guideMode: 'minimum',
    sizeVariables: { channelWidth: 100, timescaleHeight: 120 },
    ...overrides,
  })

  afterEach(() => {
    vi.useRealTimers()
    containers.splice(0).forEach((container) => container.remove())
  })

  it('builds the header, time scale and program grid with their class names and test ids', async () => {
    const renderer = new GuideGridRenderer()
    const container = makeContainer()
    const stray = document.createElement('span')
    container.appendChild(stray)

    await renderer.mount(container, makeInput({ guideMode: 'all' }))

    expect(stray.isConnected).toBe(false)
    expect(container.children).toHaveLength(2)
    const [header, body] = Array.from(container.children)
    expect(header.className).toBe('guide-channel-header')
    expect(header.getAttribute('data-testid')).toBe('guide-channel-header')
    expect(body.className).toBe('guide-grid-body')
    expect(body.hasAttribute('data-testid')).toBe(false)
    expect(body.children).toHaveLength(2)
    const [timeScale, programGrid] = Array.from(body.children)
    expect(timeScale.className).toBe('guide-time-scale')
    expect(timeScale.getAttribute('data-testid')).toBe('guide-time-scale')
    expect(programGrid.className).toBe('guide-program-grid')
    expect(programGrid.getAttribute('data-testid')).toBe('guide-program-grid')

    renderer.destroy()
  })

  it('shows the cells inside the viewport right after mounting in a virtualized mode', async () => {
    const renderer = new GuideGridRenderer()
    const container = makeContainer()

    await renderer.mount(container, makeInput({ guideMode: 'minimum' }))

    const near = container.querySelector<HTMLElement>('[data-testid="guide-program-1"]')
    const far = container.querySelector<HTMLElement>('[data-testid="guide-program-2"]')
    expect(near).not.toHaveClass('hidden')
    expect(far).toHaveClass('hidden')
    expect(internalsOf(renderer).programDoms.map((dom) => dom.isVisible)).toStrictEqual([
      true,
      false,
    ])

    renderer.destroy()
  })

  it('marks cells visible at mount time only in the mode that renders every cell', async () => {
    const renderer = new GuideGridRenderer()

    await renderer.mount(makeContainer(), makeInput({ guideMode: 'all' }))
    expect(internalsOf(renderer).programDoms.map((dom) => dom.isVisible)).toStrictEqual([
      true,
      true,
    ])

    await renderer.mount(makeContainer(), makeInput({ guideMode: 'sequential' }))
    const sequential = internalsOf(renderer).programDoms.map((dom) => dom.isVisible)
    expect(sequential).toStrictEqual([true, false])

    renderer.destroy()
  })

  it('starts with an origin scroll position before anything is mounted', () => {
    expect(new GuideGridRenderer().getScrollData()).toStrictEqual({ scrollLeft: 0, scrollTop: 0 })
  })

  it('reads the live scroll position of the program grid once mounted', async () => {
    const renderer = new GuideGridRenderer()
    const container = makeContainer()
    await renderer.mount(container, makeInput({ guideMode: 'all' }))

    const programGrid = container.querySelector<HTMLElement>('[data-testid="guide-program-grid"]')
    if (programGrid === null) {
      throw new Error('program grid missing')
    }
    programGrid.scrollLeft = 30
    programGrid.scrollTop = 40

    expect(renderer.getScrollData()).toStrictEqual({ scrollLeft: 30, scrollTop: 40 })

    renderer.destroy()
  })

  it('keeps the input empty when reserve or genre updates arrive before mounting', () => {
    const renderer = new GuideGridRenderer()

    renderer.updateReserveIndex({})
    renderer.updateGenreVisibility({})

    expect(internalsOf(renderer).input).toBeNull()
  })

  it('re-applies the remembered scroll position after reserve and genre updates', async () => {
    const renderer = new GuideGridRenderer()
    const container = makeContainer()
    await renderer.mount(container, makeInput({ guideMode: 'all' }))
    const programGrid = container.querySelector<HTMLElement>('[data-testid="guide-program-grid"]')
    const header = container.querySelector<HTMLElement>('[data-testid="guide-channel-header"]')
    const timeScale = container.querySelector<HTMLElement>('[data-testid="guide-time-scale"]')
    if (programGrid === null || header === null || timeScale === null) {
      throw new Error('grid parts missing')
    }

    renderer.restoreScroll({ scrollLeft: 50, scrollTop: 60 })
    const drift = (): void => {
      programGrid.scrollLeft = 0
      programGrid.scrollTop = 0
      header.scrollLeft = 0
      timeScale.scrollTop = 0
    }

    drift()
    renderer.updateReserveIndex({})
    expect(programGrid.scrollLeft).toBe(50)
    expect(programGrid.scrollTop).toBe(60)
    expect(header.scrollLeft).toBe(50)
    expect(timeScale.scrollTop).toBe(60)

    drift()
    renderer.updateGenreVisibility({})
    expect(programGrid.scrollLeft).toBe(50)
    expect(programGrid.scrollTop).toBe(60)
    expect(header.scrollLeft).toBe(50)
    expect(timeScale.scrollTop).toBe(60)

    renderer.destroy()
  })

  it('updates which cells are visible when the program grid scrolls', async () => {
    const renderer = new GuideGridRenderer()
    const container = makeContainer()
    await renderer.mount(container, makeInput({ guideMode: 'minimum' }))
    const programGrid = container.querySelector<HTMLElement>('[data-testid="guide-program-grid"]')
    if (programGrid === null) {
      throw new Error('program grid missing')
    }
    const far = container.querySelector<HTMLElement>('[data-testid="guide-program-2"]')
    expect(far).toHaveClass('hidden')

    programGrid.scrollTop = 1200
    programGrid.dispatchEvent(new Event('scroll'))

    expect(far).not.toHaveClass('hidden')
    expect(container.querySelector('[data-testid="guide-program-1"]')).toHaveClass('hidden')
    expect(renderer.getScrollData().scrollTop).toBe(1200)

    renderer.destroy()
  })

  it('never hides cells while scrolling in the mode that renders every cell', async () => {
    const renderer = new GuideGridRenderer()
    const container = makeContainer()
    await renderer.mount(container, makeInput({ guideMode: 'all' }))
    const programGrid = container.querySelector<HTMLElement>('[data-testid="guide-program-grid"]')
    if (programGrid === null) {
      throw new Error('program grid missing')
    }

    programGrid.scrollTop = 1200
    programGrid.dispatchEvent(new Event('scroll'))

    expect(container.querySelector('[data-testid="guide-program-1"]')).not.toHaveClass('hidden')
    expect(container.querySelector('[data-testid="guide-program-2"]')).not.toHaveClass('hidden')

    renderer.destroy()
  })

  it('skips the visibility update when no input or no program grid is available', async () => {
    const renderer = new GuideGridRenderer()
    const container = makeContainer()
    await renderer.mount(container, makeInput({ guideMode: 'minimum' }))
    const internals = internalsOf(renderer)

    const savedInput = internals.input
    internals.input = null
    expect(() => internals.updateVisibility()).not.toThrow()
    internals.input = savedInput

    const savedGrid = internals.programGrid
    internals.programDoms[0].isVisible = false
    internals.programGrid = null
    internals.updateVisibility()
    expect(internals.programDoms[0].isVisible).toBe(false)
    internals.programGrid = savedGrid

    renderer.destroy()
  })

  it('appends program cells in chunks of 500 before yielding', async () => {
    vi.useFakeTimers()
    const renderer = new GuideGridRenderer()
    const container = makeContainer()

    const mounting = renderer.mount(container, makeInput({ schedules: manySchedules }))
    expect(container.querySelectorAll('button[data-program-id]')).toHaveLength(500)

    await vi.advanceTimersByTimeAsync(0)
    await mounting
    expect(container.querySelectorAll('button[data-program-id]')).toHaveLength(501)

    renderer.destroy()
  })

  it('abandons chunked rendering when destroyed while waiting for the next frame', async () => {
    vi.useFakeTimers()
    const renderer = new GuideGridRenderer()
    const container = makeContainer()

    const mounting = renderer.mount(container, makeInput({ schedules: manySchedules }))
    renderer.destroy()
    await vi.advanceTimersByTimeAsync(0)
    await mounting

    const internals = internalsOf(renderer)
    expect(internals.programDoms).toHaveLength(0)
    expect(internals.programDomIndex.size).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not schedule the timeline when destroyed before the first render finished', async () => {
    vi.useFakeTimers()
    const renderer = new GuideGridRenderer()
    const container = makeContainer()

    const mounting = renderer.mount(container, makeInput())
    renderer.destroy()
    await mounting

    expect(vi.getTimerCount()).toBe(0)
  })

  it('lets only the latest of two overlapping mounts finish', async () => {
    vi.useFakeTimers()
    const renderer = new GuideGridRenderer()
    const first = makeContainer()
    const second = makeContainer()

    const firstMount = renderer.mount(first, makeInput({ schedules: manySchedules }))
    const secondMount = renderer.mount(second, makeInput({ schedules: manySchedules }))
    await vi.advanceTimersByTimeAsync(0)
    await Promise.all([firstMount, secondMount])

    expect(first.children).toHaveLength(0)
    expect(second.querySelectorAll('button[data-program-id]')).toHaveLength(501)
    expect(internalsOf(renderer).programDoms).toHaveLength(501)
    expect(vi.getTimerCount()).toBe(1)

    renderer.destroy()
  })

  it('tears down the previous container, listeners and timer when mounting again', async () => {
    vi.useFakeTimers()
    const renderer = new GuideGridRenderer()
    const first = makeContainer()
    const second = makeContainer()

    await renderer.mount(first, makeInput())
    expect(vi.getTimerCount()).toBe(1)
    await renderer.mount(second, makeInput())

    expect(first.children).toHaveLength(0)
    expect(second.children).toHaveLength(2)
    expect(vi.getTimerCount()).toBe(1)

    renderer.destroy()
  })

  it('detaches its listeners, drag scroller and timer on destroy', async () => {
    vi.useFakeTimers()
    const renderer = new GuideGridRenderer()
    const container = makeContainer()
    await renderer.mount(container, makeInput())
    const internals = internalsOf(renderer)
    const programGrid = container.querySelector<HTMLElement>('[data-testid="guide-program-grid"]')
    const header = container.querySelector<HTMLElement>('[data-testid="guide-channel-header"]')
    if (programGrid === null || header === null) {
      throw new Error('grid parts missing')
    }
    const gridRemove = vi.spyOn(programGrid, 'removeEventListener')
    const headerRemove = vi.spyOn(header, 'removeEventListener')
    const detach = vi.spyOn(internals.dragScroller, 'detach')
    const { onScroll, onClick } = internals
    expect(vi.getTimerCount()).toBe(1)

    renderer.destroy()

    expect(gridRemove).toHaveBeenCalledWith('scroll', onScroll)
    expect(gridRemove).toHaveBeenCalledWith('click', onClick)
    expect(headerRemove).toHaveBeenCalledWith('click', onClick)
    expect(headerRemove).toHaveBeenCalledTimes(1)
    expect(detach).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
    expect(internals.timerId).toBeNull()
    expect(container.children).toHaveLength(0)
  })

  it('runs the minute timeline tick when the current minute ends and keeps rescheduling', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-05T00:00:15+09:00'))
    const renderer = new GuideGridRenderer()
    await renderer.mount(makeContainer(), makeInput({ guideMode: 'all' }))
    const update = vi.spyOn(internalsOf(renderer), 'updateTimelinePosition')

    vi.advanceTimersByTime(44_999)
    expect(update).toHaveBeenCalledTimes(0)
    vi.advanceTimersByTime(1)
    expect(update).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(59_999)
    expect(update).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1)
    expect(update).toHaveBeenCalledTimes(2)
    expect(vi.getTimerCount()).toBe(1)

    renderer.destroy()
  })

  it('uses the supplied clock to time the next tick', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-05T00:00:00+09:00'))
    const renderer = new GuideGridRenderer()
    const now = new Date('2026-05-05T00:00:50+09:00').getTime()
    await renderer.mount(makeContainer(), makeInput({ guideMode: 'all', now: () => now }))
    const update = vi.spyOn(internalsOf(renderer), 'updateTimelinePosition')

    vi.advanceTimersByTime(9_999)
    expect(update).toHaveBeenCalledTimes(0)
    vi.advanceTimersByTime(1)
    expect(update).toHaveBeenCalledTimes(1)

    renderer.destroy()
  })

  it('can schedule a timeline tick without any mounted input', () => {
    vi.useFakeTimers()
    const renderer = new GuideGridRenderer()

    expect(() => internalsOf(renderer).scheduleTimelineUpdate()).not.toThrow()
    expect(vi.getTimerCount()).toBe(1)

    renderer.destroy()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('stops ticking once the generation is stale', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-05T00:00:00+09:00'))
    const renderer = new GuideGridRenderer()
    await renderer.mount(makeContainer(), makeInput({ guideMode: 'all' }))
    const internals = internalsOf(renderer)
    const update = vi.spyOn(internals, 'updateTimelinePosition')

    internals.generation += 1
    vi.advanceTimersByTime(60_000)

    expect(update).toHaveBeenCalledTimes(0)
    expect(vi.getTimerCount()).toBe(0)

    renderer.destroy()
  })

  it('skips the timeline position update when either the input or the timeline is missing', async () => {
    const renderer = new GuideGridRenderer()
    await renderer.mount(makeContainer(), makeInput({ guideMode: 'all' }))
    const internals = internalsOf(renderer)

    const savedTimeline = internals.currentTimeline
    internals.currentTimeline = null
    expect(() => internals.updateTimelinePosition()).not.toThrow()
    internals.currentTimeline = savedTimeline

    const savedInput = internals.input
    internals.input = null
    expect(() => internals.updateTimelinePosition()).not.toThrow()
    internals.input = savedInput

    renderer.destroy()
  })

  it('considers a generation current only while its container is still attached', async () => {
    const renderer = new GuideGridRenderer()
    const container = makeContainer()
    await renderer.mount(container, makeInput({ guideMode: 'all' }))
    const internals = internalsOf(renderer)
    const generation = internals.generation

    expect(internals.isCurrentGeneration(generation)).toBe(true)
    expect(internals.isCurrentGeneration(generation - 1)).toBe(false)
    expect(internals.isCurrentGeneration(generation + 1)).toBe(false)

    internals.container = null
    expect(internals.isCurrentGeneration(generation)).toBe(false)
    internals.container = container

    renderer.destroy()
  })
})
