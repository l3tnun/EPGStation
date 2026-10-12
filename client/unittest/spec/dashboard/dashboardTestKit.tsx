import { fireEvent, screen } from '@testing-library/react'
import { vi } from 'vitest'
import { type ScrollHistoryState } from '@/app/scrollHistory'
import type { DashboardApiRepository } from '@/features/dashboard/dashboardApi'
import type { RecordedApiRepository } from '@/features/recorded/recordedApi'
import type { RecordingApiRepository } from '@/features/recording'
import type { ReservesApiRepository } from '@/features/reserves/reservesApi'

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

export async function changeSettingsSelect(name: string, optionName: string) {
  fireEvent.mouseDown(await screen.findByRole('combobox', { name }))
  fireEvent.click(await screen.findByRole('option', { name: optionName }))
}

export function createDashboardRepository(): DashboardApiRepository {
  return {
    fetchReserveCounts: vi.fn(async () => ({
      ok: true as const,
      value: {
        normal: 1,
        conflicts: 0,
        skips: 0,
        overlaps: 0,
      },
    })),
    fetchRecording: vi.fn(async () => ({
      ok: true as const,
      value: {
        records: [{ id: 1, name: 'Synthetic recording' }],
        total: 1,
      },
    })),
    fetchRecorded: vi.fn(async () => ({
      ok: true as const,
      value: {
        records: [
          {
            id: 2,
            name: 'Synthetic recorded',
            channelName: 'Synthetic channel',
            startAt: Date.parse('2026-05-05T10:15:00+09:00'),
            endAt: Date.parse('2026-05-05T10:45:00+09:00'),
          },
        ],
        total: 1,
      },
    })),
    fetchReserves: vi.fn(async () => ({
      ok: true as const,
      value: {
        reserves: [{ id: 3, name: 'Synthetic reserve' }],
        total: 1,
      },
    })),
  }
}

export function createRecordedRepository(): RecordedApiRepository {
  return {
    fetchRecorded: vi.fn(async () => ({ ok: true as const, value: { records: [], total: 0 } })),
    fetchRecordedOptions: vi.fn(async () => ({
      ok: true as const,
      value: { channels: [], genres: [] },
    })),
    fetchRuleKeywords: vi.fn(async () => ({ ok: true as const, value: [] })),
    fetchRule: vi.fn(async (ruleId: number) => ({ ok: true as const, value: { id: ruleId } })),
    fetchRecordedDetail: vi.fn(async ({ recordedId }) => ({
      ok: true as const,
      value: { id: recordedId, name: 'Synthetic detail' },
    })),
    fetchDropLog: vi.fn(async () => ({ ok: true as const, value: '' })),
    createRecorded: vi.fn(async () => ({ ok: true as const, value: { recordedId: 1 } })),
    uploadVideoFile: vi.fn(async () => ({ ok: true as const, value: undefined })),
    protectRecorded: vi.fn(async () => ({ ok: true as const, value: undefined })),
    unprotectRecorded: vi.fn(async () => ({ ok: true as const, value: undefined })),
    deleteRecorded: vi.fn(async () => ({ ok: true as const, value: undefined })),
    deleteVideoFile: vi.fn(async () => ({ ok: true as const, value: undefined })),
    cleanupRecorded: vi.fn(async () => ({ ok: true as const, value: undefined })),
    cleanupThumbnails: vi.fn(async () => ({ ok: true as const, value: undefined })),
    addEncode: vi.fn(async () => ({ ok: true as const, value: undefined })),
    stopEncode: vi.fn(async () => ({ ok: true as const, value: undefined })),
    sendVideoFileToKodi: vi.fn(async () => ({ ok: true as const, value: undefined })),
  }
}

export function createRecordingRepository(): RecordingApiRepository {
  return {
    ...createRecordedRepository(),
    fetchRecording: vi.fn(async () => ({ ok: true as const, value: { records: [], total: 0 } })),
  }
}

export function createReservesRepository(): ReservesApiRepository {
  return {
    fetchReserves: vi.fn(async () => ({ ok: true as const, value: { reserves: [], total: 0 } })),
    fetchManualReserve: vi.fn(async ({ reserveId }) => ({
      ok: true as const,
      value: { id: reserveId, name: 'Synthetic reserve' },
    })),
    fetchManualProgram: vi.fn(async ({ programId }) => ({
      ok: true as const,
      value: {
        id: programId,
        name: 'Synthetic program',
        channelId: 1,
        startAt: 1_700_000_000_000,
        endAt: 1_700_003_600_000,
      },
    })),
    addManualReserve: vi.fn(async () => ({ ok: true as const, value: { reserveId: 1 } })),
    updateManualReserve: vi.fn(async () => ({ ok: true as const, value: undefined })),
    deleteReserve: vi.fn(async () => ({ ok: true as const, value: undefined })),
    unlockSkipReserve: vi.fn(async () => ({ ok: true as const, value: undefined })),
    unlockOverlapReserve: vi.fn(async () => ({ ok: true as const, value: undefined })),
    updateReserves: vi.fn(async () => ({ ok: true as const, value: undefined })),
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

export function createRouteAwareScrollHistorySpy(): ScrollHistoryState & {
  savedDataByUrl: Array<{ url: string; data: unknown }>
} {
  let currentUrl = window.location.href
  const savedDataByUrl: Array<{ url: string; data: unknown }> = []

  return {
    savedDataByUrl,
    isNeedRestoreHistory: () => false,
    saveScrollData(data, url) {
      savedDataByUrl.push({ url: url ?? currentUrl, data })
    },
    getScrollData: () => null,
    getHistoryPosition: () => null,
    updateHistoryPosition(_position, url) {
      currentUrl = url ?? window.location.href
    },
    emitDoneGetData() {
      return undefined
    },
    async onDoneGetData() {
      return undefined
    },
    clearRestoreHistory() {
      return undefined
    },
  }
}
