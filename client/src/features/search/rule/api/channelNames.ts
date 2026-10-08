import type { ReserveListItem as ReserveListItemModel } from '@/features/reserves/reservesApi'
import type { SearchRuleDetail } from '../query'
import { isNonNegativeSafeInteger, isRecord, isSafeInteger } from './guards'
import type { RuleListResponse, SearchProgram } from './types'

export function adaptChannelIndex(value: unknown, isHalfWidth: boolean): Map<number, string> {
  const channels = new Map<number, string>()

  if (!Array.isArray(value)) {
    return channels
  }

  value.forEach((channel) => {
    if (!isRecord(channel) || !isNonNegativeSafeInteger(channel.id)) {
      return
    }

    const name =
      isHalfWidth && typeof channel.halfWidthName === 'string'
        ? channel.halfWidthName
        : typeof channel.name === 'string'
          ? channel.name
          : typeof channel.halfWidthName === 'string'
            ? channel.halfWidthName
            : undefined

    if (name !== undefined) {
      channels.set(channel.id, name)
    }
  })

  return channels
}

export function hydrateRuleChannelNames(
  response: RuleListResponse,
  channelIndex: ReadonlyMap<number, string>,
): RuleListResponse {
  return {
    ...response,
    rules: response.rules.map((rule) => {
      const channelIds = rule.searchOption.channelIds ?? []
      if (channelIds.length === 0) {
        return rule
      }

      return {
        ...rule,
        searchOption: {
          ...rule.searchOption,
          channelNames: channelIds.map(
            (channelId) => channelIndex.get(channelId) ?? String(channelId),
          ),
        },
      }
    }),
  }
}

export function hydrateRuleDetailChannelNames(
  rule: SearchRuleDetail,
  channelIndex: ReadonlyMap<number, string>,
): SearchRuleDetail {
  const channelIds = rule.searchOption.channelIds ?? []

  if (channelIds.length === 0) {
    return rule
  }

  return {
    ...rule,
    searchOption: {
      ...rule.searchOption,
      channelNames: channelIds.map((channelId) => channelIndex.get(channelId) ?? String(channelId)),
    },
  }
}

export function hydrateSearchProgramChannelNames(
  programs: readonly SearchProgram[],
  channelIndex: ReadonlyMap<number, string>,
): SearchProgram[] {
  return programs.map((program) => {
    if (program.channelName !== undefined || program.channelId === undefined) {
      return program
    }

    const channelName = channelIndex.get(program.channelId)

    return channelName === undefined ? program : { ...program, channelName }
  })
}

export function hydrateRuleReserveChannelNames(
  reserves: readonly ReserveListItemModel[],
  channelIndex: ReadonlyMap<number, string>,
): ReserveListItemModel[] {
  return reserves.map((reserve) => {
    if (reserve.channelName !== undefined || reserve.channelId === undefined) {
      return reserve
    }

    const channelName = channelIndex.get(reserve.channelId)

    return channelName === undefined ? reserve : { ...reserve, channelName }
  })
}

function adaptRuleReserveItem(value: unknown): ReserveListItemModel | null {
  if (!isRecord(value) || !isNonNegativeSafeInteger(value.id)) {
    return null
  }

  const item: ReserveListItemModel = { id: value.id }

  if (isNonNegativeSafeInteger(value.programId)) item.programId = value.programId
  if (typeof value.name === 'string') item.name = value.name
  if (isNonNegativeSafeInteger(value.channelId)) item.channelId = value.channelId
  if (typeof value.channelName === 'string') item.channelName = value.channelName
  if (isSafeInteger(value.startAt)) item.startAt = value.startAt
  if (isSafeInteger(value.endAt)) item.endAt = value.endAt
  if (typeof value.description === 'string') item.description = value.description
  if (isNonNegativeSafeInteger(value.ruleId)) item.ruleId = value.ruleId
  if (typeof value.isConflict === 'boolean') item.isConflict = value.isConflict
  if (typeof value.isSkip === 'boolean') item.isSkip = value.isSkip
  if (typeof value.isOverlap === 'boolean') item.isOverlap = value.isOverlap
  if (typeof value.isTimeSpecified === 'boolean') item.isTimeSpecified = value.isTimeSpecified

  return item
}

export function adaptRuleReserveList(value: unknown): ReserveListItemModel[] | null {
  const source = isRecord(value) && Array.isArray(value.reserves) ? value.reserves : value

  if (!Array.isArray(source)) {
    return null
  }

  const items = source.map(adaptRuleReserveItem)

  return items.every((item): item is ReserveListItemModel => item !== null) ? items : null
}
