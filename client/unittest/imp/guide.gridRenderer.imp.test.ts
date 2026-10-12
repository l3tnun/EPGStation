import { describe, expect, it, vi } from 'vitest'
import {
  GuideGridRenderer,
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

  it('delegates program click, uses supplied size variables for visibility, and hides out-of-window timeline', async () => {
    const renderer = new GuideGridRenderer()
    const container = document.createElement('div')
    const onProgramClick = vi.fn()
    const onChannelClick = vi.fn()

    document.body.appendChild(container)
    await renderer.mount(container, {
      schedules,
      mode: 'normal',
      startAt,
      hours: 4,
      reserveIndex: {},
      genreVisibility: {},
      guideMode: 'minimum',
      sizeVariables: {
        channelWidth: 100,
        timescaleHeight: 120,
      },
      onProgramClick,
      onChannelClick,
      now: () => startAt + 5 * 60 * 60 * 1000,
    })

    const paidProgram = container.querySelector<HTMLElement>('[data-testid="guide-program-101"]')
    expect(paidProgram).not.toBeNull()
    expect(paidProgram).toHaveClass('hidden')
    expect(
      container.querySelector<HTMLElement>('[data-testid="guide-program-100"]')?.textContent,
    ).toBe('Synthetic Clipped21:50First lineSecond line')

    renderer.restoreScroll({
      scrollLeft: 0,
      scrollTop: 100,
    })

    expect(paidProgram).not.toHaveClass('hidden')
    renderer.restoreScroll({
      scrollLeft: 60,
      scrollTop: 120,
    })
    renderer.updateReserveIndex({
      100: {
        type: 'reserve',
        item: {
          id: 1,
          programId: 100,
        },
      },
    })
    renderer.updateGenreVisibility({
      1: false,
    })
    const programGrid = container.querySelector<HTMLElement>('[data-testid="guide-program-grid"]')
    const channelHeader = container.querySelector<HTMLElement>(
      '[data-testid="guide-channel-header"]',
    )
    const timeScale = container.querySelector<HTMLElement>('[data-testid="guide-time-scale"]')
    expect(programGrid).toHaveProperty('scrollLeft', 60)
    expect(programGrid).toHaveProperty('scrollTop', 120)
    expect(channelHeader).toHaveProperty('scrollLeft', 60)
    expect(timeScale).toHaveProperty('scrollTop', 120)

    channelHeader
      ?.querySelector<HTMLElement>('[data-channel-index="0"]')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(onChannelClick).toHaveBeenCalledTimes(1)
    expect(onChannelClick).toHaveBeenCalledWith(expect.objectContaining({ id: 10 }))

    renderer.restoreScroll({
      scrollLeft: 20,
      scrollTop: 40,
    })
    channelHeader
      ?.querySelector<HTMLElement>('[data-channel-index="0"]')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(onChannelClick).toHaveBeenCalledTimes(2)

    container
      .querySelector<HTMLElement>('[data-testid="guide-program-100"]')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(onProgramClick).toHaveBeenCalledWith(100)
    expect(container.querySelector<HTMLElement>('.guide-current-time-line')).toHaveStyle({
      top: '-100px',
    })

    renderer.destroy()
    container.remove()
    vi.clearAllTimers()
  })

  it('keeps minimum guide cells recoverable after Android-style edge scroll rounding', async () => {
    const renderer = new GuideGridRenderer()
    const container = document.createElement('div')
    const edgeSchedules: GuideGridRendererSchedule[] = Array.from(
      { length: 6 },
      (_, channelIndex) => ({
        channel: {
          id: 200 + channelIndex,
          name: `Synthetic Edge Channel ${channelIndex}`,
          type: 0x01,
        },
        programs: Array.from({ length: 4 }, (_, programIndex) => ({
          id: 2000 + channelIndex * 10 + programIndex,
          name: `Synthetic Edge ${channelIndex}-${programIndex}`,
          startAt: startAt + programIndex * 60 * 60 * 1000,
          endAt: startAt + (programIndex + 1) * 60 * 60 * 1000,
        })),
      }),
    )

    document.body.appendChild(container)
    await renderer.mount(container, {
      schedules: edgeSchedules,
      mode: 'normal',
      startAt,
      hours: 4,
      reserveIndex: {},
      genreVisibility: {},
      guideMode: 'minimum',
      sizeVariables: {
        channelWidth: 100,
        timescaleHeight: 120,
      },
    })

    renderer.restoreScroll({
      scrollLeft: 361,
      scrollTop: 361,
    })

    expect(
      container.querySelector<HTMLElement>('[data-testid="guide-program-2053"]'),
    ).not.toHaveClass('hidden')
    expect(container.querySelector<HTMLElement>('[data-testid="guide-program-2000"]')).toHaveClass(
      'hidden',
    )

    renderer.restoreScroll({
      scrollLeft: -1,
      scrollTop: 361,
    })

    expect(
      container.querySelector<HTMLElement>('[data-testid="guide-program-2003"]'),
    ).not.toHaveClass('hidden')
    expect(container.querySelector<HTMLElement>('[data-testid="guide-program-2053"]')).toHaveClass(
      'hidden',
    )

    renderer.destroy()
    container.remove()
    vi.clearAllTimers()
  })

  it('cancels chunked rendering work when destroyed before the next frame', async () => {
    const renderer = new GuideGridRenderer()
    const container = document.createElement('div')
    const manyPrograms = Array.from({ length: 501 }, (_, index) => ({
      id: index + 1,
      name: `Synthetic Chunk ${index + 1}`,
      startAt: startAt + index * 60 * 1000,
      endAt: startAt + (index + 1) * 60 * 1000,
    }))
    const mountPromise = renderer.mount(container, {
      schedules: [
        {
          channel: {
            id: 20,
            name: 'Synthetic Chunk Channel',
            type: 0x01,
          },
          programs: manyPrograms,
        },
      ],
      mode: 'normal',
      startAt,
      hours: 24,
      reserveIndex: {},
      genreVisibility: {},
      guideMode: 'all',
    })

    renderer.destroy()
    await mountPromise

    expect(container.querySelector('[data-testid="guide-program-501"]')).toBeNull()
    container.remove()
  })
})
