import { vi } from 'vitest'
import type { EncodeApiRepository } from '@/features/encode/encodeApi'

export class SyntheticRealtimeConnection {
  private readonly listeners = new Map<string, Set<() => void>>()

  on(eventName: string, listener: () => void): void {
    const eventListeners = this.listeners.get(eventName) ?? new Set<() => void>()
    eventListeners.add(listener)
    this.listeners.set(eventName, eventListeners)
  }

  off(eventName: string, listener: () => void): void {
    this.listeners.get(eventName)?.delete(listener)
  }

  emit(eventName: string): void {
    this.listeners.get(eventName)?.forEach((listener) => {
      listener()
    })
  }
}

export function createShellRepository(version = '9.9.9') {
  return {
    fetchVersion: vi.fn(async () => ({
      ok: true as const,
      value: {
        version,
      },
    })),
    fetchServerConfig: vi.fn(async () => ({
      ok: true as const,
      value: {
        status: 'loaded' as const,
        liveStreamEnabled: false,
        enabledBroadcastWaves: [] as const,
      },
    })),
  }
}

export function createEncodeRepository(): EncodeApiRepository {
  return {
    fetchEncode: vi.fn(async () => ({
      ok: true as const,
      value: {
        runningItems: [
          {
            id: 301,
            mode: 'running-mode',
            percent: 0.456,
            log: 'frame=456',
            recorded: {
              id: 501,
              name: 'Synthetic running encode',
              channelName: 'Synthetic channel',
              startAt: 1700000000000,
              endAt: 1700003600000,
              thumbnails: [777],
            },
          },
          {
            id: 302,
            mode: 'percent-only',
            percent: 0.5,
            recorded: {
              id: 502,
              name: 'Synthetic percent only',
            },
          },
        ],
        waitItems: [
          {
            id: 401,
            mode: 'waiting-mode',
            recorded: {
              id: 601,
              name: 'Synthetic waiting encode',
            },
          },
        ],
      },
    })),
    cancelEncode: vi.fn(async () => ({ ok: true as const, value: undefined })),
  }
}
