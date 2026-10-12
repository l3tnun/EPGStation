import { createFetchServerApiRepository, type ServerApiRepository } from '@/app/serverApi'

export interface ManualChannelOption {
  id: number
  name: string
}

export interface ManualServerOptions {
  channels: readonly ManualChannelOption[]
  directories: readonly string[]
  encodeModes: readonly string[]
}

export const EMPTY_SERVER_OPTIONS: ManualServerOptions = {
  channels: [],
  directories: [],
  encodeModes: [],
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function adaptManualChannelOptions(value: unknown): readonly ManualChannelOption[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map((channel) => {
      if (
        !isRecord(channel) ||
        typeof channel.id !== 'number' ||
        (typeof channel.type === 'number' && channel.type !== 1)
      ) {
        return null
      }

      const name =
        typeof channel.halfWidthName === 'string'
          ? channel.halfWidthName
          : typeof channel.name === 'string'
            ? channel.name
            : undefined

      return name === undefined ? null : { id: channel.id, name }
    })
    .filter((channel): channel is ManualChannelOption => channel !== null)
}

export async function fetchManualServerOptions(
  serverApi: ServerApiRepository = createFetchServerApiRepository(),
): Promise<ManualServerOptions> {
  const [channelsResult, configResult] = await Promise.all([
    serverApi.fetchBootstrapChannels?.() ?? Promise.resolve(null),
    serverApi.fetchServerConfig(),
  ])
  const config = configResult.ok ? configResult.value : null

  return {
    channels: adaptManualChannelOptions(
      channelsResult !== null && channelsResult.ok ? channelsResult.value : null,
    ),
    directories: config?.recordedDirectories ?? [],
    encodeModes: config?.encodeModes ?? [],
  }
}
