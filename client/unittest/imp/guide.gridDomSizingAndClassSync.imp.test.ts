import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  applyGenreVisibilityClasses,
  applyReserveStateClasses,
  createGridViewport,
  resolveSizeVariables,
} from '@/features/guide/lib/guideGridDom'
import {
  DEFAULT_CHANNEL_WIDTH_PX,
  DEFAULT_TIMESCALE_HEIGHT_PX,
  type GuideGenreVisibility,
  type GuideGridLayout,
  type GuideGridRendererInput,
  type ProgramDomItem,
} from '@/features/guide/lib/guideGridTypes'
import type { GuideReserveIndex } from '@/features/guide/guideRequests'

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

function stubComputedStyle(values: Record<string, string>) {
  const getPropertyValue = vi.fn((name: string) => values[name] ?? '')
  const spy = vi
    .spyOn(window, 'getComputedStyle')
    .mockReturnValue({ getPropertyValue } as unknown as CSSStyleDeclaration)

  return { getPropertyValue, spy }
}

describe('resolveSizeVariables', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('reads the channel width and timescale height custom properties of the container', () => {
    const container = document.createElement('div')
    const { getPropertyValue, spy } = stubComputedStyle({
      '--channel-width': '200px',
      '--timescale-height': '90px',
    })

    expect(resolveSizeVariables(container, createInput())).toStrictEqual({
      channelWidth: 200,
      timescaleHeight: 90,
    })
    expect(spy).toHaveBeenCalledWith(container)
    expect(getPropertyValue).toHaveBeenCalledWith('--channel-width')
    expect(getPropertyValue).toHaveBeenCalledWith('--timescale-height')
  })

  it('falls back to the defaults when the custom properties are not numeric', () => {
    const container = document.createElement('div')
    stubComputedStyle({})

    expect(resolveSizeVariables(container, createInput())).toStrictEqual({
      channelWidth: DEFAULT_CHANNEL_WIDTH_PX,
      timescaleHeight: DEFAULT_TIMESCALE_HEIGHT_PX,
    })
  })

  it('prefers the sizes given in the input over the computed style, each independently', () => {
    const container = document.createElement('div')
    stubComputedStyle({ '--channel-width': '200px', '--timescale-height': '90px' })

    expect(
      resolveSizeVariables(container, createInput({ sizeVariables: { channelWidth: 111 } })),
    ).toStrictEqual({ channelWidth: 111, timescaleHeight: 90 })
    expect(
      resolveSizeVariables(container, createInput({ sizeVariables: { timescaleHeight: 222 } })),
    ).toStrictEqual({ channelWidth: 200, timescaleHeight: 222 })
  })

  it('does not read the computed style when there is no container', () => {
    const { spy } = stubComputedStyle({ '--channel-width': '200px' })

    resolveSizeVariables(null, createInput())

    expect(spy).not.toHaveBeenCalled()
  })

  it('falls back to the defaults when there is no window', () => {
    const container = document.createElement('div')
    vi.stubGlobal('window', undefined)

    expect(resolveSizeVariables(container, createInput())).toStrictEqual({
      channelWidth: DEFAULT_CHANNEL_WIDTH_PX,
      timescaleHeight: DEFAULT_TIMESCALE_HEIGHT_PX,
    })
  })
})

describe('createGridViewport', () => {
  it('reads the scroll offsets and client size of the program grid', () => {
    const grid = document.createElement('div')
    Object.defineProperty(grid, 'scrollLeft', { value: 15, configurable: true })
    Object.defineProperty(grid, 'scrollTop', { value: 25, configurable: true })
    Object.defineProperty(grid, 'clientWidth', { value: 640, configurable: true })
    Object.defineProperty(grid, 'clientHeight', { value: 480, configurable: true })
    const layout: GuideGridLayout = {
      channels: [{}, {}, {}],
      programs: [],
      timeLabels: [],
      contentMinutes: 120,
    }

    expect(createGridViewport(grid, layout, { channelWidth: 100, timescaleHeight: 180 })).toEqual({
      scrollLeft: 15,
      scrollTop: 25,
      width: 640,
      height: 480,
      contentWidth: 300,
      contentHeight: 360,
    })
  })

  it('uses the content size from the layout when there is no program grid', () => {
    const layout: GuideGridLayout = {
      channels: [{}, {}],
      programs: [],
      timeLabels: [],
      contentMinutes: 30,
    }

    const viewport = createGridViewport(null, layout, { channelWidth: 140, timescaleHeight: 120 })

    expect(viewport.contentWidth).toBe(280)
    expect(viewport.contentHeight).toBe(60)
  })
})

describe('applyReserveStateClasses', () => {
  it('clears every reserve state class and applies the one from the index', () => {
    const a = document.createElement('div')
    a.className = 'cell reserve conflict skip overlap'
    const b = document.createElement('div')
    b.className = 'cell conflict'
    const c = document.createElement('div')
    c.className = 'cell skip'
    const index = new Map<number, readonly HTMLElement[]>([
      [1, [a]],
      [2, [b]],
      [3, [c]],
    ])
    const reserveIndex = {
      1: { type: 'overlap' },
      2: { type: 'reserve' },
      999: { type: 'skip' },
    } as unknown as GuideReserveIndex

    applyReserveStateClasses(index, reserveIndex)

    expect(a.className).toBe('cell overlap')
    expect(b.className).toBe('cell reserve')
    expect(c.className).toBe('cell')
  })

  it('applies the class to every element sharing a program id', () => {
    const first = document.createElement('div')
    const second = document.createElement('div')
    const index = new Map<number, readonly HTMLElement[]>([[5, [first, second]]])

    applyReserveStateClasses(index, { 5: { type: 'conflict' } } as unknown as GuideReserveIndex)

    expect(first.classList.contains('conflict')).toBe(true)
    expect(second.classList.contains('conflict')).toBe(true)
  })
})

describe('applyGenreVisibilityClasses', () => {
  function createDom(genre1: number | undefined, className = ''): ProgramDomItem {
    const element = document.createElement('div')
    element.className = className

    return {
      element,
      program: { id: 1, startAt: 0, endAt: 1_000, genre1 },
      channelIndex: 0,
      topMinutes: 0,
      heightMinutes: 30,
      isVisible: true,
    }
  }

  it('hides only the programs whose genre is explicitly turned off', () => {
    const off = createDom(3)
    const on = createDom(4)
    const unset = createDom(5)
    const visibility: GuideGenreVisibility = { 3: false, 4: true }

    applyGenreVisibilityClasses([off, on, unset], visibility)

    expect(off.element.classList.contains('hide')).toBe(true)
    expect(on.element.classList.contains('hide')).toBe(false)
    expect(unset.element.classList.contains('hide')).toBe(false)
  })

  it('shows again a program that was hidden but whose genre is now visible', () => {
    const dom = createDom(3, 'hide')

    applyGenreVisibilityClasses([dom], { 3: true })

    expect(dom.element.classList.contains('hide')).toBe(false)
  })

  it('never hides a program without a genre', () => {
    const dom = createDom(undefined, 'hide')
    const visibility = { undefined: false } as unknown as GuideGenreVisibility

    applyGenreVisibilityClasses([dom], visibility)

    expect(dom.element.classList.contains('hide')).toBe(false)
  })
})
