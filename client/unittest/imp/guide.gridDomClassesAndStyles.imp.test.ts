import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createGridContent,
  createGridElement,
  createProgramElement,
  createTimelineElement,
  nextFrame,
  renderChannelHeader,
  renderTimeScale,
  setTextChild,
} from '@/features/guide/lib/guideGridDom'
import type {
  GuideGridLayout,
  GuideGridLayoutProgram,
  GuideGridRendererInput,
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

function createLayoutProgram(
  program: Partial<GuideGridLayoutProgram['program']> = {},
): GuideGridLayoutProgram {
  return {
    channel: {},
    program: { id: 7, startAt: 0, endAt: 1_000, name: 'Name', ...program },
    channelIndex: 3,
    topMinutes: 45,
    heightMinutes: 30,
  }
}

describe('setTextChild', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('appends a div carrying the given class name', () => {
    const parent = document.createElement('div')

    setTextChild(parent, 'description', 'text')

    expect(parent.children).toHaveLength(1)
    expect(parent.children[0].tagName).toBe('DIV')
    expect(parent.children[0].className).toBe('description')
  })

  it('keeps line breaks when the runtime supports innerText', () => {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'innerText')
    Object.defineProperty(HTMLElement.prototype, 'innerText', {
      configurable: true,
      get(this: HTMLElement) {
        return this.textContent ?? ''
      },
      set(this: HTMLElement, value: string) {
        this.textContent = value
      },
    })

    try {
      const parent = document.createElement('div')
      setTextChild(parent, 'name', 'line1\nline2')
      expect(parent.children[0].textContent).toBe('line1\nline2')
    } finally {
      if (descriptor) {
        Object.defineProperty(HTMLElement.prototype, 'innerText', descriptor)
      } else {
        delete (HTMLElement.prototype as unknown as Record<string, unknown>).innerText
      }
    }
  })

  it('falls back to textContent without line breaks when innerText is not supported', () => {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'innerText')
    delete (HTMLElement.prototype as unknown as Record<string, unknown>).innerText

    try {
      expect('innerText' in HTMLElement.prototype).toBe(false)
      const parent = document.createElement('div')
      setTextChild(parent, 'name', 'line1\r\nline2\nline3')
      expect(parent.children[0].textContent).toBe('line1line2line3')
    } finally {
      if (descriptor) {
        Object.defineProperty(HTMLElement.prototype, 'innerText', descriptor)
      }
    }
  })
})

describe('nextFrame', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('resolves only after the zero-delay timer fires', async () => {
    vi.useFakeTimers()
    const done = vi.fn()

    const promise = nextFrame().then(done)
    await Promise.resolve()
    expect(done).not.toHaveBeenCalled()

    vi.advanceTimersByTime(0)
    await promise

    expect(done).toHaveBeenCalledTimes(1)
  })
})

describe('createGridElement', () => {
  it('sets the class name and the test id when one is given', () => {
    const element = createGridElement('some-class', 'some-id')

    expect(element.tagName).toBe('DIV')
    expect(element.className).toBe('some-class')
    expect(element.dataset.testid).toBe('some-id')
  })

  it('does not set any test id attribute when none is given', () => {
    const element = createGridElement('some-class')

    expect(element.className).toBe('some-class')
    expect(element.hasAttribute('data-testid')).toBe(false)
  })
})

describe('createGridContent', () => {
  it('has the content class and test id', () => {
    const content = createGridContent({
      channels: [{}],
      programs: [],
      timeLabels: [],
      contentMinutes: 60,
    })

    expect(content.className).toBe('guide-program-grid-dom')
    expect(content.dataset.testid).toBe('guide-program-grid-dom')
  })

  it('sizes the content from the channel count and the content minutes', () => {
    const layout: GuideGridLayout = {
      channels: [{}, {}, {}],
      programs: [],
      timeLabels: [],
      contentMinutes: 1440,
    }

    const content = createGridContent(layout)
    const style = content.getAttribute('style') ?? ''

    expect(content.style.width).toBe('calc(3 * var(--channel-width))')
    expect(content.style.minWidth).toBe('calc(3 * var(--channel-width))')
    expect(content.style.height).toBe('calc(1440 * (var(--timescale-height) / 60))')
    expect(content.style.minHeight).toBe('calc(1440 * (var(--timescale-height) / 60))')
    expect(style).toContain('min-width')
    expect(style).toContain('min-height')
  })
})

