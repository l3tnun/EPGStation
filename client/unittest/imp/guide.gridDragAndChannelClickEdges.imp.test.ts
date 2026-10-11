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

describe('dispatchGuideGridClick on a channel header', () => {
  const layout: GuideGridLayout = {
    channels: [{ name: 'first' }, { name: 'second' }],
    programs: [],
    timeLabels: [],
    contentMinutes: 0,
  }

  it('passes the channel at the header index to onChannelClick only', () => {
    document.body.innerHTML = '<div data-channel-index="1"><span id="inner"></span></div>'
    const event = { target: document.getElementById('inner') } as unknown as MouseEvent
    const onChannelClick = vi.fn()
    const onProgramClick = vi.fn()

    dispatchGuideGridClick(event, createInput({ onChannelClick, onProgramClick }), layout)

    expect(onChannelClick).toHaveBeenCalledTimes(1)
    expect(onChannelClick).toHaveBeenCalledWith({ name: 'second' })
    expect(onProgramClick).not.toHaveBeenCalled()
  })

  it('does not throw without onChannelClick and does not treat a header as a program', () => {
    document.body.innerHTML = '<div data-channel-index="0"><span id="inner"></span></div>'
    const event = { target: document.getElementById('inner') } as unknown as MouseEvent
    const onProgramClick = vi.fn()

    expect(() =>
      dispatchGuideGridClick(event, createInput({ onProgramClick }), layout),
    ).not.toThrow()
    expect(onProgramClick).not.toHaveBeenCalled()
  })

  it('does not throw when the layout is not available and falls through to the program click', () => {
    document.body.innerHTML =
      '<div data-program-id="9"><div data-channel-index="0"><span id="inner"></span></div></div>'
    const event = { target: document.getElementById('inner') } as unknown as MouseEvent
    const onChannelClick = vi.fn()
    const onProgramClick = vi.fn()

    expect(() =>
      dispatchGuideGridClick(event, createInput({ onChannelClick, onProgramClick }), null),
    ).not.toThrow()
    expect(onChannelClick).not.toHaveBeenCalled()
    expect(onProgramClick).toHaveBeenCalledWith(9)
  })
})

describe('GuideGridDragScroller lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  function createGrid(): HTMLElement {
    const grid = document.createElement('div')
    document.body.appendChild(grid)
    return grid
  }

  it('listens to mouse down on the grid and to mouse up and move on the document', () => {
    const grid = createGrid()
    const gridAdd = vi.spyOn(grid, 'addEventListener')
    const documentAdd = vi.spyOn(document, 'addEventListener')
    const scroller = new GuideGridDragScroller(vi.fn())

    scroller.attach(grid)

    expect(gridAdd).toHaveBeenCalledWith('mousedown', scroller.onMouseDown)
    expect(documentAdd).toHaveBeenCalledWith('mouseup', scroller.onMouseUp)
    expect(documentAdd).toHaveBeenCalledWith('mousemove', scroller.onMouseMove)
    scroller.detach()
  })

  it('stops scrolling after a mouse up delivered through the document', () => {
    const onScrolled = vi.fn()
    const scroller = new GuideGridDragScroller(onScrolled)
    const grid = createGrid()
    scroller.attach(grid)

    grid.dispatchEvent(new MouseEvent('mousedown', { clientX: 50, clientY: 50, bubbles: true }))
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 40, clientY: 50 }))
    expect(onScrolled).toHaveBeenCalledTimes(1)
    document.dispatchEvent(new MouseEvent('mouseup'))
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 30, clientY: 50 }))

    expect(onScrolled).toHaveBeenCalledTimes(1)
    scroller.detach()
  })

  it('ignores a mouse move while pushed but not attached to any grid', () => {
    const onScrolled = vi.fn()
    const scroller = new GuideGridDragScroller(onScrolled)

    scroller.onMouseDown({ clientX: 1, clientY: 1 } as MouseEvent)

    expect(() => scroller.onMouseMove({ clientX: 0, clientY: 0 } as MouseEvent)).not.toThrow()
    expect(onScrolled).not.toHaveBeenCalled()
  })

  it('keeps is-dragging until 100 ms after the latest move', () => {
    const scroller = new GuideGridDragScroller(vi.fn())
    const grid = createGrid()
    scroller.attach(grid)
    const clear = vi.spyOn(globalThis, 'clearTimeout')

    scroller.onMouseDown({ clientX: 100, clientY: 100 } as MouseEvent)
    scroller.onMouseMove({ clientX: 99, clientY: 100 } as MouseEvent)
    expect(clear).not.toHaveBeenCalled()
    vi.advanceTimersByTime(60)
    scroller.onMouseMove({ clientX: 98, clientY: 100 } as MouseEvent)
    expect(clear).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(60)
    expect(grid.classList.contains('is-dragging')).toBe(true)
    vi.advanceTimersByTime(40)
    expect(grid.classList.contains('is-dragging')).toBe(false)
    scroller.detach()
  })

  it('stops listening and cancels the pending timer on detach', () => {
    const onScrolled = vi.fn()
    const scroller = new GuideGridDragScroller(onScrolled)
    const grid = createGrid()
    const gridRemove = vi.spyOn(grid, 'removeEventListener')
    const documentRemove = vi.spyOn(document, 'removeEventListener')
    scroller.attach(grid)
    const clear = vi.spyOn(globalThis, 'clearTimeout')
    scroller.onMouseDown({ clientX: 10, clientY: 10 } as MouseEvent)
    scroller.onMouseMove({ clientX: 5, clientY: 10 } as MouseEvent)
    expect(vi.getTimerCount()).toBe(1)

    scroller.detach()

    expect(clear).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
    expect(gridRemove).toHaveBeenCalledWith('mousedown', scroller.onMouseDown)
    expect(documentRemove).toHaveBeenCalledWith('mouseup', scroller.onMouseUp)
    expect(documentRemove).toHaveBeenCalledWith('mousemove', scroller.onMouseMove)
  })

  it('does not call clearTimeout on detach when no drag timer is pending', () => {
    const scroller = new GuideGridDragScroller(vi.fn())
    scroller.attach(createGrid())
    const clear = vi.spyOn(globalThis, 'clearTimeout')

    scroller.detach()

    expect(clear).not.toHaveBeenCalled()
  })

  it('forgets a pushed pointer on detach so a re-attached grid does not drag until mouse down', () => {
    const onScrolled = vi.fn()
    const scroller = new GuideGridDragScroller(onScrolled)
    scroller.attach(createGrid())
    scroller.onMouseDown({ clientX: 10, clientY: 10 } as MouseEvent)
    scroller.detach()

    scroller.attach(createGrid())
    scroller.onMouseMove({ clientX: 0, clientY: 0 } as MouseEvent)

    expect(onScrolled).not.toHaveBeenCalled()
    scroller.detach()
  })
})
