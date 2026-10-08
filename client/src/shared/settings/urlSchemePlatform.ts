export type URLSchemePlatform = 'ios' | 'android' | 'mac' | 'win'

export interface URLSchemePlatformInput {
  userAgent: string
  platform: string
  maxTouchPoints: number
}

export function detectBrowserUrlSchemePlatform({
  userAgent,
  platform,
  maxTouchPoints,
}: URLSchemePlatformInput): URLSchemePlatform | null {
  if (/iP(?:hone|ad|od)/.test(userAgent)) {
    return 'ios'
  }
  if (/Android/i.test(userAgent)) {
    return 'android'
  }
  if (/Mac/i.test(platform) && maxTouchPoints > 1) {
    return 'ios'
  }
  if (/Mac/i.test(userAgent) || /Mac/i.test(platform)) {
    return 'mac'
  }
  if (/Win/i.test(userAgent) || /Win/i.test(platform)) {
    return 'win'
  }

  return null
}

export function detectNavigatorUrlSchemePlatform(
  navigatorLike: Pick<Navigator, 'userAgent' | 'platform' | 'maxTouchPoints'> | undefined,
): URLSchemePlatform | null {
  if (navigatorLike === undefined) {
    return null
  }

  return detectBrowserUrlSchemePlatform({
    userAgent: navigatorLike.userAgent,
    platform: navigatorLike.platform,
    maxTouchPoints: navigatorLike.maxTouchPoints,
  })
}
