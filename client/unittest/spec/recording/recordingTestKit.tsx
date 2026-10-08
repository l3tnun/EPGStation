import { screen } from '@testing-library/react'
import { vi } from 'vitest'
import type { RecordingApiRepository } from '@/features/recording/recordingApi'

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

export function createRecordingRepository(): RecordingApiRepository {
  return {
    fetchRecording: vi.fn(async () => ({
      ok: true as const,
      value: {
        records: [
          {
            id: 101,
            name: 'Synthetic recording one',
            description: 'Synthetic recording description',
            ruleId: 55,
            isProtected: false,
            isRecording: true,
            isEncoding: true,
            videoFiles: [
              { id: 201, name: 'synthetic-original', type: 'ts', size: 1024 },
              { id: 202, name: 'synthetic-encoded', type: 'encoded', size: 2048 },
            ],
          },
          {
            id: 102,
            name: 'Synthetic recording two',
            description: 'Synthetic second recording description',
            isProtected: true,
            isRecording: true,
            isEncoding: false,
            videoFiles: [{ id: 203, name: 'synthetic-second', type: 'ts', size: 4096 }],
          },
        ],
        total: 50,
      },
    })),
    fetchRecorded: vi.fn(async () => ({
      ok: true as const,
      value: {
        records: [],
        total: 0,
      },
    })),
    fetchRecordedOptions: vi.fn(),
    fetchRuleKeywords: vi.fn(),
    fetchRule: vi.fn(async () => ({
      ok: true as const,
      value: { id: 55, keyword: 'Synthetic rule' },
    })),
    fetchRecordedDetail: vi.fn(async () => ({
      ok: true as const,
      value: {
        id: 101,
        name: 'Synthetic recording one',
      },
    })),
    fetchDropLog: vi.fn(),
    createRecorded: vi.fn(),
    uploadVideoFile: vi.fn(),
    protectRecorded: vi.fn(async () => ({ ok: true as const, value: undefined })),
    unprotectRecorded: vi.fn(async () => ({ ok: true as const, value: undefined })),
    deleteRecorded: vi.fn(async () => ({ ok: true as const, value: undefined })),
    deleteVideoFile: vi.fn(async () => ({ ok: true as const, value: undefined })),
    cleanupRecorded: vi.fn(),
    cleanupThumbnails: vi.fn(),
    addEncode: vi.fn(),
    stopEncode: vi.fn(async () => ({ ok: true as const, value: undefined })),
    sendVideoFileToKodi: vi.fn(),
  }
}

export async function findRecordingMenu(recordingName: string) {
  return screen.findByRole('button', { name: `録画メニュー: ${recordingName}` })
}
