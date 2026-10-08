import type {
  NavigationRoute,
  NavigationRouteQueryValue,
  NavigationTimestampProvider,
} from '../navigation'

export function createFullRoutePath(location: { pathname: string; search: string }): string {
  return `${location.pathname}${location.search}`
}

export function createTimestampNormalizedRoutePath(
  location: { pathname: string; search: string },
  timestampProvider: NavigationTimestampProvider,
): string | null {
  if (location.pathname === '/' || location.pathname === '') {
    return null
  }

  const parameters = new URLSearchParams(location.search)
  if (parameters.has('timestamp')) {
    return null
  }

  parameters.set('timestamp', timestampProvider())
  return `${location.pathname}?${parameters.toString()}`
}

export function parseRoutePath(routePath: string): { pathname: string; search: string } {
  const [pathname, query = ''] = routePath.split('?')
  return {
    pathname,
    search: query === '' ? '' : `?${query}`,
  }
}

export function createFullRoutePathFromBrowserHash(): string | null {
  if (typeof window === 'undefined') {
    return null
  }

  const hashRoute = window.location.hash.replace(/^#/, '')

  return hashRoute === '' ? '/' : hashRoute
}

export function createBrowserLocationHref(): string | undefined {
  return typeof window === 'undefined' ? undefined : window.location.href
}

function isNavigationRouteQueryValueList(
  value: NavigationRouteQueryValue,
): value is readonly string[] {
  return Array.isArray(value)
}

export function createNavigationPath(route: NavigationRoute): string {
  const parameters = new URLSearchParams()

  Object.entries(route.query).forEach(([key, value]) => {
    if (value === undefined) {
      return
    }

    if (isNavigationRouteQueryValueList(value)) {
      value.forEach((entry) => {
        parameters.append(key, entry)
      })
      return
    }

    parameters.set(key, value)
  })

  const search = parameters.toString()

  return search === '' ? route.path : `${route.path}?${search}`
}
