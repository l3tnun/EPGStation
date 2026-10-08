import type { SettingsConsumerValue } from '@/shared/settings'
import type {
  RuleListRequest,
  RuleRouteState,
  SearchRouteQuery,
  SearchRouteState,
} from './searchTypes'

function parseInteger(value: string | null): number | undefined {
  if (value === null || !/^\d+$/.test(value)) {
    return undefined
  }

  const parsed = Number(value)

  return Number.isSafeInteger(parsed) ? parsed : undefined
}

export function parseSearchRoute(search: string): SearchRouteState {
  const parameters = new URLSearchParams(search)
  const ruleId = parseInteger(parameters.get('rule'))

  if (ruleId !== undefined) {
    return {
      mode: 'rule-edit',
      ruleId,
    }
  }

  const query: SearchRouteQuery = {}
  const keyword = parameters.get('keyword')
  const channelId = parseInteger(parameters.get('channelId'))
  const genre = parseInteger(parameters.get('genre'))
  const subGenre = parseInteger(parameters.get('subGenre'))

  if (keyword !== null && keyword !== '') {
    query.keyword = keyword
  }
  if (channelId !== undefined) {
    query.channelId = channelId
  }
  if (genre !== undefined) {
    query.genre = genre
  }
  if (subGenre !== undefined) {
    query.subGenre = subGenre
  }

  return {
    mode: 'search',
    shouldAutoSearch: Object.keys(query).length > 0,
    query,
  }
}

export function parseRuleRoute(search: string): RuleRouteState {
  const parameters = new URLSearchParams(search)
  const page = parseInteger(parameters.get('page')) ?? 1
  const keyword = parameters.get('keyword')

  return {
    page: page < 1 ? 1 : page,
    ...(keyword === null || keyword === '' ? {} : { keyword }),
  }
}

export function buildRuleListRequest({
  route,
  settings,
}: {
  route: RuleRouteState
  settings: Pick<SettingsConsumerValue, 'rulesLength' | 'isHalfWidthDisplayed'>
}): RuleListRequest {
  return {
    type: 'normal',
    offset: (route.page - 1) * settings.rulesLength,
    limit: settings.rulesLength,
    isHalfWidth: settings.isHalfWidthDisplayed,
    ...(route.keyword === undefined ? {} : { keyword: route.keyword }),
  }
}
