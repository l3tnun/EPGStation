import type {
  LiveStreamConfig,
  LiveStreamTsConfig,
  RecordedStreamFileConfig,
} from './serverApiTypes'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function filterRecordedStreamFileConfigForIOS(
  value: RecordedStreamFileConfig | undefined,
): RecordedStreamFileConfig | undefined {
  if (value === undefined) {
    return undefined
  }

  const config: RecordedStreamFileConfig = {}

  if (value.hls !== undefined) {
    config.hls = value.hls
  }

  return Object.keys(config).length === 0 ? undefined : config
}

export function filterLiveStreamConfigForIOS({
  streamConfig,
  supportsM2tsLl,
}: {
  streamConfig: LiveStreamConfig | undefined
  supportsM2tsLl: boolean
}): LiveStreamConfig | undefined {
  if (streamConfig === undefined) {
    return undefined
  }

  const config: LiveStreamConfig = {}
  const liveTs = streamConfig.live?.ts
  if (liveTs !== undefined) {
    const ts: LiveStreamTsConfig = {}

    if (liveTs.m2ts !== undefined) {
      ts.m2ts = liveTs.m2ts
    }
    if (supportsM2tsLl && liveTs.m2tsll !== undefined) {
      ts.m2tsll = liveTs.m2tsll
    }
    if (liveTs.hls !== undefined) {
      ts.hls = liveTs.hls
    }
    if (Object.keys(ts).length > 0) {
      config.live = { ts }
    }
  }

  const recordedTs = filterRecordedStreamFileConfigForIOS(streamConfig.recorded?.ts)
  const recordedEncoded = filterRecordedStreamFileConfigForIOS(streamConfig.recorded?.encoded)
  if (recordedTs !== undefined || recordedEncoded !== undefined) {
    config.recorded = {}
    if (recordedTs !== undefined) {
      config.recorded.ts = recordedTs
    }
    if (recordedEncoded !== undefined) {
      config.recorded.encoded = recordedEncoded
    }
  }

  return Object.keys(config).length === 0 ? undefined : config
}

function adaptStringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined
  }

  const list = value.filter((item): item is string => typeof item === 'string' && item !== '')

  return list.length === 0 ? undefined : list
}

function adaptM2TSList(value: unknown): { name: string }[] | undefined {
  if (!Array.isArray(value)) {
    return undefined
  }

  const list = value
    .map((item): { name: string } | null => {
      if (!isRecord(item) || typeof item.name !== 'string' || item.name === '') {
        return null
      }

      return { name: item.name }
    })
    .filter((item): item is { name: string } => item !== null)

  return list.length === 0 ? undefined : list
}

function adaptRecordedStreamFileConfig(value: unknown): RecordedStreamFileConfig | undefined {
  if (!isRecord(value)) {
    return undefined
  }

  const config: RecordedStreamFileConfig = {}
  const webm = adaptStringList(value.webm)
  const mp4 = adaptStringList(value.mp4)
  const hls = adaptStringList(value.hls)

  if (webm !== undefined) {
    config.webm = webm
  }
  if (mp4 !== undefined) {
    config.mp4 = mp4
  }
  if (hls !== undefined) {
    config.hls = hls
  }

  return Object.keys(config).length === 0 ? undefined : config
}

export function adaptLiveStreamConfig(value: unknown): LiveStreamConfig | undefined {
  if (!isRecord(value)) {
    return undefined
  }

  const config: LiveStreamConfig = {}
  if (isRecord(value.live) && isRecord(value.live.ts)) {
    const ts: NonNullable<NonNullable<LiveStreamConfig['live']>['ts']> = {}
    const m2ts = adaptM2TSList(value.live.ts.m2ts)
    const m2tsll = adaptStringList(value.live.ts.m2tsll)
    const webm = adaptStringList(value.live.ts.webm)
    const mp4 = adaptStringList(value.live.ts.mp4)
    const hls = adaptStringList(value.live.ts.hls)

    if (m2ts !== undefined) {
      ts.m2ts = m2ts
    }
    if (m2tsll !== undefined) {
      ts.m2tsll = m2tsll
    }
    if (webm !== undefined) {
      ts.webm = webm
    }
    if (mp4 !== undefined) {
      ts.mp4 = mp4
    }
    if (hls !== undefined) {
      ts.hls = hls
    }

    if (Object.keys(ts).length > 0) {
      config.live = { ts }
    }
  }

  if (isRecord(value.recorded)) {
    const ts = adaptRecordedStreamFileConfig(value.recorded.ts)
    const encoded = adaptRecordedStreamFileConfig(value.recorded.encoded)
    const recorded: NonNullable<LiveStreamConfig['recorded']> = {}

    if (ts !== undefined) {
      recorded.ts = ts
    }
    if (encoded !== undefined) {
      recorded.encoded = encoded
    }
    if (Object.keys(recorded).length > 0) {
      config.recorded = recorded
    }
  }

  return Object.keys(config).length === 0 ? undefined : config
}
