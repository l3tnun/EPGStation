import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  dispatchGuideGridClick,
  GuideGridDragScroller,
} from '@/features/guide/lib/guideGridInteraction'
import type { GuideGridLayout, GuideGridRendererInput } from '@/features/guide/lib/guideGridTypes'

function createInput(overrides: Partial<GuideGridRendererInput> = {}): GuideGridRendererInput {
  return {
    schedules: [],
    mode: 'normal',
    startAt: 0,
    hours: 24,
    reserveIndex: {},
    genreVisibility: {},
    guideMode: 'all',
    ...overrides,
  }
}

describe('dispatchGuideGridClick', () => {
  it('does nothing when the click target is not an Element', () => {
    const onProgramClick = vi.fn()
    const event = { target: null } as unknown as MouseEvent

    expect(() => dispatchGuideGridClick(event, createInput({ onProgramClick }), null)).not.toThrow()
    expect(onProgramClick).not.toHaveBeenCalled()
  })

  it('does nothing when neither onChannelClick nor onProgramClick is provided', () => {
    document.body.innerHTML = '<div data-program-id="5"><span id="inner"></span></div>'
    const target = document.getElementById('inner') as Element
    const event = { target } as unknown as MouseEvent

    expect(() => dispatchGuideGridClick(event, createInput(), null)).not.toThrow()
  })

  it('does not invoke onProgramClick when the click target has no program-id ancestor', () => {
    document.body.innerHTML = '<div><span id="inner"></span></div>'
    const target = document.getElementById('inner') as Element
    const onProgramClick = vi.fn()
    const event = { target } as unknown as MouseEvent

    dispatchGuideGridClick(event, createInput({ onProgramClick }), null)

    expect(onProgramClick).not.toHaveBeenCalled()
  })

  it('does not invoke onChannelClick when the layout has no channel at the resolved index', () => {
    document.body.innerHTML = '<div data-channel-index="0"><span id="inner"></span></div>'
    const target = document.getElementById('inner') as Element
    const onChannelClick = vi.fn()
    const onProgramClick = vi.fn()
    const event = { target } as unknown as MouseEvent
    const layout: GuideGridLayout = {
      channels: [],
      programs: [],
      timeLabels: [],
      contentMinutes: 0,
    }

    dispatchGuideGridClick(event, createInput({ onChannelClick, onProgramClick }), layout)

    expect(onChannelClick).not.toHaveBeenCalled()
    expect(onProgramClick).not.toHaveBeenCalled()
  })

  it('resolves a program click through the closest data-program-id ancestor', () => {
    document.body.innerHTML = '<div data-program-id="42"><span id="inner"></span></div>'
    const target = document.getElementById('inner') as Element
    const onProgramClick = vi.fn()
    const event = { target } as unknown as MouseEvent

    dispatchGuideGridClick(event, createInput({ onProgramClick }), null)

    expect(onProgramClick).toHaveBeenCalledWith(42)
  })
})

describe('GuideGridDragScroller', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function createGrid(): HTMLElement {
    const grid = document.createElement('div')
    grid.scrollLeft = 0
    grid.scrollTop = 0
    document.body.appendChild(grid)
    return grid
  }

  it('ignores mouse moves before a mouse-down has pushed the pointer', () => {
    const onScrolled = vi.fn()
    const scroller = new GuideGridDragScroller(onScrolled)
    const grid = createGrid()
    scroller.attach(grid)

    scroller.onMouseMove({ clientX: 10, clientY: 10 } as MouseEvent)

    expect(onScrolled).not.toHaveBeenCalled()
    scroller.detach()
  })

  it('scrolls the grid while dragging and clears the is-dragging class after the timer', () => {
    const onScrolled = vi.fn()
    const scroller = new GuideGridDragScroller(onScrolled)
    const grid = createGrid()
    scroller.attach(grid)

    scroller.onMouseDown({ clientX: 100, clientY: 100 } as MouseEvent)
    scroller.onMouseMove({ clientX: 90, clientY: 80 } as MouseEvent)

    expect(grid.classList.contains('is-dragging')).toBe(true)
    expect(grid.scrollLeft).toBe(10)
    expect(grid.scrollTop).toBe(20)
    expect(onScrolled).toHaveBeenCalledTimes(1)

    // A second move before the timer fires clears the pending timer instead of stacking it.
    scroller.onMouseMove({ clientX: 85, clientY: 75 } as MouseEvent)
    expect(onScrolled).toHaveBeenCalledTimes(2)

    vi.advanceTimersByTime(100)
    expect(grid.classList.contains('is-dragging')).toBe(false)

    scroller.onMouseUp()
    scroller.detach()
  })
})
