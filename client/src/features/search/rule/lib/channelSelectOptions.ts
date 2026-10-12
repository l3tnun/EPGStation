import type { SearchChannelOption } from '../api'
import type { SearchRuleDetail } from './searchTypes'

export function mergeChannelSelectOptions({
  channelIds,
  channelOptions,
  ruleDetail,
}: {
  channelIds: readonly number[]
  channelOptions: readonly SearchChannelOption[]
  ruleDetail: SearchRuleDetail | null
}): readonly SearchChannelOption[] {
  if (channelIds.length === 0) {
    return channelOptions
  }

  return [
    ...channelIds
      .filter((channelId) => !channelOptions.some((channel) => channel.id === channelId))
      .map((channelId) => {
        const ruleDetailIndex =
          ruleDetail?.searchOption.channelIds?.findIndex(
            (ruleChannelId) => ruleChannelId === channelId,
          ) ?? -1

        return {
          id: channelId,
          name:
            ruleDetailIndex >= 0
              ? (ruleDetail?.searchOption.channelNames?.[ruleDetailIndex] ?? channelId.toString())
              : channelId.toString(),
        }
      }),
    ...channelOptions,
  ]
}
