import { describe, expect, it, vi } from 'vitest'
import {
  createGridViewport,
  parseCssPixelValue,
  renderChannelHeader,
  resolveSizeVariables,
  setTextChild,
  createProgramElement,
} from '@/features/guide/lib/guideGridDom'
import {
  DEFAULT_CHANNEL_WIDTH_PX,
  DEFAULT_TIMESCALE_HEIGHT_PX,
  DEFAULT_VIEWPORT_HEIGHT_PX,
  DEFAULT_VIEWPORT_WIDTH_PX,
  type GuideGridLayout,
  type GuideGridLayoutProgram,
  type GuideGridRendererInput,
} from '@/features/guide/lib/guideGridTypes'

describe('setTextChild', () => {
  it('uses innerText when the runtime HTMLElement prototype supports it', () => {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'innerText')
    Object.defineProperty(HTMLElement.prototype, 'innerText', {
      value: '',
      writable: true,
      configurable: true,
    })

    try {
      const parent = document.createElement('div')
      setTextChild(parent, 'name', 'Program name')
      const child = parent.firstElementChild as HTMLElement
      expect(child.innerText).toBe('Program name')
    } finally {
      if (descriptor) {
        Object.defineProperty(HTMLElement.prototype, 'innerText', descriptor)
      } else {
        delete (HTMLElement.prototype as unknown as Record<string, unknown>).innerText
      }
    }
  })
})

describe('parseCssPixelValue', () => {
  it('parses a finite numeric CSS pixel value', () => {
    expect(parseCssPixelValue('42px')).toBe(42)
  })

  it('returns null for a non-numeric CSS value', () => {
    expect(parseCssPixelValue('not-a-number')).toBeNull()
  })
})

describe('renderChannelHeader', () => {
  it('falls back to an empty label when a channel has no name', () => {
    const header = document.createElement('div')
    const layout: GuideGridLayout = {
      channels: [{}],
      programs: [],
      timeLabels: [],
      contentMinutes: 0,
    }

    renderChannelHeader(header, layout)

    const item = header.querySelector('[data-channel-index="0"]')
    expect(item?.textContent).toBe('')
  })
})

describe('createProgramElement', () => {
  it('falls back to an empty label when the program has no name', () => {
    const layoutProgram: GuideGridLayoutProgram = {
      channel: {},
      program: { id: 1, startAt: 0, endAt: 1_000 },
      channelIndex: 0,
      topMinutes: 0,
      heightMinutes: 30,
    }
    const input: GuideGridRendererInput = {
      schedules: [],
      mode: 'normal',
      startAt: 0,
      hours: 24,
      reserveIndex: {},
      genreVisibility: {},
      guideMode: 'all',
    }

    const element = createProgramElement(layoutProgram, input)

    expect(element.querySelector('.name')?.textContent).toBe('')
  })

  it('[AC 2.16] does not attach its own click listener, letting the click bubble to the delegated container listener', () => {
    const layoutProgram: GuideGridLayoutProgram = {
      channel: {},
      program: { id: 1, startAt: 0, endAt: 1_000 },
      channelIndex: 0,
      topMinutes: 0,
      heightMinutes: 30,
    }
    const onProgramClick = vi.fn()
    const input: GuideGridRendererInput = {
      schedules: [],
      mode: 'normal',
      startAt: 0,
      hours: 24,
      reserveIndex: {},
      genreVisibility: {},
      guideMode: 'all',
      onProgramClick,
    }

    const element = createProgramElement(layoutProgram, input)
    const container = document.createElement('div')
    const containerClick = vi.fn()
    container.addEventListener('click', containerClick)
    container.appendChild(element)

    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))

    expect(containerClick).toHaveBeenCalledTimes(1)
    expect(onProgramClick).not.toHaveBeenCalled()
  })
})

describe('resolveSizeVariables', () => {
  it('falls back to the default size variables when there is no container', () => {
    const input: GuideGridRendererInput = {
      schedules: [],
      mode: 'normal',
      startAt: 0,
      hours: 24,
      reserveIndex: {},
      genreVisibility: {},
      guideMode: 'all',
    }

    expect(resolveSizeVariables(null, input)).toStrictEqual({
      channelWidth: DEFAULT_CHANNEL_WIDTH_PX,
      timescaleHeight: DEFAULT_TIMESCALE_HEIGHT_PX,
    })
  })
})

describe('createGridViewport', () => {
  it('falls back to zero scroll offsets and default sizes when there is no program grid', () => {
    const layout: GuideGridLayout = {
      channels: [],
      programs: [],
      timeLabels: [],
      contentMinutes: 0,
    }

    const viewport = createGridViewport(null, layout, {
      channelWidth: DEFAULT_CHANNEL_WIDTH_PX,
      timescaleHeight: DEFAULT_TIMESCALE_HEIGHT_PX,
    })

    expect(viewport.scrollLeft).toBe(0)
    expect(viewport.scrollTop).toBe(0)
    expect(viewport.width).toBe(DEFAULT_VIEWPORT_WIDTH_PX)
    expect(viewport.height).toBe(DEFAULT_VIEWPORT_HEIGHT_PX)
  })
})
