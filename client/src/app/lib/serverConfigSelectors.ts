import {
  LEGACY_BROADCAST_WAVE_ORDER,
  type BroadcastWave,
  type NavigationConfigState,
} from '../navigation'
import type { LiveStreamConfig, ServerConfigNavigationState } from '../serverApi'
import { detectNavigatorUrlSchemePlatform } from '../../shared/settings/urlSchemePlatform'

export type ActiveServerConfig = NavigationConfigState | ServerConfigNavigationState

export function isIOSAddressBarFixTarget(): boolean {
  if (typeof navigator === 'undefined') {
    return false
  }

  return (
    /iP(?:hone|ad|od)/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  )
}

export function resolveIOSAddressBarFixClass(): 'fix-address-bar' | 'fix-address-bar2' | null {
  if (!isIOSAddressBarFixTarget()) {
    return null
  }

  return 'fix-address-bar2'
}

export function hasSocketIOPort(
  config: ActiveServerConfig,
): config is ServerConfigNavigationState & { socketIOPort: number } {
  return (
    config.status === 'loaded' &&
    typeof (config as ServerConfigNavigationState).socketIOPort === 'number'
  )
}

export function getRecordedEncodeModes(config: ActiveServerConfig): readonly string[] {
  return 'encodeModes' in config && Array.isArray(config.encodeModes) ? config.encodeModes : []
}

export function getRecordedDirectories(config: ActiveServerConfig): readonly string[] {
  return 'recordedDirectories' in config && Array.isArray(config.recordedDirectories)
    ? config.recordedDirectories
    : []
}

export function getRecordedKodiHosts(config: ActiveServerConfig): readonly string[] {
  return 'kodiHosts' in config && Array.isArray(config.kodiHosts) ? config.kodiHosts : []
}

export function getRecordedDownloadUrlScheme(config: ActiveServerConfig): string | null {
  const os = detectNavigatorUrlSchemePlatform(
    typeof navigator === 'undefined' ? undefined : navigator,
  )

  return os === null || !('urlscheme' in config) ? null : (config.urlscheme?.download?.[os] ?? null)
}

export function getRecordedViewUrlScheme(config: ActiveServerConfig): string | null {
  const os = detectNavigatorUrlSchemePlatform(
    typeof navigator === 'undefined' ? undefined : navigator,
  )

  return os === null || !('urlscheme' in config) ? null : (config.urlscheme?.video?.[os] ?? null)
}

export function getIsRecordedEncodeEnabled(config: ActiveServerConfig): boolean {
  return 'isEncodeEnabled' in config && config.isEncodeEnabled === true
}

export function getEnabledBroadcastWaves(config: ActiveServerConfig): readonly BroadcastWave[] {
  // config 未ロードの間は BS4K 追加前の旧 4 波を fallback にする。BS4K の無い環境で
  // ロード前に BS4K の checkbox/tab が一瞬出るのを防ぐための意図的な固定値。
  return config.status === 'loaded' ? config.enabledBroadcastWaves : LEGACY_BROADCAST_WAVE_ORDER
}

export function getStreamConfig(config: ActiveServerConfig): LiveStreamConfig | undefined {
  return 'streamConfig' in config ? config.streamConfig : undefined
}

export function getUrlScheme(
  config: ActiveServerConfig,
): ServerConfigNavigationState['urlscheme'] | undefined {
  return 'urlscheme' in config ? config.urlscheme : undefined
}
