import type { MouseEvent } from 'react'
import type { SettingsConsumerValue } from '@/shared/settings'
import type { RecordedListItem, RecordedSearchOptionItem } from '../recordedApi'
import { formatRecordedFileSize } from '../recordedRequests'
import { SUB_GENRE_NAMES as RECORDED_SUB_GENRE_NAMES } from '@/features/search/rule/genreLabels'

export type RecordedLayout = 'table' | 'large-card' | 'small-card'

// v2 `components/recorded/RecordedItems.vue` は `cardNum = floor(clientWidth / (CARD_WIDTH 300 +
// CARD_MARGIN 8))` を ResizeObserver で求め、`cardNum > 1` のときだけ large card / table を描く
// （同 file の 3 行目と 16 行目、91 行目、119-120 行目）。`floor(w / 308) > 1` を解くと境界は 616px。
const RECORDED_TWO_CARD_LAYOUT_MIN_WIDTH = 616

const GENRE_NAMES: Record<number, string> = {
  0: 'ニュース・報道',
  1: 'スポーツ',
  2: '情報・ワイドショー',
  3: 'ドラマ',
  4: '音楽',
  5: 'バラエティ',
  6: '映画',
  7: 'アニメ・特撮',
  8: 'ドキュメンタリー・教養',
  9: '劇場・公演',
  10: '趣味・教育',
  11: '福祉',
  12: '予備',
  13: '予備',
  14: '拡張',
  15: 'その他',
}

export function resolveRecordedLayout(
  viewportWidth: number,
  settings: SettingsConsumerValue,
): RecordedLayout {
  const canShowTwoCards = viewportWidth >= RECORDED_TWO_CARD_LAYOUT_MIN_WIDTH

  if (settings.isShowTableMode && canShowTwoCards) {
    return 'table'
  }

  return canShowTwoCards ? 'large-card' : 'small-card'
}

export function itemLabel(item: RecordedListItem, index: number): string {
  return item.name ?? `#${item.id ?? index + 1}`
}

// `frontend-settings-storage` AC6/AC8: `isHalfWidthDisplayed` is the shared channel display
// contract, referenced here the same way `RecordedUploadPage` resolves its channel option label.
// `channel.name`/`channel.halfWidthName` already carry the `(count)` suffix from
// `adaptRecordedSearchOptions`; this only selects which of the two to show.
export function resolveRecordedSearchChannelLabel(
  channel: RecordedSearchOptionItem,
  isHalfWidthDisplayed: boolean,
): string {
  return isHalfWidthDisplayed ? (channel.halfWidthName ?? channel.name) : channel.name
}

export function recordedId(item: RecordedListItem): number | undefined {
  return item.id
}

export function videoFileId(file: { id?: number }): number | undefined {
  return file.id
}

export function isInteractiveItemClick(event: MouseEvent<HTMLElement>): boolean {
  return event.target instanceof Element
    ? event.target.closest('button,input,label,[role="menuitem"]') !== null
    : false
}

export function itemSecondaryText(item: RecordedListItem, settings: SettingsConsumerValue): string {
  const dropLogFile = item.dropLogFile

  if (
    dropLogFile !== undefined &&
    settings.isShowDropInfoInsteadOfDescription &&
    item.isRecording !== true
  ) {
    const totalSize = item.videoFiles?.reduce((sum, file) => sum + (file.size ?? 0), 0) ?? 0
    const sizeText = ` ${formatRecordedFileSize(totalSize)}`

    return `${dropLogFile.dropCnt}/${dropLogFile.errorCnt}/${dropLogFile.scramblingCnt}${sizeText}`
  }

  return item.description ?? item.extended ?? ''
}

export function shouldShowRecordedListDropInfo(
  item: RecordedListItem,
  settings: SettingsConsumerValue,
): boolean {
  return (
    settings.isShowDropInfoInsteadOfDescription &&
    item.isRecording !== true &&
    item.dropLogFile !== undefined
  )
}

export function formatRecordedDropInfo(item: RecordedListItem): string | null {
  if (item.isRecording === true || item.dropLogFile === undefined) {
    return null
  }

  const totalSize = item.videoFiles?.reduce((sum, file) => sum + (file.size ?? 0), 0) ?? 0
  const sizeText = ` ${formatRecordedFileSize(totalSize)}`

  return `drop: ${item.dropLogFile.dropCnt}, error: ${item.dropLogFile.errorCnt}, scrambling: ${item.dropLogFile.scramblingCnt}${sizeText}`
}

export function hasRecordedDropError(item: RecordedListItem): boolean {
  const dropLogFile = item.dropLogFile

  return (
    dropLogFile !== undefined &&
    item.isRecording !== true &&
    (dropLogFile.dropCnt >= 1 || dropLogFile.errorCnt >= 1 || dropLogFile.scramblingCnt >= 1)
  )
}

function formatRecordedGenre(
  genre: number | undefined,
  subGenre: number | undefined,
): string | null {
  if (genre === undefined) {
    return null
  }

  const genreName = GENRE_NAMES[genre]
  if (genreName === undefined) {
    return null
  }

  const subGenreName =
    subGenre === undefined ? undefined : RECORDED_SUB_GENRE_NAMES[genre]?.[subGenre]
  return subGenreName === undefined ? genreName : `${genreName} / ${subGenreName}`
}

export function formatRecordedDetailGenres(item: RecordedListItem): readonly string[] {
  const genre =
    formatRecordedGenre(item.genre1, item.subGenre1) ??
    formatRecordedGenre(item.genre2, item.subGenre2) ??
    formatRecordedGenre(item.genre3, item.subGenre3)

  if (genre !== null) {
    return [genre]
  }

  if (item.genres !== undefined && item.genres.length > 0) {
    return [item.genres[0]]
  }

  return []
}

export function formatRecordedDetailTime(item: RecordedListItem): string {
  if (item.startAt === undefined || item.endAt === undefined) {
    return ''
  }

  const start = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(item.startAt))
  const end = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(item.endAt))
  const duration = Math.max(0, Math.round((item.endAt - item.startAt) / 60000))

  return `${start} ~ ${end} (${duration} m)`
}

export function formatRecordedListTime(item: RecordedListItem): string {
  return formatRecordedDetailTime(item)
}

export function formatRecordedTableTime(item: RecordedListItem): string {
  if (item.startAt === undefined || item.endAt === undefined) {
    return ''
  }

  const start = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(item.startAt))
  const duration = Math.max(0, Math.round((item.endAt - item.startAt) / 60000))

  return `${start} (${duration} m)`
}
