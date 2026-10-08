import type {
  NavigationItem,
  NavigationRoute,
  NavigationRouteQuery,
  NavigationRouteQueryValue,
  NavigationTimestampProvider,
} from './types'

function currentQueryMatchesCondition(
  actual: NavigationRouteQueryValue | undefined,
  expected: string,
): boolean {
  if (actual === undefined) {
    return false
  }

  if (Array.isArray(actual)) {
    return actual.includes(expected)
  }

  return actual === expected
}

function navigationItemMatchesRoute(item: NavigationItem, currentRoute: NavigationRoute): boolean {
  if (item.path !== currentRoute.path) {
    return false
  }

  if (item.queryCondition === undefined) {
    return true
  }

  return Object.entries(item.queryCondition).every(([key, expected]) =>
    currentQueryMatchesCondition(currentRoute.query[key], expected),
  )
}

export function findSelectedNavigationItem(
  items: readonly NavigationItem[],
  currentRoute: NavigationRoute,
): NavigationItem | undefined {
  return items.find((item) => navigationItemMatchesRoute(item, currentRoute))
}

export function createNavigationTimestamp(): string {
  return String(Date.now())
}

export function buildNavigationTarget(
  item: NavigationItem,
  timestampProvider: NavigationTimestampProvider = createNavigationTimestamp,
): NavigationRoute {
  return {
    path: item.path,
    query: {
      ...(item.queryCondition ?? {}),
      timestamp: timestampProvider(),
    },
  }
}

function listComparableQueryKeys(query: NavigationRouteQuery): string[] {
  return Object.keys(query).filter((key) => key !== 'timestamp' && query[key] !== undefined)
}

function normalizeQueryValue(value: NavigationRouteQueryValue | undefined): readonly string[] {
  if (value === undefined) {
    return []
  }

  if (isNavigationRouteQueryValueList(value)) {
    return value
  }

  return [value]
}

function isNavigationRouteQueryValueList(
  value: NavigationRouteQueryValue,
): value is readonly string[] {
  return Array.isArray(value)
}

function queryValuesMatch(
  current: NavigationRouteQueryValue | undefined,
  target: NavigationRouteQueryValue | undefined,
): boolean {
  const currentValues = normalizeQueryValue(current)
  const targetValues = normalizeQueryValue(target)

  return (
    currentValues.length === targetValues.length &&
    currentValues.every((value, index) => value === targetValues[index])
  )
}

function nonTimestampQueryMatches(
  currentQuery: NavigationRouteQuery,
  targetQuery: NavigationRouteQuery,
): boolean {
  const keys = new Set([
    ...listComparableQueryKeys(currentQuery),
    ...listComparableQueryKeys(targetQuery),
  ])

  return [...keys].every((key) => queryValuesMatch(currentQuery[key], targetQuery[key]))
}

export function shouldPushNavigation(
  currentRoute: NavigationRoute,
  targetRoute: NavigationRoute,
): boolean {
  if (currentRoute.path !== targetRoute.path) {
    return true
  }

  return !nonTimestampQueryMatches(currentRoute.query, targetRoute.query)
}

export function createNavigationRouteFromLocation(location: {
  pathname: string
  search: string
}): NavigationRoute {
  const query: Record<string, NavigationRouteQueryValue> = {}
  const parameters = new URLSearchParams(location.search)

  for (const key of new Set(parameters.keys())) {
    const values = parameters.getAll(key)
    query[key] = values.length === 1 ? values[0] : values
  }

  return {
    path: location.pathname,
    query,
  }
}
