import { describe, expect, it } from 'vitest'
import {
  applyGuideGridVisibility,
  resolveTimelineTop,
} from '@/features/guide/lib/guideGridVisibility'
import {
  MINUTE_MS,
  type GuideGridRendererInput,
  type GuideGridViewport,
  type ProgramDomItem,
} from '@/features/guide/lib/guideGridTypes'

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

function createDom(
  position: Partial<ProgramDomItem> & { className?: string } = {},
): ProgramDomItem {
  const element = document.createElement('div')
  element.className = position.className ?? ''

  return {
    element,
    program: { id: 1, startAt: 0, endAt: 1_000 },
    channelIndex: 0,
    topMinutes: 0,
    heightMinutes: 60,
    isVisible: false,
    ...position,
  }
}

// channelWidth 100, timescaleHeight 60 -> one minute is one pixel.
const sizeVariables = { channelWidth: 100, timescaleHeight: 60 }

function viewport(overrides: Partial<GuideGridViewport> = {}): GuideGridViewport {
  return {
    scrollLeft: 300,
    scrollTop: 300,
    width: 200,
    height: 200,
    contentWidth: 2000,
    contentHeight: 2000,
    ...overrides,
  }
}

function isShown(dom: ProgramDomItem, overrides: Partial<GuideGridViewport> = {}): boolean {
  dom.isVisible = false
  dom.element.className = 'hidden'
  applyGuideGridVisibility({
    programDoms: [dom],
    input: createInput(),
    viewport: viewport(overrides),
    sizeVariables,
  })

  return dom.isVisible
}

describe('applyGuideGridVisibility viewport edges', () => {
  it('shows a cell overlapping the viewport and removes its hidden class', () => {
    const dom = createDom({ channelIndex: 4, topMinutes: 350, heightMinutes: 10 })

    expect(isShown(dom)).toBe(true)
    expect(dom.element.classList.contains('hidden')).toBe(false)
  })

  it('hides a cell whose right edge only touches the left edge of the viewport', () => {
    // left = 200, right edge = 300 = scrollLeft
    expect(isShown(createDom({ channelIndex: 2, topMinutes: 350 }))).toBe(false)
    // one pixel further to the right overlaps
    expect(isShown(createDom({ channelIndex: 2, topMinutes: 350 }), { scrollLeft: 299 })).toBe(true)
  })

  it('hides a cell entirely left of the viewport', () => {
    expect(isShown(createDom({ channelIndex: 0, topMinutes: 350 }))).toBe(false)
  })

  it('hides a cell whose left edge only touches the right edge of the viewport', () => {
    // left = 500 = scrollLeft + width
    expect(isShown(createDom({ channelIndex: 5, topMinutes: 350 }))).toBe(false)
    expect(isShown(createDom({ channelIndex: 4, topMinutes: 350 }))).toBe(true)
  })

  it('hides a cell whose top only touches the bottom edge of the viewport', () => {
    // top = 500 = scrollTop + height
    expect(isShown(createDom({ channelIndex: 4, topMinutes: 500 }))).toBe(false)
    expect(isShown(createDom({ channelIndex: 4, topMinutes: 499 }))).toBe(true)
  })

  it('hides a cell whose bottom only touches the top edge of the viewport', () => {
    // bottom = 240 + 60 = 300 = scrollTop
    expect(isShown(createDom({ channelIndex: 4, topMinutes: 240, heightMinutes: 60 }))).toBe(false)
    expect(isShown(createDom({ channelIndex: 4, topMinutes: 240, heightMinutes: 61 }))).toBe(true)
  })

  it('does not touch any cell when the viewport is unusable', () => {
    const dom = createDom({ isVisible: true, className: 'keep' })

    applyGuideGridVisibility({
      programDoms: [dom],
      input: createInput(),
      viewport: viewport({ width: Number.NaN }),
      sizeVariables,
    })

    expect(dom.isVisible).toBe(true)
    expect(dom.element.className).toBe('keep')
  })

  it('leaves the class list alone when the visibility does not change', () => {
    const stillOut = createDom({ channelIndex: 0, isVisible: false, className: 'cell' })
    const stillIn = createDom({
      channelIndex: 4,
      topMinutes: 350,
      isVisible: true,
      className: 'cell hidden',
    })

    applyGuideGridVisibility({
      programDoms: [stillOut, stillIn],
      input: createInput(),
      viewport: viewport(),
      sizeVariables,
    })

    expect(stillOut.element.className).toBe('cell')
    expect(stillIn.element.className).toBe('cell hidden')
  })

  it('in the sequential mode never hides a cell that has already been shown', () => {
    const shown = createDom({ channelIndex: 0, isVisible: true, className: 'cell' })
    const unseen = createDom({ channelIndex: 0, isVisible: false, className: 'cell' })
    const entering = createDom({ channelIndex: 4, topMinutes: 350, className: 'cell hidden' })

    applyGuideGridVisibility({
      programDoms: [shown, unseen, entering],
      input: createInput({ guideMode: 'sequential' }),
      viewport: viewport(),
      sizeVariables,
    })

    expect(shown.isVisible).toBe(true)
    expect(shown.element.className).toBe('cell')
    expect(unseen.element.className).toBe('cell')
    expect(entering.isVisible).toBe(true)
    expect(entering.element.className).toBe('cell')
  })

  it('in the all mode hides a cell that has left the viewport', () => {
    const dom = createDom({ channelIndex: 0, isVisible: true, className: 'cell' })

    applyGuideGridVisibility({
      programDoms: [dom],
      input: createInput({ guideMode: 'all' }),
      viewport: viewport(),
      sizeVariables,
    })

    expect(dom.isVisible).toBe(false)
    expect(dom.element.className).toBe('cell hidden')
  })
})

describe('resolveTimelineTop', () => {
  const startAt = 1_000_000 * MINUTE_MS
  const input = (now: number, hours = 24): GuideGridRendererInput =>
    createInput({ startAt, hours, now: () => now })

  it('is off screen before the guide starts', () => {
    expect(resolveTimelineTop(input(startAt - 5 * MINUTE_MS), MINUTE_MS)).toBe('-100px')
  })

  it('is off screen during the first minute and shows from the second one', () => {
    expect(resolveTimelineTop(input(startAt), MINUTE_MS)).toBe('-100px')
    expect(resolveTimelineTop(input(startAt + 59_000), MINUTE_MS)).toBe('-100px')
    expect(resolveTimelineTop(input(startAt + MINUTE_MS), MINUTE_MS)).toBe(
      'calc((1 * (var(--timescale-height) / 60)) - 1px)',
    )
  })

  it('counts whole minutes since the start', () => {
    expect(resolveTimelineTop(input(startAt + 90 * MINUTE_MS + 59_000), MINUTE_MS)).toBe(
      'calc((90 * (var(--timescale-height) / 60)) - 1px)',
    )
  })

  it('is off screen from the end of the guide on', () => {
    expect(resolveTimelineTop(input(startAt + 2 * 60 * MINUTE_MS - MINUTE_MS, 2), MINUTE_MS)).toBe(
      'calc((119 * (var(--timescale-height) / 60)) - 1px)',
    )
    expect(resolveTimelineTop(input(startAt + 2 * 60 * MINUTE_MS, 2), MINUTE_MS)).toBe('-100px')
    expect(resolveTimelineTop(input(startAt + 3 * 60 * MINUTE_MS, 2), MINUTE_MS)).toBe('-100px')
  })
})