describe('renderChannelHeader', () => {
  it('appends a dummy cell, one cell per channel, then a scrollbar cell', () => {
    const header = document.createElement('div')
    const layout: GuideGridLayout = {
      channels: [{ name: 'A' }, { name: 'B' }],
      programs: [],
      timeLabels: [],
      contentMinutes: 0,
    }

    renderChannelHeader(header, layout)

    const children = Array.from(header.children) as HTMLElement[]
    expect(children.map((child) => child.className)).toStrictEqual([
      'guide-channel-header-item guide-channel-header-dummy',
      'guide-channel-header-item',
      'guide-channel-header-item',
      'guide-channel-header-item guide-channel-header-scrollbar',
    ])
    expect(children.map((child) => child.dataset.channelIndex)).toStrictEqual([
      undefined,
      '0',
      '1',
      undefined,
    ])
    expect(children.map((child) => child.textContent)).toStrictEqual(['', 'A', 'B', ''])
  })
})

describe('renderTimeScale', () => {
  it('appends one cell per time label followed by a dummy cell', () => {
    const scale = document.createElement('div')
    const layout: GuideGridLayout = {
      channels: [],
      programs: [],
      timeLabels: [5, 6],
      contentMinutes: 0,
    }

    renderTimeScale(scale, layout)

    const children = Array.from(scale.children) as HTMLElement[]
    expect(children.map((child) => child.className)).toStrictEqual([
      'guide-time-scale-item time-5',
      'guide-time-scale-item time-6',
      'guide-time-scale-item guide-time-scale-dummy',
    ])
    expect(children.map((child) => child.textContent)).toStrictEqual(['5', '6', ''])
  })
})

describe('createTimelineElement', () => {
  it('is a decorative element for the current time line', () => {
    const timeline = createTimelineElement()

    expect(timeline.tagName).toBe('DIV')
    expect(timeline.className).toBe('guide-current-time-line')
    expect(timeline.getAttribute('aria-hidden')).toBe('true')
  })
})

describe('createProgramElement', () => {
  it('is a button identified by the program id', () => {
    const element = createProgramElement(createLayoutProgram(), createInput()) as HTMLButtonElement

    expect(element.tagName).toBe('BUTTON')
    expect(element.type).toBe('button')
    expect(element.getAttribute('type')).toBe('button')
    expect(element.dataset.testid).toBe('guide-program-7')
    expect(element.dataset.programId).toBe('7')
  })

  it('is positioned from the channel index and the minutes', () => {
    const element = createProgramElement(createLayoutProgram(), createInput())

    expect(element.style.height).toBe('calc(30 * (var(--timescale-height) / 60))')
    expect(element.style.top).toBe('calc(45 * (var(--timescale-height) / 60))')
    expect(element.style.left).toBe('calc(3 * var(--channel-width))')
  })

  it('has no hidden class in the all mode and the hidden class in the other modes', () => {
    const all = createProgramElement(createLayoutProgram(), createInput({ guideMode: 'all' }))
    const sequential = createProgramElement(
      createLayoutProgram(),
      createInput({ guideMode: 'sequential' }),
    )

    expect(all.classList.contains('hidden')).toBe(false)
    expect(sequential.classList.contains('hidden')).toBe(true)
  })

  it('carries the genre, free and reserve classes derived from the input', () => {
    const reserveIndex = { 7: { type: 'reserve' } } as unknown as GuideReserveIndex
    const element = createProgramElement(
      createLayoutProgram({ genre1: 3, isFree: true }),
      createInput({ reserveIndex, genreVisibility: { 3: false } }),
    )

    expect(element.className).toBe('guide-program-cell ctg-3 is-free hide reserve')
  })

  it('renders the name, start time and description children in that order', () => {
    const startAt = Date.UTC(2024, 0, 1, 3, 4)
    const element = createProgramElement(
      createLayoutProgram({ startAt, endAt: startAt + 1_000, name: 'Title', description: 'Desc' }),
      createInput(),
    )

    const children = Array.from(element.children) as HTMLElement[]
    expect(children.map((child) => child.className)).toStrictEqual(['name', 'time', 'description'])
    expect(children[0].textContent).toBe('Title')
    expect(children[1].textContent).toBe('12:04')
    expect(children[2].textContent).toBe('Desc')
  })

  it('omits the description child when the program has no description', () => {
    const element = createProgramElement(createLayoutProgram(), createInput())

    expect(element.querySelector('.description')).toBeNull()
    expect(element.children).toHaveLength(2)
  })
})
