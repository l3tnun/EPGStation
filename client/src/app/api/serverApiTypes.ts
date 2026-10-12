import type { NavigationLoadedConfigState } from '../navigation'
import type { URLSchemePlatform } from '@/shared/settings/urlSchemePlatform'

export const VERSION_DOWNLOAD_FAILURE_MESSAGE = 'バージョン情報取得に失敗'
export const CONFIG_DOWNLOAD_FAILURE_MESSAGE = '設定ダウンロードに失敗しました'
export const CHANNELS_DOWNLOAD_FAILURE_MESSAGE = '放送局情報取得に失敗'

export type FeatureResult<T, E extends string> =
  | {
      ok: true
      value: T
    }
  | {
      ok: false
      error: E
      message: string
    }

export interface ServerVersion {
  version: string
}

export interface ServerConfigNavigationState extends NavigationLoadedConfigState {
  socketIOPort?: number
  isEncodeEnabled?: boolean
  encodeModes?: readonly string[]
  recordedDirectories?: readonly string[]
  kodiHosts?: readonly string[]
  urlscheme?: {
    video?: {
      ios?: string
      android?: string
      mac?: string
      win?: string
    }
    download?: {
      ios?: string
      android?: string
      mac?: string
      win?: string
    }
    m2ts?: {
      ios?: string
      android?: string
      mac?: string
      win?: string
    }
  }
  streamConfig?: LiveStreamConfig
}

export interface LiveM2TSModeConfig {
  name: string
}

export interface LiveStreamTsConfig {
  m2ts?: readonly LiveM2TSModeConfig[]
  m2tsll?: readonly string[]
  webm?: readonly string[]
  mp4?: readonly string[]
  hls?: readonly string[]
}

export interface LiveStreamConfig {
  live?: {
    ts?: LiveStreamTsConfig
  }
  recorded?: {
    ts?: RecordedStreamFileConfig
    encoded?: RecordedStreamFileConfig
  }
}

export interface RecordedStreamFileConfig {
  webm?: readonly string[]
  mp4?: readonly string[]
  hls?: readonly string[]
}

export interface ServerApiRepository {
  fetchVersion(): Promise<FeatureResult<ServerVersion, 'version-fetch-failed'>>
  fetchServerConfig(): Promise<FeatureResult<ServerConfigNavigationState, 'config-fetch-failed'>>
  fetchBootstrapChannels?(): Promise<FeatureResult<readonly unknown[], 'channels-fetch-failed'>>
}

export type ServerApiFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

export interface FetchServerApiRepositoryOptions {
  fetcher?: ServerApiFetch
  basePath?: string
  platform?: URLSchemePlatform | null
  supportsM2tsLl?: boolean
}
