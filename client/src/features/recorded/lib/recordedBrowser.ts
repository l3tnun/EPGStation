export function getBrowserOrigin(): string {
  return typeof window === 'undefined' ? 'https://example.invalid' : window.location.origin
}

export function getBrowserHref(): string {
  return typeof window === 'undefined' ? 'https://example.invalid/' : window.location.href
}

export function getBrowserStorage(): Storage | undefined {
  return typeof window === 'undefined' ? undefined : window.localStorage
}
