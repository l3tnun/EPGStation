import { describe, expect, it, vi } from 'vitest'
import {
  RECORDING_CARD_LAYOUT_MAX_WIDTH,
  formatFullTime,
  formatShortTime,
  itemChannel,
  itemId,
  itemLabel,
  readIsCardLayout,
} from '@/features/recording/lib/recordingFormat'
import { buildRecordingPageSearch } from '@/features/recording/recordingRequests'

describe('Recording format helpers', () => {
  it('labels items by name, id, or position', () => {
    expect(itemId({ id: 5 })).toBe(5)
    expect(itemId({})).toBeUndefined()
    expect(itemLabel({ name: 'Named', id: 1 }, 0)).toBe('Named')
    expect(itemLabel({ id: 7 }, 0)).toBe('#7')
    expect(itemLabel({}, 2)).toBe('#3')
  })

  it('shows the channel name, falls back to the id, then to empty', () => {
    expect(itemChannel({ channelName: 'ch', channelId: 1 })).toBe('ch')
    expect(itemChannel({ channelId: 42 })).toBe('42')
    expect(itemChannel({})).toBe('')
  })

  it('formats short and full JST time ranges only when both ends exist', () => {
    const item = { startAt: Date.UTC(2026, 0, 5, 3, 4), endAt: Date.UTC(2026, 0, 5, 4, 34) }
    expect(formatShortTime(item)).toBe('01/05(月) 12:04 (90 m)')
    expect(formatFullTime(item)).toBe('01/05(月) 12:04 ~ 13:34 (90 m)')
    expect(formatShortTime({ startAt: 1 })).toBe('')
    expect(formatShortTime({ endAt: 1 })).toBe('')
    expect(formatFullTime({ startAt: 1 })).toBe('')
    expect(formatFullTime({ endAt: 1 })).toBe('')
  })

  function stubMatchMedia(matches: boolean): () => void {
    const descriptor = Object.getOwnPropertyDescriptor(window, 'matchMedia')

    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn().mockReturnValue({
        matches,
        media: `(max-width: ${RECORDING_CARD_LAYOUT_MAX_WIDTH}px)`,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    })

    return () => {
      if (descriptor !== undefined) {
        Object.defineProperty(window, 'matchMedia', descriptor)
      } else {
        Reflect.deleteProperty(window, 'matchMedia')
      }
    }
  }

  // At innerWidth 601-615px with a classic (non-overlay) desktop
  // scrollbar, `document.documentElement.clientWidth` (which EXCLUDES the scrollbar gutter) falls
  // to ~590-600px while the CSS `@media (max-width: 600px)` that hides/shows
  // `.recordingTableCard`/`.recordingCards` evaluates against the viewport INCLUDING that gutter,
  // so it does not match. A JS width read picking the card layout from `clientWidth` alone would
  // disagree with the CSS and leave the Recording list empty (JS renders no table, CSS keeps the
  // card list `display: none`). Reading the exact same media query removes that possibility:
  // pinned here at innerWidth 610 / clientWidth 595, matching this method's own query directly
  // rather than re-deriving it from a width comparison.
  it('matches the CSS media query directly instead of comparing a JS-measured width (innerWidth 610, clientWidth 595)', () => {
    const innerWidthDescriptor = Object.getOwnPropertyDescriptor(window, 'innerWidth')
    const clientWidthDescriptor = Object.getOwnPropertyDescriptor(
      document.documentElement,
      'clientWidth',
    )
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 610 })
    Object.defineProperty(document.documentElement, 'clientWidth', {
      configurable: true,
      value: 595,
    })
    const restoreMatchMedia = stubMatchMedia(false)

    try {
      // The real CSS media query does not match at this viewport (610 > 600), so the table layout
      // -- not the card layout a clientWidth-based read would have picked -- must be reported.
      expect(readIsCardLayout()).toBe(false)
    } finally {
      restoreMatchMedia()
      if (innerWidthDescriptor !== undefined) {
        Object.defineProperty(window, 'innerWidth', innerWidthDescriptor)
      }
      if (clientWidthDescriptor !== undefined) {
        Object.defineProperty(document.documentElement, 'clientWidth', clientWidthDescriptor)
      }
    }
  })

  it('switches to the card layout when the media query matches', () => {
    const restoreMatchMedia = stubMatchMedia(true)

    try {
      expect(readIsCardLayout()).toBe(true)
    } finally {
      restoreMatchMedia()
    }
  })

  it('stays on the table layout when the media query does not match', () => {
    const restoreMatchMedia = stubMatchMedia(false)

    try {
      expect(readIsCardLayout()).toBe(false)
    } finally {
      restoreMatchMedia()
    }
  })

  it('reports the table layout when matchMedia is unavailable', () => {
    const descriptor = Object.getOwnPropertyDescriptor(window, 'matchMedia')
    // @ts-expect-error -- simulate an environment without matchMedia support
    delete window.matchMedia

    try {
      expect(readIsCardLayout()).toBe(false)
    } finally {
      if (descriptor !== undefined) {
        Object.defineProperty(window, 'matchMedia', descriptor)
      }
    }
  })

  it('reports the table layout when no window object exists', () => {
    vi.stubGlobal('window', undefined)
    try {
      expect(readIsCardLayout()).toBe(false)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('builds the page search by dropping timestamp and page 1', () => {
    expect(buildRecordingPageSearch({ search: '?timestamp=9&page=3', page: 1 })).toBe('')
    expect(buildRecordingPageSearch({ search: '?timestamp=9', page: 2 })).toBe('?page=2')
    expect(buildRecordingPageSearch({ search: '?a=1&page=9', page: 4 })).toBe('?a=1&page=4')
    expect(buildRecordingPageSearch({ search: '', page: 0 })).toBe('')
  })
})
