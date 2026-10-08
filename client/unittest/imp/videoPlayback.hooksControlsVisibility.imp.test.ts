import type { MutableRefObject, PointerEvent } from 'react'
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { usePlaybackControlsVisibility } from '@/features/video/playback/hooks/usePlaybackControlsVisibility'

function ref<T>(value: T): MutableRefObject<T> {
  return { current: value }
}

function makePointerEvent(
  target: EventTarget,
  currentTarget: EventTarget,
): PointerEvent<HTMLElement> {
  return { target, currentTarget } as unknown as PointerEvent<HTMLElement>
}

describe('usePlaybackControlsVisibility contract', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('does not schedule a hide timer while controls are blocked', () => {
    vi.useFakeTimers()
    const isPausedRef = ref(false)
    const { result } = renderHook(() =>
      usePlaybackControlsVisibility({
        initialControlsVisible: true,
        areControlsBlocked: true,
        isPaused: false,
        isPausedRef,
        isMobilePlatform: false,
      }),
    )

    act(() => {
      result.current.scheduleControlsHide()
    })
    act(() => {
      vi.advanceTimersByTime(3000)
    })

    // Blocked controls are already forced hidden by the block-state effect, and the
    // scheduleControlsHide() call above must not have queued a timer of its own.
    expect(result.current.controlsVisible).toBe(false)
  })

  it('[AC 4.16] cancels the hide timeout without hiding controls when playback is paused before it fires', () => {
    vi.useFakeTimers()
    const isPausedRef = ref(false)
    const { result, rerender } = renderHook(
      ({ isPaused }) =>
        usePlaybackControlsVisibility({
          initialControlsVisible: true,
          areControlsBlocked: false,
          isPaused,
          isPausedRef,
          isMobilePlatform: false,
        }),
      { initialProps: { isPaused: false } },
    )

    act(() => {
      result.current.scheduleControlsHide({ force: true })
    })
    // Playback pauses after the timer was scheduled but before it fires.
    isPausedRef.current = true
    rerender({ isPaused: true })

    act(() => {
      vi.advanceTimersByTime(3000)
    })

    expect(result.current.controlsVisible).toBe(true)
    expect(result.current.isCursorHidden).toBe(false)
  })

  it('[AC 4.16] hides controls and the cursor once the hide timer elapses while still playing', () => {
    vi.useFakeTimers()
    const isPausedRef = ref(false)
    const { result } = renderHook(() =>
      usePlaybackControlsVisibility({
        initialControlsVisible: true,
        areControlsBlocked: false,
        isPaused: false,
        isPausedRef,
        isMobilePlatform: false,
      }),
    )

    act(() => {
      result.current.scheduleControlsHide({ force: true })
    })
    act(() => {
      vi.advanceTimersByTime(3000)
    })

    expect(result.current.controlsVisible).toBe(false)
    expect(result.current.isCursorHidden).toBe(true)
  })

  it('does not reveal controls via mouse/pointer move while controls are blocked', () => {
    const isPausedRef = ref(false)
    const { result } = renderHook(() =>
      usePlaybackControlsVisibility({
        initialControlsVisible: false,
        areControlsBlocked: true,
        isPaused: false,
        isPausedRef,
        isMobilePlatform: false,
      }),
    )

    act(() => {
      result.current.handleMouseMove()
    })

    expect(result.current.controlsVisible).toBe(false)
  })

  it('[AC 4.16a] ignores pointerdown while controls are blocked', () => {
    const isPausedRef = ref(false)
    const { result } = renderHook(() =>
      usePlaybackControlsVisibility({
        initialControlsVisible: false,
        areControlsBlocked: true,
        isPaused: false,
        isPausedRef,
        isMobilePlatform: true,
      }),
    )

    const target = document.createElement('div')
    act(() => {
      result.current.handlePointerDown(makePointerEvent(target, target))
    })

    expect(result.current.controlsVisible).toBe(false)
  })

  it('[AC 4.16] reveals controls on non-mobile pointerdown outside interactive controls', () => {
    const isPausedRef = ref(false)
    const { result } = renderHook(() =>
      usePlaybackControlsVisibility({
        initialControlsVisible: false,
        areControlsBlocked: false,
        isPaused: true,
        isPausedRef,
        isMobilePlatform: false,
      }),
    )

    const target = document.createElement('div')
    act(() => {
      result.current.handlePointerDown(makePointerEvent(target, target))
    })

    expect(result.current.controlsVisible).toBe(true)
    expect(result.current.isCursorHidden).toBe(false)
  })

  it('ignores mouse move reveal on mobile/coarse-pointer platforms', () => {
    const isPausedRef = ref(false)
    const { result } = renderHook(() =>
      usePlaybackControlsVisibility({
        initialControlsVisible: false,
        areControlsBlocked: false,
        isPaused: false,
        isPausedRef,
        isMobilePlatform: true,
      }),
    )

    act(() => {
      result.current.handleMouseMove()
    })

    expect(result.current.controlsVisible).toBe(false)
  })

  it('ignores mouseleave on mobile/coarse-pointer platforms', () => {
    const isPausedRef = ref(false)
    const { result } = renderHook(() =>
      usePlaybackControlsVisibility({
        initialControlsVisible: true,
        areControlsBlocked: false,
        isPaused: false,
        isPausedRef,
        isMobilePlatform: true,
      }),
    )

    act(() => {
      result.current.handleMouseLeave()
    })

    // Mobile platforms never receive mouseleave-driven hides.
    expect(result.current.controlsVisible).toBe(true)
  })

  it('[AC 4.16a] does not propagate an interactive-target pointerdown into the toggle behavior', () => {
    const isPausedRef = ref(false)
    const { result } = renderHook(() =>
      usePlaybackControlsVisibility({
        initialControlsVisible: false,
        areControlsBlocked: false,
        isPaused: false,
        isPausedRef,
        isMobilePlatform: false,
      }),
    )

    const wrap = document.createElement('div')
    const button = document.createElement('button')
    wrap.appendChild(button)
    act(() => {
      result.current.handlePointerDown(makePointerEvent(button, wrap))
    })

    expect(result.current.controlsVisible).toBe(false)
  })
})
