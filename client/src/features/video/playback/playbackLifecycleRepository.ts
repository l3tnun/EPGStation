import {
  isRecord,
  isStreamId,
  type HlsLifecycleRepository,
  type HlsStreamId,
} from './playbackLifecycleTypes'

interface RawStreamStatus {
  streamId?: HlsStreamId
  isEnabled?: boolean
  isEnable?: boolean
}

export function createFetchHlsLifecycleRepository({
  streamStartUrl,
  readinessUrl,
  fetcher = globalThis.fetch.bind(globalThis),
}: {
  streamStartUrl: string
  readinessUrl: string
  fetcher?: typeof fetch
}): HlsLifecycleRepository {
  const streamApiBasePath = streamStartUrl.split('/streams/')[0] || './api'

  return {
    async start(signal) {
      const response = await fetcher(streamStartUrl, { signal })
      if (!response.ok) {
        throw new Error('HLS stream start failed')
      }
      const value = (await response.json()) as unknown
      const streamId = isRecord(value) && isStreamId(value.streamId) ? value.streamId : null

      return { streamId }
    },
    async fetchStreams(signal) {
      const response = await fetcher(readinessUrl, { signal })
      if (!response.ok) {
        throw new Error('HLS stream readiness failed')
      }
      const value = (await response.json()) as unknown
      const items = Array.isArray(value)
        ? value
        : isRecord(value) && Array.isArray(value.items)
          ? value.items
          : []

      return items.flatMap((item: RawStreamStatus) => {
        if (!isRecord(item) || !isStreamId(item.streamId)) {
          return []
        }

        return [
          {
            streamId: item.streamId,
            isEnabled: item.isEnabled === true || item.isEnable === true,
          },
        ]
      })
    },
    async keep(streamId) {
      const response = await fetcher(`${streamApiBasePath}/streams/${streamId}/keep`, {
        method: 'PUT',
      })
      if (!response.ok) {
        throw new Error('HLS stream keep failed')
      }
    },
    async stop(streamId) {
      const response = await fetcher(`${streamApiBasePath}/streams/${streamId}`, {
        method: 'DELETE',
      })
      if (!response.ok) {
        throw new Error('HLS stream stop failed')
      }
    },
  }
}
