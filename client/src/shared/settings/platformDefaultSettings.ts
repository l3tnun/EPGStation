import type { DefaultSettingsInput } from './settingsTypes'
import { detectNavigatorUrlSchemePlatform } from './urlSchemePlatform'

export function createDefaultSettingsInputFromNavigator(
  navigatorLike: Pick<Navigator, 'userAgent' | 'platform' | 'maxTouchPoints'> | undefined,
): DefaultSettingsInput {
  const platform = detectNavigatorUrlSchemePlatform(navigatorLike)

  return {
    isIOS: platform === 'ios',
    isAndroid: platform === 'android',
  }
}
