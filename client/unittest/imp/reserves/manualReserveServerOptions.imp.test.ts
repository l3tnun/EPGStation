import { describe, expect, it } from 'vitest'
import {
  adaptManualChannelOptions,
  fetchManualServerOptions,
} from '@/features/reserves/lib/manualReserveServerOptions'
import type { ServerApiRepository } from '@/app/serverApi'

describe('manualReserveServerOptions direct unit edges', () => {
  it('[AC 4.24] returns no channels for a non-array payload', () => {
    expect(adaptManualChannelOptions(null)).toStrictEqual([])
    expect(adaptManualChannelOptions('not-an-array')).toStrictEqual([])
  })

  it('[AC 4.24] drops malformed channel entries, keeps only type 1 or untyped channels, and prefers name over absent halfWidthName', () => {
    expect(
      adaptManualChannelOptions([
        null,
        { id: '1', name: 'Invalid id' },
        { id: 2, type: 2, name: 'Wrong type' },
        { id: 3, type: 1, halfWidthName: 'Half width', name: 'Full width' },
        { id: 4, name: 'Full width only' },
        { id: 5 },
      ]),
    ).toStrictEqual([
      { id: 3, name: 'Half width' },
      { id: 4, name: 'Full width only' },
    ])
  })

  it('[AC 4.24] falls back to Promise.resolve(null) when fetchBootstrapChannels is absent', async () => {
    const serverApi: ServerApiRepository = {
      fetchVersion: async () => ({ ok: true, value: { version: '1' } }),
      fetchServerConfig: async () => ({
        ok: true,
        value: {
          status: 'loaded' as const,
          liveStreamEnabled: false,
          enabledBroadcastWaves: [] as const,
          encodeModes: ['h264'],
          recordedDirectories: ['/rec'],
        },
      }),
    }

    await expect(fetchManualServerOptions(serverApi)).resolves.toStrictEqual({
      channels: [],
      directories: ['/rec'],
      encodeModes: ['h264'],
    })
  })

  it('[AC 4.24] falls back to empty defaults when the channel fetch fails and config lacks optional fields', async () => {
    const serverApi: ServerApiRepository = {
      fetchVersion: async () => ({ ok: true, value: { version: '1' } }),
      fetchServerConfig: async () => ({
        ok: true,
        value: {
          status: 'loaded' as const,
          liveStreamEnabled: false,
          enabledBroadcastWaves: [] as const,
        },
      }),
      fetchBootstrapChannels: async () => ({
        ok: false,
        error: 'channels-fetch-failed',
        message: 'failed',
      }),
    }

    await expect(fetchManualServerOptions(serverApi)).resolves.toStrictEqual({
      channels: [],
      directories: [],
      encodeModes: [],
    })
  })

  it('[AC 4.24] falls back to empty defaults when the config fetch fails', async () => {
    const serverApi: ServerApiRepository = {
      fetchVersion: async () => ({ ok: true, value: { version: '1' } }),
      fetchServerConfig: async () => ({
        ok: false,
        error: 'config-fetch-failed',
        message: 'failed',
      }),
      fetchBootstrapChannels: async () => ({
        ok: true,
        value: [{ id: 1, name: 'Channel' }],
      }),
    }

    await expect(fetchManualServerOptions(serverApi)).resolves.toStrictEqual({
      channels: [{ id: 1, name: 'Channel' }],
      directories: [],
      encodeModes: [],
    })
  })
})
