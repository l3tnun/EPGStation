import type { RecordedListItem } from '@/features/recorded/recordedApi'

export const RECORDING_MENU_ACTION_DELAY_MS = 100
export const RECORDING_CARD_LAYOUT_MAX_WIDTH = 600

export function itemId(item: RecordedListItem): number | undefined {
  return item.id
}

export function itemLabel(item: RecordedListItem, index: number): string {
  return item.name ?? `#${item.id ?? index + 1}`
}

export function itemChannel(item: RecordedListItem): string {
  return item.channelName ?? (item.channelId === undefined ? '' : item.channelId.toString(10))
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

function formatJaDate(timestamp: number): Date {
  const date = new Date(timestamp)
  return new Date(date.getTime() + date.getTimezoneOffset() * 60 * 1000 + 9 * 60 * 60 * 1000)
}

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土']

export function formatShortTime(item: RecordedListItem): string {
  if (item.startAt === undefined || item.endAt === undefined) {
    return ''
  }

  const start = formatJaDate(item.startAt)
  const duration = Math.floor((item.endAt - item.startAt) / 1000 / 60)

  return `${pad2(start.getMonth() + 1)}/${pad2(start.getDate())}(${WEEKDAYS[start.getDay()]}) ${pad2(start.getHours())}:${pad2(start.getMinutes())} (${duration} m)`
}

export function formatFullTime(item: RecordedListItem): string {
  if (item.startAt === undefined || item.endAt === undefined) {
    return ''
  }

  const start = formatJaDate(item.startAt)
  const end = formatJaDate(item.endAt)
  const duration = Math.floor((item.endAt - item.startAt) / 1000 / 60)

  return `${pad2(start.getMonth() + 1)}/${pad2(start.getDate())}(${WEEKDAYS[start.getDay()]}) ${pad2(start.getHours())}:${pad2(start.getMinutes())} ~ ${pad2(end.getHours())}:${pad2(end.getMinutes())} (${duration} m)`
}

export const RECORDING_CARD_LAYOUT_MEDIA_QUERY = `(max-width: ${RECORDING_CARD_LAYOUT_MAX_WIDTH}px)`

// This must decide the card-vs-table layout with the exact same basis
// RecordingPage.module.css's `@media (max-width: 600px)` uses to show/hide `.recordingCards` and
// `.recordingTableCard`, or the two can disagree: a JS width read (innerWidth, or
// document.documentElement.clientWidth, which EXCLUDES a classic scrollbar's gutter) can fall on
// one side of 600px while the CSS media feature (evaluated against the viewport INCLUDING the
// scrollbar gutter on desktop) falls on the other. At innerWidth 601-615px with a classic
// scrollbar (clientWidth ~590-600px) that mismatch would render nothing: JS picks the card
// layout (clientWidth <= 600) but the CSS media query does not match (610 > 600), so
// `.recordingCards { display: none }` (its unconditional default) applies while the table is
// never rendered at all. Using the same `matchMedia` query the CSS itself uses removes any
// possibility of disagreement.
export function readIsCardLayout(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false
  }

  return window.matchMedia(RECORDING_CARD_LAYOUT_MEDIA_QUERY).matches
}
