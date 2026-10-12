import { act, render, renderHook, screen } from '@testing-library/react'
import { createElement, useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_DELAY_MS,
  DEFAULT_MIN_DURATION_MS,
  useDeferredLoading,
} from '@/shared/useDeferredLoading'

// The "読み込み中" indicator on 録画済み/予約 (including 競合/重複) would flash for a
// handful of milliseconds on every fast, local-network fetch.
// `useDeferredLoading` is the shared guard against that: it withholds
// the visible indicator until the underlying loading state has genuinely
// been pending for a while, and once shown, holds it for a minimum duration
// so a response landing just after the delay doesn't itself flash.
describe('useDeferredLoading', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('never becomes visible when isLoading resolves before the delay elapses (the flicker case)', () => {
    vi.useFakeTimers()
    const { result, rerender } = renderHook(({ isLoading }) => useDeferredLoading(isLoading), {
      initialProps: { isLoading: true },
    })

    expect(result.current).toBe(false)

    act(() => {
      vi.advanceTimersByTime(DEFAULT_DELAY_MS - 1)
    })
    expect(result.current).toBe(false)

    rerender({ isLoading: false })

    // Even long after the fetch settled, the indicator must never have shown.
    act(() => {
      vi.advanceTimersByTime(DEFAULT_DELAY_MS + DEFAULT_MIN_DURATION_MS + 1000)
    })
    expect(result.current).toBe(false)
  })

  it('becomes visible once isLoading has been pending longer than delayMs (the genuinely-slow case)', () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useDeferredLoading(true))

    expect(result.current).toBe(false)

    act(() => {
      vi.advanceTimersByTime(DEFAULT_DELAY_MS - 1)
    })
    expect(result.current).toBe(false)

    act(() => {
      vi.advanceTimersByTime(2)
    })
    expect(result.current).toBe(true)
  })

  it('holds the indicator visible for minDurationMs even if isLoading finishes right after it appears', () => {
    vi.useFakeTimers()
    const { result, rerender } = renderHook(({ isLoading }) => useDeferredLoading(isLoading), {
      initialProps: { isLoading: true },
    })

    // Indicator becomes visible at t=DEFAULT_DELAY_MS; the minimum hold time
    // is counted from *that* moment, not from whenever loading later ends.
    act(() => {
      vi.advanceTimersByTime(DEFAULT_DELAY_MS + 10)
    })
    expect(result.current).toBe(true)

    // The fetch finishes 10ms after the indicator appeared -- without a
    // minimum hold time this would immediately flip back to false and flash
    // for only 10ms, which is the same complaint in a different shape.
    rerender({ isLoading: false })
    expect(result.current).toBe(true)

    // Still short of DEFAULT_MIN_DURATION_MS since the indicator appeared
    // (10ms already elapsed before `isLoading` flipped false).
    act(() => {
      vi.advanceTimersByTime(DEFAULT_MIN_DURATION_MS - 10 - 1)
    })
    expect(result.current).toBe(true)

    act(() => {
      vi.advanceTimersByTime(2)
    })
    expect(result.current).toBe(false)
  })

  it('hides immediately once isLoading finishes if it had already been visible for at least minDurationMs', () => {
    vi.useFakeTimers()
    const { result, rerender } = renderHook(({ isLoading }) => useDeferredLoading(isLoading), {
      initialProps: { isLoading: true },
    })

    act(() => {
      vi.advanceTimersByTime(DEFAULT_DELAY_MS + DEFAULT_MIN_DURATION_MS + 50)
    })
    expect(result.current).toBe(true)

    rerender({ isLoading: false })
    expect(result.current).toBe(false)
  })

  it('supports custom delayMs/minDurationMs so callers are not locked to the defaults', () => {
    vi.useFakeTimers()
    const { result, rerender } = renderHook(
      ({ isLoading }) => useDeferredLoading(isLoading, { delayMs: 50, minDurationMs: 30 }),
      { initialProps: { isLoading: true } },
    )

    act(() => {
      vi.advanceTimersByTime(49)
    })
    expect(result.current).toBe(false)

    act(() => {
      vi.advanceTimersByTime(2)
    })
    expect(result.current).toBe(true)

    // Indicator became visible 1ms before this rerender (advanced 51ms
    // against a 50ms delay); the 30ms hold is counted from that moment.
    rerender({ isLoading: false })
    act(() => {
      vi.advanceTimersByTime(28)
    })
    expect(result.current).toBe(true)
    act(() => {
      vi.advanceTimersByTime(2)
    })
    expect(result.current).toBe(false)
  })

  it('never shows anything when isLoading starts and stays false', () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useDeferredLoading(false))

    act(() => {
      vi.advanceTimersByTime(DEFAULT_DELAY_MS + DEFAULT_MIN_DURATION_MS + 100)
    })
    expect(result.current).toBe(false)
  })

  // The tests above compare elapsed time against the imported DEFAULT_DELAY_MS /
  // DEFAULT_MIN_DURATION_MS constants, so they would keep passing unchanged even if someone
  // changed those constants' values (e.g. 200 -> 300): the comparison would simply move with
  // them. Owner approved 200ms/200ms specifically (`.kiro/specs/frontend-reserves/design.md`,
  // `.kiro/specs/frontend-recorded/design.md`); the two tests below pin that literal number
  // directly, independent of whatever the exported constants say, so a change to either default
  // -- whether in the constant or in a hardcoded fallback that drifts from it -- fails here.
  it('pins the exported defaults themselves to the literal 200ms Owner approved', () => {
    expect(DEFAULT_DELAY_MS).toBe(200)
    expect(DEFAULT_MIN_DURATION_MS).toBe(200)
  })

  it('with no options, stays hidden through 199ms of pending isLoading and becomes visible at exactly 200ms', () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useDeferredLoading(true))

    act(() => {
      vi.advanceTimersByTime(199)
    })
    expect(result.current).toBe(false)

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(result.current).toBe(true)
  })

  it('with no options, holds the indicator through 199ms after it appears and hides at exactly 200ms', () => {
    vi.useFakeTimers()
    const { result, rerender } = renderHook(({ isLoading }) => useDeferredLoading(isLoading), {
      initialProps: { isLoading: true },
    })

    // Becomes visible at literal t=200ms.
    act(() => {
      vi.advanceTimersByTime(200)
    })
    expect(result.current).toBe(true)

    // isLoading ends the instant the indicator appears -- the strictest case for the hold time.
    rerender({ isLoading: false })

    act(() => {
      vi.advanceTimersByTime(199)
    })
    expect(result.current).toBe(true)

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(result.current).toBe(false)
  })

  // A screen that consumes the hook shows its content once loading ends and the indicator is not
  // up (ReservesPage, RecordedPage, ManualReservePage all branch this way). React commits that
  // content to the DOM before it runs the effects of the same commit when the update is not
  // synchronous, which is the case for a query result delivered outside act. If the show-timer is
  // only cancelled in a passive effect, the timer can still come due between the commit and that
  // effect: the content is already on screen, the indicator then appears over it for the whole
  // minimum hold time, and a caller that already found the content loses it again. The show-timer
  // therefore has to be cancelled in the same commit that renders the content.
  it('cancels the show-timer in the same commit that renders content, before a timer can come due', async () => {
    vi.useFakeTimers()
    let finishLoading: () => void = () => undefined
    function Screen() {
      const [isLoading, setLoading] = useState(true)
      finishLoading = () => setLoading(false)
      const showIndicator = useDeferredLoading(isLoading)
      if (showIndicator) {
        return createElement('div', { 'data-testid': 'indicator' })
      }
      return isLoading ? null : createElement('div', { 'data-testid': 'content' })
    }
    render(createElement(Screen))

    // Resolved from a MutationObserver callback, which runs in the microtask checkpoint right after
    // the task that committed the content -- before React's next scheduled task.
    const contentCommitted = new Promise<void>((resolve) => {
      const observer = new MutationObserver(() => {
        if (screen.queryByTestId('content') !== null) {
          observer.disconnect()
          resolve()
        }
      })
      observer.observe(document.body, { childList: true, subtree: true })
    })
    const actEnvironment = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    const wasActEnvironment = actEnvironment.IS_REACT_ACT_ENVIRONMENT
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = false
    try {
      // Outside act, like a fetch result arriving while `findBy*` polls: a non-synchronous update.
      finishLoading()
      await contentCommitted
    } finally {
      actEnvironment.IS_REACT_ACT_ENVIRONMENT = wasActEnvironment
    }

    // The delay elapses at exactly this point, with the content already in the DOM.
    act(() => {
      vi.advanceTimersByTime(DEFAULT_DELAY_MS)
    })
    expect(screen.queryByTestId('indicator')).not.toBeInTheDocument()
    expect(screen.getByTestId('content')).toBeInTheDocument()
  })
})
