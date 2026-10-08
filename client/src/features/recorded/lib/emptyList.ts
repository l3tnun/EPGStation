import type { RecordedListItem } from '../recordedApi'

/**
 * Stable empty list for optional array props. A per-render `[]` default would change identity on
 * every render and re-trigger effects that reset dialog state whenever the parent re-renders.
 */
export const EMPTY_STRING_LIST: readonly string[] = []

/**
 * Stable empty records list, used while `RecordedPage`'s query has no data yet. Keeping identity
 * stable (instead of a fresh `[]` per render) lets the visible-id `useMemo` it feeds skip
 * recomputation and keeps the selection-narrowing effect from re-running every render.
 */
export const EMPTY_RECORDED_ITEMS: readonly RecordedListItem[] = []
