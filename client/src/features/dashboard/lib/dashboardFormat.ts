import type { RecordedListItem } from '@/features/recorded/recordedApi'
import type { ReserveListItemModel } from '@/features/reserves'
import type { SettingsConsumerValue } from '@/shared/settings'

export function preventIOSScrollChainAtBounds(element: HTMLElement): () => void {
  let startY = 0
  const isIOSFixedShell = () => document.documentElement.classList.contains('fix-address-bar2')
  const isElementScrollable = () => element.scrollHeight > element.clientHeight + 1
  const handleTouchStart = (event: TouchEvent) => {
    startY = event.touches[0]?.clientY ?? 0
  }
  const handleTouchMove = (event: TouchEvent) => {
    if (!isIOSFixedShell() || !isElementScrollable()) {
      return
    }

    const currentY = event.touches[0]?.clientY ?? startY
    const deltaY = currentY - startY
    const isAtTop = element.scrollTop <= 0
    const isAtBottom = element.scrollTop + element.clientHeight >= element.scrollHeight - 1

    if (event.cancelable && ((isAtTop && deltaY > 0) || (isAtBottom && deltaY < 0))) {
      event.preventDefault()
    }
  }

  element.addEventListener('touchstart', handleTouchStart, { passive: true })
  element.addEventListener('touchmove', handleTouchMove, { passive: false })

  return () => {
    element.removeEventListener('touchstart', handleTouchStart)
    element.removeEventListener('touchmove', handleTouchMove)
  }
}

export function buildDashboardMoreTarget(path: '/recording' | '/recorded' | '/reserves'): string {
  return `${path}?page=2&timestamp=${Date.now()}`
}

export function buildDashboardConflictTarget(): string {
  return `/reserves?type=conflict&timestamp=${Date.now()}`
}

export function itemLabel(item: RecordedListItem | ReserveListItemModel, index: number): string {
  return item.name ?? `#${item.id ?? index + 1}`
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

function getJapanDateParts(timestamp: number) {
  const parts = new Intl.DateTimeFormat('ja-JP', {
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    month: '2-digit',
    timeZone: 'Asia/Tokyo',
    weekday: 'short',
  }).formatToParts(new Date(timestamp))
  const find = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? ''

  return {
    month: Number(find('month')),
    day: Number(find('day')),
    weekday: find('weekday'),
    hour: Number(find('hour')),
    minute: Number(find('minute')),
  }
}

function formatRange(startAt: number, endAt: number, durationSuffix: string): string {
  const start = getJapanDateParts(startAt)
  const end = getJapanDateParts(endAt)
  const duration = Math.floor((endAt - startAt) / 1000 / 60)

  return `${pad2(start.month)}/${pad2(start.day)}(${start.weekday}) ${pad2(
    start.hour,
  )}:${pad2(start.minute)} ~ ${pad2(end.hour)}:${pad2(end.minute)} (${duration}${durationSuffix})`
}

export function formatDashboardTimeRange({
  startAt,
  endAt,
}: {
  startAt?: number
  endAt?: number
}): string | undefined {
  if (startAt === undefined || endAt === undefined) {
    return undefined
  }

  return formatRange(startAt, endAt, ' m')
}

export function formatDashboardReserveTimeRange(item: ReserveListItemModel): string | undefined {
  if (item.startAt === undefined || item.endAt === undefined) {
    return undefined
  }

  return formatRange(item.startAt, item.endAt, '分')
}

export function recordedSecondaryText(
  item: RecordedListItem,
  settings: SettingsConsumerValue,
): string {
  if (settings.isShowDropInfoInsteadOfDescription && item.dropLogFile !== undefined) {
    const totalSize = item.videoFiles?.reduce((sum, file) => sum + (file.size ?? 0), 0) ?? 0
    const sizeText = totalSize > 0 ? ` ${totalSize} bytes` : ''

    return `${item.dropLogFile.dropCnt}/${item.dropLogFile.errorCnt}/${item.dropLogFile.scramblingCnt}${sizeText}`
  }

  return item.description ?? item.extended ?? ''
}

export function recordedMetadataLines(item: RecordedListItem): readonly string[] {
  return [
    item.channelName ?? (item.channelId === undefined ? undefined : `channel ${item.channelId}`),
    formatDashboardTimeRange(item),
  ].filter((line): line is string => line !== undefined && line !== '')
}

export function reserveChannelLine(item: ReserveListItemModel): string | undefined {
  return (
    item.channelName ?? (item.channelId === undefined ? undefined : `channel ${item.channelId}`)
  )
}
