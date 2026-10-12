import { BROADCAST_WAVE_ORDER, type BroadcastWave } from '../navigation'
import type { ServerConfigNavigationState, ServerVersion } from './serverApiTypes'
import { adaptLiveStreamConfig, filterLiveStreamConfigForIOS } from './streamConfigAdapters'
import type { URLSchemePlatform } from '@/shared/settings/urlSchemePlatform'

interface RawServerVersion {
  version?: unknown
}

interface RawServerConfig {
  isEnableTSLiveStream?: unknown
  isEnableEncode?: unknown
  encode?: unknown
  encodeModes?: unknown
  recorded?: unknown
  broadcast?: Partial<Record<BroadcastWave, unknown>>
  socketIOPort?: unknown
  kodiHosts?: unknown
  urlscheme?: unknown
  streamConfig?: unknown
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function adaptServerVersion(value: unknown): ServerVersion | null {
  if (!isRecord(value)) {
    return null
  }

  const rawVersion = (value as RawServerVersion).version

  return typeof rawVersion === 'string' ? { version: rawVersion } : null
}

function adaptPlatformUrlScheme(value: unknown) {
  if (!isRecord(value)) {
    return undefined
  }

  const scheme: { ios?: string; android?: string; mac?: string; win?: string } = {}

  ;(['ios', 'android', 'mac', 'win'] as const).forEach((key) => {
    if (typeof value[key] === 'string') {
      scheme[key] = value[key]
    }
  })

  return Object.keys(scheme).length === 0 ? undefined : scheme
}

function adaptUrlSchemeConfig(value: Record<string, unknown>) {
  const urlscheme: ServerConfigNavigationState['urlscheme'] = {}
  const video = adaptPlatformUrlScheme(value.video)
  const download = adaptPlatformUrlScheme(value.download)
  const m2ts = adaptPlatformUrlScheme(value.m2ts)

  if (video !== undefined) {
    urlscheme.video = video
  }
  if (download !== undefined) {
    urlscheme.download = download
  }
  if (m2ts !== undefined) {
    urlscheme.m2ts = m2ts
  }

  return urlscheme
}

export function adaptServerConfig(
  value: unknown,
  options: { platform: URLSchemePlatform | null; supportsM2tsLl: boolean },
): ServerConfigNavigationState | null {
  if (!isRecord(value)) {
    return null
  }

  const rawConfig = value as RawServerConfig
  const broadcast = isRecord(rawConfig.broadcast) ? rawConfig.broadcast : {}
  const enabledBroadcastWaves = BROADCAST_WAVE_ORDER.filter((wave) => broadcast[wave] === true)
  const config: ServerConfigNavigationState = {
    status: 'loaded',
    liveStreamEnabled: rawConfig.isEnableTSLiveStream === true,
    enabledBroadcastWaves,
  }

  if (typeof rawConfig.socketIOPort === 'number') {
    config.socketIOPort = rawConfig.socketIOPort
  }
  const rawEncodeModes = Array.isArray(rawConfig.encodeModes)
    ? rawConfig.encodeModes
    : Array.isArray(rawConfig.encode)
      ? rawConfig.encode
      : []
  const encodeModes = rawEncodeModes.filter((mode): mode is string => typeof mode === 'string')

  if (rawConfig.isEnableEncode === true || encodeModes.length > 0) {
    config.isEncodeEnabled = rawConfig.isEnableEncode === true || encodeModes.length > 0
  }
  if (encodeModes.length > 0) {
    config.encodeModes = encodeModes
  }
  const recordedDirectories = Array.isArray(rawConfig.recorded)
    ? rawConfig.recorded.filter((directory): directory is string => typeof directory === 'string')
    : []

  if (recordedDirectories.length > 0) {
    config.recordedDirectories = recordedDirectories
  }
  if (Array.isArray(rawConfig.kodiHosts)) {
    const kodiHosts = rawConfig.kodiHosts.filter((host): host is string => typeof host === 'string')
    if (kodiHosts.length > 0) {
      config.kodiHosts = kodiHosts
    }
  }
  if (isRecord(rawConfig.urlscheme)) {
    config.urlscheme = adaptUrlSchemeConfig(rawConfig.urlscheme)
  }
  const adaptedStreamConfig = adaptLiveStreamConfig(rawConfig.streamConfig)
  const streamConfig =
    options.platform === 'ios'
      ? filterLiveStreamConfigForIOS({
          streamConfig: adaptedStreamConfig,
          supportsM2tsLl: options.supportsM2tsLl,
        })
      : adaptedStreamConfig
  if (streamConfig !== undefined) {
    config.streamConfig = streamConfig
  }

  return config
}
