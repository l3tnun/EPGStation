import { useLayoutEffect, useRef, useState, type RefObject } from 'react'

/**
 * Measures a DOM element's `clientWidth` via `ResizeObserver`, mirroring the v2 pattern used by
 * `ReserveItems.vue` / `RuleItems.vue` / `RecordedItems.vue` (each reads `this.$el.clientWidth`
 * from a `ResizeObserver` callback) instead of relying on the window/app-shell viewport width.
 *
 * A permanent navigation drawer narrows the actual content area without changing the viewport
 * width, so a layout decision keyed on viewport width can disagree with one keyed on the real
 * rendered container width. Measuring the container directly removes that gap regardless of the
 * cause (drawer offset, page padding, or anything else narrower than the viewport).
 *
 * Returns `undefined` until a real measurement lands. jsdom has no `ResizeObserver`, so under
 * test this always stays `undefined` -- callers are expected to fall back to an explicit
 * override (or a static default) in that case.
 */
export function useMeasuredContainerWidth<T extends HTMLElement>(): [
  RefObject<T | null>,
  number | undefined,
] {
  const ref = useRef<T | null>(null)
  const [width, setWidth] = useState<number | undefined>(undefined)

  useLayoutEffect(() => {
    const element = ref.current

    /* v8 ignore next 3 -- jsdom has no ResizeObserver; this path only runs in a real browser */
    if (element === null || typeof ResizeObserver === 'undefined') {
      return () => undefined
    }

    const observer = new ResizeObserver(() => {
      setWidth(element.clientWidth)
    })
    observer.observe(element)

    return () => observer.disconnect()
  }, [])

  return [ref, width]
}
