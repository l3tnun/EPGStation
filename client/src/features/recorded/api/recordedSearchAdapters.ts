import { isRecord } from './recordedAdapters'
import type {
  RecordedRuleDetail,
  RecordedRuleKeywordItem,
  RecordedSearchOptionItem,
  RecordedSearchOptions,
  RecordedUploadCreatedResponse,
} from './recordedApiTypes'

export const SEARCH_OPTION_GENRE_NAMES: Record<number, string> = {
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

function appendSearchOptionCount(name: string, item: Record<string, unknown>): string {
  return typeof item.cnt === 'number' ? `${name}(${item.cnt})` : name
}

function adaptSearchChannelOptions(
  value: unknown,
  channelIndex: ReadonlyMap<number, RecordedSearchOptionItem>,
): RecordedSearchOptionItem[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.flatMap((item): RecordedSearchOptionItem[] => {
    if (!isRecord(item)) {
      return []
    }

    const id =
      typeof item.id === 'number'
        ? item.id
        : typeof item.channelId === 'number'
          ? item.channelId
          : undefined

    if (id === undefined) {
      return []
    }

    const indexed = channelIndex.get(id)
    const baseName =
      typeof item.name === 'string'
        ? item.name
        : typeof item.channel === 'string'
          ? item.channel
          : (indexed?.name ?? String(id))

    const option: RecordedSearchOptionItem = { id, name: appendSearchOptionCount(baseName, item) }

    if (typeof item.halfWidthName === 'string') {
      option.halfWidthName = appendSearchOptionCount(item.halfWidthName, item)
    } else if (indexed?.halfWidthName !== undefined) {
      option.halfWidthName = appendSearchOptionCount(indexed.halfWidthName, item)
    }

    return [option]
  })
}

function adaptSearchGenreOptions(value: unknown): RecordedSearchOptionItem[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.flatMap((item): RecordedSearchOptionItem[] => {
    if (!isRecord(item)) {
      return []
    }

    const id =
      typeof item.id === 'number'
        ? item.id
        : typeof item.genre === 'number'
          ? item.genre
          : undefined

    if (id === undefined) {
      return []
    }

    const baseName =
      typeof item.name === 'string'
        ? item.name
        : typeof item.genre === 'string'
          ? item.genre
          : (SEARCH_OPTION_GENRE_NAMES[id] ?? String(id))

    return [{ id, name: appendSearchOptionCount(baseName, item) }]
  })
}

export function adaptRecordedSearchOptions(
  value: unknown,
  channelIndex: ReadonlyMap<number, RecordedSearchOptionItem> = new Map(),
): RecordedSearchOptions | null {
  if (!isRecord(value)) {
    return null
  }

  return {
    channels: adaptSearchChannelOptions(value.channels ?? value.channelItems, channelIndex),
    genres: adaptSearchGenreOptions(value.genres ?? value.genreItems),
  }
}

export function adaptRuleKeywords(value: unknown): RecordedRuleKeywordItem[] | null {
  const items = isRecord(value) && Array.isArray(value.items) ? value.items : value

  if (!Array.isArray(items)) {
    return null
  }

  return items.flatMap((item): RecordedRuleKeywordItem[] => {
    if (!isRecord(item) || typeof item.id !== 'number' || typeof item.keyword !== 'string') {
      return []
    }

    return [{ id: item.id, keyword: item.keyword }]
  })
}

export function adaptRuleDetail(value: unknown): RecordedRuleDetail | null {
  if (!isRecord(value) || typeof value.id !== 'number') {
    return null
  }

  const searchOption = isRecord(value.searchOption) ? value.searchOption : undefined

  return {
    id: value.id,
    keyword:
      typeof value.keyword === 'string'
        ? value.keyword
        : typeof searchOption?.keyword === 'string'
          ? searchOption.keyword
          : undefined,
  }
}

export function adaptRecordedUploadCreatedResponse(
  value: unknown,
): RecordedUploadCreatedResponse | null {
  if (!isRecord(value) || typeof value.recordedId !== 'number') {
    return null
  }

  return { recordedId: value.recordedId }
}

export function adaptVideoDuration(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (!isRecord(value) || typeof value.duration !== 'number' || !Number.isFinite(value.duration)) {
    return null
  }

  return value.duration
}
