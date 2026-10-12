import type { OnAirLiveStreamsResult } from '../onairApi'
import type { OnAirLiveStreamInfoItem } from '../onairRequests'
import { isRecord } from './onairApiAdapters'

export function adaptLiveStreamItem(value: unknown): OnAirLiveStreamInfoItem | null {
  if (!isRecord(value) || typeof value.channelId !== 'number' || typeof value.mode !== 'number') {
    return null
  }

  const item: OnAirLiveStreamInfoItem = {
    channelId: value.channelId,
    mode: value.mode,
  }

  if (typeof value.type === 'string') {
    item.type = value.type
  }
  if (typeof value.name === 'string') {
    item.name = value.name
  }
  if (typeof value.description === 'string') {
    item.description = value.description
  }
  if (typeof value.startAt === 'number') {
    item.startAt = value.startAt
  }
  if (typeof value.endAt === 'number') {
    item.endAt = value.endAt
  }

  return item
}

export function adaptLiveStreams(value: unknown): OnAirLiveStreamsResult | null {
  if (!isRecord(value) || !Array.isArray(value.items)) {
    return null
  }

  const items = value.items.map(adaptLiveStreamItem)

  return items.every((item): item is OnAirLiveStreamInfoItem => item !== null) ? { items } : null
}

export function adaptChannelNameIndex(
  value: unknown,
  isHalfWidth: boolean,
): Map<number, string> | null {
  if (!Array.isArray(value)) {
    return null
  }

  const index = new Map<number, string>()
  for (const entry of value) {
    if (!isRecord(entry) || typeof entry.id !== 'number') {
      continue
    }

    const name =
      isHalfWidth && typeof entry.halfWidthName === 'string'
        ? entry.halfWidthName
        : typeof entry.name === 'string'
          ? entry.name
          : undefined
    if (typeof name === 'string') {
      index.set(entry.id, name)
    }
  }

  return index
}

export function attachChannelNamesToLiveStreams({
  streams,
  channelNames,
}: {
  streams: OnAirLiveStreamsResult
  channelNames: ReadonlyMap<number, string>
}): OnAirLiveStreamsResult {
  return {
    items: streams.items.map((item) => {
      const channelName = channelNames.get(item.channelId)

      return channelName === undefined ? item : { ...item, channelName }
    }),
  }
}
