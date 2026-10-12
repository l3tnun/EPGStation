import type { RuleListItem } from '../api'
import { searchGenreLabel } from '../genreLabels'

export function ruleKeyword(rule: RuleListItem): string {
  return rule.searchOption.keyword ?? '-'
}

export function ruleIgnoreKeyword(rule: RuleListItem): string {
  return rule.searchOption.ignoreKeyword ?? '-'
}

export function ruleChannel(rule: RuleListItem): string {
  const channels = rule.searchOption.channelIds ?? []
  const channelNames = rule.searchOption.channelNames ?? []

  if (channels.length === 0) {
    return '-'
  }

  const first = channelNames[0] ?? String(channels[0])

  return channels.length === 1 ? first : `${first} 他${channels.length - 1}`
}

export function ruleGenre(rule: RuleListItem): string {
  const genres = rule.searchOption.genres ?? []
  const first = genres[0]

  if (first === undefined) {
    return '-'
  }

  const label = searchGenreLabel(first.genre, first.subGenre)

  return genres.length === 1 ? label : `${label} 他${genres.length - 1}`
}
