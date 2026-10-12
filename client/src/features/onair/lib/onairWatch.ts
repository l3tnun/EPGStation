import { BROADCAST_WAVE_ORDER, type BroadcastWave } from '@/app/navigation'
import type { GuideReserveIndex } from '@/features/guide/guideRequests'
import {
  EMPTY_SCHEDULE_RETRY_DELAY_MS,
  LIVE_STREAM_TYPE_QUERY,
  MAX_UPDATE_DELAY_MS,
  ONAIR_QUERY_KEY,
  ONAIR_WATCH_INFO_QUERY_KEY,
  type LiveStreamType,
  type OnAirLiveStreamInfoItem,
  type OnAirRequest,
  type OnAirReserveIndex,
  type OnAirReserveItem,
  type OnAirReserveLists,
  type OnAirReserveVisualState,
  type OnAirTimerSchedule,
  type OnAirWatchInfoDisplay,
} from './onairRequestTypes'
import { formatWatchInfoTime } from './onairStreams'

export function buildOnAirWatchRoute({
  type,
  channelId,
  mode,
}: {
  type: LiveStreamType
  channelId: number
  mode: number
}): string {
  const parameters = new URLSearchParams()
  parameters.set('type', LIVE_STREAM_TYPE_QUERY[type])
  parameters.set('channel', String(channelId))
  parameters.set('mode', String(mode))

  return `/onair/watch?${parameters.toString()}`
}

export function resolveWatchInfoDisplay({
  items,
  channelId,
  mode,
  channelName,
}: {
  items: readonly OnAirLiveStreamInfoItem[]
  channelId: number
  mode: number
  channelName?: string
}): OnAirWatchInfoDisplay | null {
  const item = items.find((entry) => entry.channelId === channelId && entry.mode === mode)

  if (item === undefined || item.endAt === undefined) {
    return null
  }

  return {
    channelName: channelName ?? item.channelName ?? String(channelId),
    time: formatWatchInfoTime(item.startAt, item.endAt),
    name: item.name ?? '',
    description: item.description ?? '',
    endAt: item.endAt,
  }
}

export function resolveWatchInfoUpdateDelay({
  item,
  now,
}: {
  item: Pick<OnAirLiveStreamInfoItem, 'endAt'> | undefined
  now: number
}): number {
  if (item?.endAt === undefined) {
    return 1000
  }

  const delay = item.endAt - now

  return delay <= 0 ? 1000 : delay
}

export function createOnAirQueryKey(request: OnAirRequest) {
  return [...ONAIR_QUERY_KEY, request] as const
}

export function createOnAirWatchInfoQueryKey(input: {
  request: OnAirRequest
  watchParam: unknown
}) {
  return [...ONAIR_WATCH_INFO_QUERY_KEY, input] as const
}

export function writeReserveIndex(
  index: OnAirReserveIndex,
  state: OnAirReserveVisualState,
  items: readonly OnAirReserveItem[],
): void {
  items.forEach((item) => {
    if (item.programId === undefined) {
      return
    }

    index[item.programId] = {
      type: state,
      item,
    }
  })
}

export function transformOnAirReserveListsToIndex(lists: OnAirReserveLists): OnAirReserveIndex {
  const index: OnAirReserveIndex = {}

  writeReserveIndex(index, 'reserve', lists.normal)
  writeReserveIndex(index, 'conflict', lists.conflicts)
  writeReserveIndex(index, 'skip', lists.skips)
  writeReserveIndex(index, 'overlap', lists.overlaps)

  return index
}

export function adaptOnAirReserveIndexForProgramDialog(
  index: OnAirReserveIndex,
): GuideReserveIndex {
  return Object.fromEntries(
    Object.entries(index).map(([programId, reserve]) => [
      programId,
      {
        type: reserve.type,
        item: {
          id: reserve.item.reserveId,
          ...(reserve.item.programId === undefined ? {} : { programId: reserve.item.programId }),
          ...(reserve.item.ruleId === undefined ? {} : { ruleId: reserve.item.ruleId }),
        },
      },
    ]),
  )
}

export function resolveEnabledOnAirTabs(
  enabledBroadcastWaves: readonly BroadcastWave[],
): BroadcastWave[] {
  const enabledWaves = new Set(enabledBroadcastWaves)

  return BROADCAST_WAVE_ORDER.filter((wave) => enabledWaves.has(wave))
}

export function resolveOnAirUpdateDelay(
  schedules: readonly OnAirTimerSchedule[],
  now: number,
): number {
  if (schedules.length === 0) {
    return EMPTY_SCHEDULE_RETRY_DELAY_MS
  }

  const nextDelay = schedules.reduce((minDelay, schedule) => {
    const endAt = schedule.programs?.[0]?.endAt

    if (endAt === undefined) {
      return minDelay
    }

    return Math.min(minDelay, endAt - now)
  }, MAX_UPDATE_DELAY_MS)

  return Math.max(0, nextDelay)
}

export function clampOnAirProgress(value: number): number {
  if (!Number.isFinite(value)) {
    return 0
  }

  return Math.min(100, Math.max(0, value))
}

export function calculateOnAirProgress({
  now,
  startAt,
  endAt,
}: {
  now: number
  startAt?: number
  endAt?: number
}): number {
  if (startAt === undefined || endAt === undefined || endAt <= startAt) {
    return 0
  }

  return clampOnAirProgress(((now - startAt) / (endAt - startAt)) * 100)
}
