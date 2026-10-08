import type { ShellSnackbarState } from '@/app/AppShell'
import type { BroadcastWave } from '@/app/navigation'
import { resolveLegacyGenre } from '@/features/guide/ProgramDialog'
import type { ReserveListItem as ReserveListItemModel } from './reservesApiTypes'
import { pad2 } from './reserveEndpoint'

export type ReserveBroadcastWaveResolver = (channelId: number) => BroadcastWave | undefined

export function reserveLabel(item: ReserveListItemModel, index?: number): string {
  return item.name ?? `#${item.id ?? (index ?? 0) + 1}`
}

export function reserveChannelLabel(item: ReserveListItemModel): string | undefined {
  if (item.channelName !== undefined) {
    return item.channelName
  }

  return item.channelId === undefined ? undefined : `channel ${item.channelId}`
}

export function reserveGenreLabels(item: ReserveListItemModel): readonly string[] {
  if (
    item.genres !== undefined &&
    item.genres.length > 0 &&
    !item.genres.every((genre) => /^genre \d/.test(genre))
  ) {
    return item.genres
  }

  return [
    resolveLegacyGenre(item.genre1, item.subGenre1),
    resolveLegacyGenre(item.genre2, item.subGenre2),
    resolveLegacyGenre(item.genre3, item.subGenre3),
  ].filter((genre): genre is string => genre !== null)
}

export function formatReserveDate(value?: number): string {
  if (value === undefined) {
    return ''
  }

  const parts = new Intl.DateTimeFormat('ja-JP', {
    day: '2-digit',
    month: '2-digit',
    timeZone: 'Asia/Tokyo',
    weekday: 'short',
  }).formatToParts(new Date(value))
  const find = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? ''

  return `${pad2(Number(find('month')))}/${pad2(Number(find('day')))}(${find('weekday')})`
}

export function formatReserveTableTimeParts({
  startAt,
  endAt,
}: ReserveListItemModel): { range: string; duration: string } | null {
  if (startAt === undefined || endAt === undefined) {
    return null
  }

  const formatter = new Intl.DateTimeFormat('ja-JP', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Tokyo',
  })
  const duration = Math.floor((endAt - startAt) / 1000 / 60)

  return {
    range: `${formatter.format(new Date(startAt))}~${formatter.format(new Date(endAt))}`,
    duration: `(${duration}m)`,
  }
}

function formatReserveDayTimeRange(
  { startAt, endAt }: ReserveListItemModel,
  durationUnit: string,
): string {
  if (startAt === undefined || endAt === undefined) {
    return ''
  }

  const dayParts = new Intl.DateTimeFormat('ja-JP', {
    day: '2-digit',
    month: '2-digit',
    timeZone: 'Asia/Tokyo',
    weekday: 'short',
  }).formatToParts(new Date(startAt))
  const timeFormatter = new Intl.DateTimeFormat('ja-JP', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Tokyo',
  })
  const find = (type: Intl.DateTimeFormatPartTypes) =>
    dayParts.find((part) => part.type === type)?.value ?? ''
  const duration = Math.floor((endAt - startAt) / 1000 / 60)

  return `${pad2(Number(find('month')))}/${pad2(Number(find('day')))}(${find(
    'weekday',
  )}) ${timeFormatter.format(new Date(startAt))} ~ ${timeFormatter.format(
    new Date(endAt),
  )} (${duration}${durationUnit})`
}

export function formatReserveDialogTimeRange(item: ReserveListItemModel): string {
  return formatReserveDayTimeRange(item, 'm')
}

export function formatReserveCardTimeRange(item: ReserveListItemModel): string {
  return formatReserveDayTimeRange(item, '分')
}

export function resolveDialogBroadcastWave({
  isEnableDisplayForEachBroadcastWave,
  reserve,
  resolveBroadcastWave,
}: {
  isEnableDisplayForEachBroadcastWave: boolean
  reserve: ReserveListItemModel
  resolveBroadcastWave?: ReserveBroadcastWaveResolver
}): BroadcastWave | undefined {
  if (
    !isEnableDisplayForEachBroadcastWave ||
    reserve.channelId === undefined ||
    resolveBroadcastWave === undefined
  ) {
    return undefined
  }

  return resolveBroadcastWave(reserve.channelId)
}

export function openReserveSnackbar(
  onSnackbar: (snackbar: ShellSnackbarState) => void,
  text: string,
  severity: ShellSnackbarState['severity'] = 'success',
): void {
  onSnackbar({ text, severity })
}
