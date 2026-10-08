import { useEffect, useLayoutEffect, useRef, useState } from 'react'

export interface UseDeferredLoadingOptions {
  /**
   * Time (ms) `isLoading` must stay `true` before the returned indicator flips
   * to `true`. A fetch that finishes before this elapses never shows a
   * loading indicator at all.
   *
   * Default 200ms. Nielsen Norman Group's response-time guidance treats
   * anything under ~100ms as perceived by users as instantaneous
   * (https://www.nngroup.com/articles/response-times-3-important-limits/).
   * 200ms adds margin above that "instantaneous" line so genuinely fast
   * (e.g. same-machine/LAN) API responses never flash a loading indicator,
   * matching the European Commission Component Library's guidance to only
   * show a loading indicator once a wait exceeds ~200ms
   * (https://ec.europa.eu/component-library/ec/components/loading-indicator/usage).
   */
  delayMs?: number
  /**
   * Once the indicator has become visible, the minimum time (ms) it stays
   * visible even if `isLoading` turns `false` in the meantime.
   *
   * Default 200ms, matching the widely used `spin-delay` React hook's
   * `minDuration` default (https://github.com/smeijer/spin-delay). Without
   * this, a fetch that finishes shortly after `delayMs` (e.g. delayMs +
   * 10ms) would flash the indicator for ~10ms -- its own kind of flicker,
   * called out explicitly in that project's own documentation.
   */
  minDurationMs?: number
}

const DEFAULT_DELAY_MS = 200
const DEFAULT_MIN_DURATION_MS = 200

export { DEFAULT_DELAY_MS, DEFAULT_MIN_DURATION_MS }

/**
 * Debounces a raw `isLoading` boolean into one suitable for driving a
 * *visible* loading indicator, without flashing on fast responses.
 *
 * - If `isLoading` becomes `false` again before `delayMs` elapses, the
 *   indicator never appears.
 * - Once shown, the indicator stays visible for at least `minDurationMs`,
 *   even if `isLoading` turns `false` sooner. This is a fixed-duration timer
 *   started the moment the indicator becomes visible -- not a computation
 *   against wall-clock time -- so behavior stays exact under both real and
 *   fake (test) timers.
 *
 * This hook governs *display only*. Callers that need the raw, undelayed
 * loading state for correctness (for example, disabling a submit button
 * while a fetch is in flight, or gating scroll-restoration readiness) must
 * keep reading their own `isLoading` value directly instead of this hook's
 * return value.
 */
export function useDeferredLoading(
  isLoading: boolean,
  options: UseDeferredLoadingOptions = {},
): boolean {
  const { delayMs = DEFAULT_DELAY_MS, minDurationMs = DEFAULT_MIN_DURATION_MS } = options
  const [isVisible, setVisible] = useState(false)
  // Mirrors `isVisible` synchronously (state updates are only visible to
  // this effect on the next render). Read instead of the state value below
  // so the effect doesn't need `isVisible` in its dependency array -- adding
  // it there would make the effect re-run, and re-cancel its own
  // just-started min-duration timer, every time `setVisible(true)` fires.
  const isVisibleRef = useRef(false)
  // Set once the min-duration timer (started when the indicator became
  // visible) has fired. `hasPendingHideRef` records that `isLoading` turned
  // false while that timer was still running, so the timer's own callback
  // can perform the hide instead of a second, independently-computed timer.
  const isMinDurationElapsedRef = useRef(true)
  const hasPendingHideRef = useRef(false)
  // Deliberately NOT cleared by the isLoading-keyed effect below: this timer
  // must keep running across an isLoading `true -> false` transition to
  // enforce the minimum hold time. Only real unmount (the second effect)
  // clears it early.
  const minDurationTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  // A layout effect, not a passive one: the caller renders its content in the same commit that
  // turns `isLoading` false, and React writes that commit to the DOM before it runs the commit's
  // passive effects when the update is not synchronous (a query result, for example). With a
  // passive effect the show-timer below stays armed across that gap, so a timer coming due inside
  // it would raise the indicator over content that is already on screen and keep it there for the
  // whole minimum hold time. The layout effect's cleanup runs within the commit itself, so the
  // show-timer is cancelled before any other task can run.
  useLayoutEffect(() => {
    if (isLoading) {
      hasPendingHideRef.current = false

      const showTimer = setTimeout(() => {
        isMinDurationElapsedRef.current = false
        isVisibleRef.current = true
        setVisible(true)

        minDurationTimerRef.current = setTimeout(() => {
          isMinDurationElapsedRef.current = true
          minDurationTimerRef.current = undefined
          if (hasPendingHideRef.current) {
            hasPendingHideRef.current = false
            isVisibleRef.current = false
            setVisible(false)
          }
        }, minDurationMs)
      }, delayMs)

      return () => clearTimeout(showTimer)
    }

    // isLoading is false.
    if (!isVisibleRef.current) {
      // Never became visible (resolved within delayMs) -- nothing to hide.
      return
    }

    if (isMinDurationElapsedRef.current) {
      isVisibleRef.current = false
      setVisible(false)
      return
    }

    // Still within the minimum hold time: let the running min-duration
    // timer (started above) perform the hide once it fires.
    hasPendingHideRef.current = true
  }, [isLoading, delayMs, minDurationMs])

  useEffect(
    () => () => {
      if (minDurationTimerRef.current !== undefined) {
        clearTimeout(minDurationTimerRef.current)
      }
    },
    [],
  )

  return isVisible
}
