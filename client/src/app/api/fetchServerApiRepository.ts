import { adaptServerConfig, adaptServerVersion } from './serverConfigAdapters'
import {
  CHANNELS_DOWNLOAD_FAILURE_MESSAGE,
  CONFIG_DOWNLOAD_FAILURE_MESSAGE,
  VERSION_DOWNLOAD_FAILURE_MESSAGE,
  type FetchServerApiRepositoryOptions,
  type ServerApiFetch,
  type ServerApiRepository,
} from './serverApiTypes'
import {
  detectNavigatorUrlSchemePlatform,
  type URLSchemePlatform,
} from '@/shared/settings/urlSchemePlatform'
import { detectMpegtsLivePlaybackSupport } from '@/shared/media/mpegtsSupport'

function joinBaseAndEndpoint(
  basePath: string,
  endpointPath: '/channels' | '/config' | '/version',
): string {
  return `${basePath.replace(/\/$/, '')}${endpointPath}`
}

function resolveDefaultPlatform(): URLSchemePlatform | null {
  return detectNavigatorUrlSchemePlatform(typeof navigator === 'undefined' ? undefined : navigator)
}

function resolveDefaultSupportsM2tsLl(): boolean {
  if (typeof navigator === 'undefined') {
    return false
  }

  // Whether live M2TS-LL should be offered is a runtime capability question, not a device
  // model question: iOS 17.1+ Safari on iPhone can play it through Apple's ManagedMediaSource
  // just like iPadOS/desktop Safari can through W3C MediaSource, so this defers to mpegts.js
  // feature detection (Mpegts.isSupported() && getFeatureList().mseLivePlayback) instead of a
  // user-agent/touch-point heuristic.
  return detectMpegtsLivePlaybackSupport()
}

async function fetchJson(fetcher: ServerApiFetch, url: string): Promise<unknown | null> {
  try {
    const response = await fetcher(url)

    if (!response.ok) {
      return null
    }

    return await response.json()
  } catch {
    return null
  }
}

function resolveDefaultFetch(): ServerApiFetch {
  return globalThis.fetch.bind(globalThis)
}

export function createFetchServerApiRepository(
  options: FetchServerApiRepositoryOptions = {},
): ServerApiRepository {
  const fetcher = options.fetcher ?? resolveDefaultFetch()
  const basePath = options.basePath ?? './api'
  const platform = options.platform === undefined ? resolveDefaultPlatform() : options.platform
  const supportsM2tsLl = options.supportsM2tsLl ?? resolveDefaultSupportsM2tsLl()

  return {
    async fetchVersion() {
      const response = await fetchJson(fetcher, joinBaseAndEndpoint(basePath, '/version'))
      const version = adaptServerVersion(response)

      if (version === null) {
        return {
          ok: false,
          error: 'version-fetch-failed',
          message: VERSION_DOWNLOAD_FAILURE_MESSAGE,
        }
      }

      return {
        ok: true,
        value: version,
      }
    },

    async fetchServerConfig() {
      const response = await fetchJson(fetcher, joinBaseAndEndpoint(basePath, '/config'))
      const config = adaptServerConfig(response, { platform, supportsM2tsLl })

      if (config === null) {
        return {
          ok: false,
          error: 'config-fetch-failed',
          message: CONFIG_DOWNLOAD_FAILURE_MESSAGE,
        }
      }

      return {
        ok: true,
        value: config,
      }
    },

    async fetchBootstrapChannels() {
      const response = await fetchJson(fetcher, joinBaseAndEndpoint(basePath, '/channels'))

      if (!Array.isArray(response)) {
        return {
          ok: false,
          error: 'channels-fetch-failed',
          message: CHANNELS_DOWNLOAD_FAILURE_MESSAGE,
        }
      }

      return {
        ok: true,
        value: response,
      }
    },
  }
}
