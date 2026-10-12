import type { FeatureResult } from '@/app/serverApi'
import type { RecordedListItem } from '@/features/recorded/recordedApi'
import type { SettingsConsumerValue } from '@/shared/settings'

export interface EncodeListRequest {
  isHalfWidth: boolean
}

export interface EncodeProgramItem {
  id: number
  mode: string
  recorded: RecordedListItem
  percent?: number
  log?: string
}

export interface EncodeListResponse {
  runningItems: EncodeProgramItem[]
  waitItems: EncodeProgramItem[]
}

export interface EncodeDisplayItem {
  id: number
  title: string
  mode: string
  channelName?: string
  thumbnailPath: string | null
  timeText?: string
  durationText?: string
  progressText?: string
  progressValue?: number
  source: EncodeProgramItem
}

export interface EncodeSectionItems {
  running: EncodeDisplayItem[]
  waiting: EncodeDisplayItem[]
}

export interface EncodeCancelRepository {
  cancelEncode(encodeId: number): Promise<FeatureResult<void, 'encode-cancel-failed'>>
}

export const ENCODE_QUERY_KEY = ['encode', 'list'] as const
export const ENCODE_FAILURE_MESSAGE = 'エンコード情報取得に失敗'

export function buildEncodeListRequest({
  settings,
}: {
  settings: Pick<SettingsConsumerValue, 'isHalfWidthDisplayed'>
}): EncodeListRequest {
  return {
    isHalfWidth: settings.isHalfWidthDisplayed,
  }
}

export function buildEncodeListRequestUrl({
  request,
  basePath = './api',
}: {
  request: EncodeListRequest
  basePath?: string
}): string {
  const parameters = new URLSearchParams()
  parameters.set('isHalfWidth', String(request.isHalfWidth))

  return `${basePath.replace(/\/$/, '')}/encode?${parameters.toString()}`
}

export function createEncodeQueryKey({
  settings,
}: {
  settings: Pick<SettingsConsumerValue, 'isHalfWidthDisplayed'>
}) {
  return [...ENCODE_QUERY_KEY, buildEncodeListRequest({ settings })] as const
}

function createDateText(recorded: RecordedListItem): string | undefined {
  if (typeof recorded.startAt !== 'number' || typeof recorded.endAt !== 'number') {
    return undefined
  }

  const start = new Date(recorded.startAt)
  const end = new Date(recorded.endAt)
  const formatter = new Intl.DateTimeFormat('ja-JP', {
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    month: '2-digit',
    weekday: 'short',
  })
  const endFormatter = new Intl.DateTimeFormat('ja-JP', {
    hour: '2-digit',
    minute: '2-digit',
  })

  return `${formatter.format(start)} ~ ${endFormatter.format(end)}`
}

function createDurationText(recorded: RecordedListItem): string | undefined {
  if (typeof recorded.startAt !== 'number' || typeof recorded.endAt !== 'number') {
    return undefined
  }

  return `${Math.floor((recorded.endAt - recorded.startAt) / 1000 / 60)} m`
}

export function createEncodeSectionItems(response: EncodeListResponse): EncodeSectionItems {
  const convert = (item: EncodeProgramItem): EncodeDisplayItem => {
    const display: EncodeDisplayItem = {
      id: item.id,
      title: item.recorded.name ?? `#${item.id}`,
      mode: item.mode,
      channelName: item.recorded.channelName,
      thumbnailPath:
        item.recorded.thumbnails === undefined || item.recorded.thumbnails.length === 0
          ? null
          : `./api/thumbnails/${item.recorded.thumbnails[0]}`,
      timeText: createDateText(item.recorded),
      durationText: createDurationText(item.recorded),
      source: item,
    }

    if (typeof item.percent === 'number' && typeof item.log === 'string') {
      const progressValue = item.percent * 100
      display.progressValue = progressValue
      display.progressText = `${Math.floor(progressValue)}% ${item.log}`
    }

    return display
  }

  return {
    running: response.runningItems.map(convert),
    waiting: response.waitItems.map(convert),
  }
}

export function isSameEncodeSelection(current: Set<number>, next: Set<number>): boolean {
  if (next.size !== current.size) {
    return false
  }

  for (const id of next) {
    if (!current.has(id)) {
      return false
    }
  }

  return true
}

export function toggleVisibleEncodeSelection({
  currentSelectedIds,
  visibleEncodeIds,
  action,
}: {
  currentSelectedIds: ReadonlySet<number>
  visibleEncodeIds: readonly number[]
  action: 'select-all' | 'preserve-visible'
}): Set<number> {
  const visible = new Set(visibleEncodeIds)

  if (action === 'preserve-visible') {
    return new Set([...currentSelectedIds].filter((id) => visible.has(id)))
  }

  const isAllSelected =
    visibleEncodeIds.length > 0 && visibleEncodeIds.every((id) => currentSelectedIds.has(id))

  return isAllSelected ? new Set() : new Set(visibleEncodeIds)
}

export async function cancelSelectedEncodeJobs({
  apiRepository,
  encodeIds,
}: {
  apiRepository: EncodeCancelRepository
  encodeIds: readonly number[]
}): Promise<boolean> {
  let hasError = false

  for (const encodeId of encodeIds) {
    const result = await apiRepository.cancelEncode(encodeId)
    if (!result.ok) {
      hasError = true
    }
  }

  return !hasError
}
