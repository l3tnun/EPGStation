import { fireEvent, screen } from '@testing-library/react'
import { expect, vi } from 'vitest'
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

export type TestReservesRepository = ReservesApiRepository & {
  deleteReserve: ReturnType<typeof vi.fn>
  fetchManualReserve: ReturnType<typeof vi.fn>
  fetchManualProgram: ReturnType<typeof vi.fn>
  addManualReserve: ReturnType<typeof vi.fn>
  updateManualReserve: ReturnType<typeof vi.fn>
}

export function createReservesRepository(): TestReservesRepository {
  return {
    fetchReserves: vi.fn(async () => ({
      ok: true as const,
      value: {
        reserves: [
          {
            id: 101,
            name: 'Synthetic reserve one',
            channelId: 301,
            channelName: 'Synthetic channel',
            startAt: Date.parse('2026-05-05T10:15:00+09:00'),
            endAt: Date.parse('2026-05-05T10:45:00+09:00'),
            genres: ['Synthetic genre'],
            description: 'Synthetic reserve description',
            extended: 'detail https://example.invalid/reserve-info',
            ruleId: 501,
          },
          {
            id: 102,
            name: 'Synthetic reserve two',
            channelId: 302,
            startAt: Date.parse('2026-05-05T11:00:00+09:00'),
            endAt: Date.parse('2026-05-05T11:30:00+09:00'),
            genre1: 7,
            subGenre1: 3,
          },
        ],
        total: 50,
      },
    })),
    unlockSkipReserve: vi.fn(async () => ({
      ok: true as const,
      value: undefined,
    })),
    unlockOverlapReserve: vi.fn(async () => ({
      ok: true as const,
      value: undefined,
    })),
    deleteReserve: vi.fn(async () => ({
      ok: true as const,
      value: undefined,
    })),
    updateReserves: vi.fn(async () => ({
      ok: true as const,
      value: undefined,
    })),
    fetchManualReserve: vi.fn(async () => ({
      ok: true as const,
      value: {
        id: 701,
        programId: 801,
        name: 'Synthetic editable reserve',
        channelId: 401,
        startAt: Date.parse('2026-05-05T12:00:00+09:00'),
        endAt: Date.parse('2026-05-05T12:30:00+09:00'),
        isTimeSpecified: false,
        allowEndLack: false,
        parentDirectoryName: 'default',
        directory: 'existing-dir',
        recordedFormat: 'existing-format',
        encodeMode1: 'h264',
        encodeDirectory1: 'encoded',
        isDeleteOriginalAfterEncode: true,
      },
    })),
    fetchManualProgram: vi.fn(async () => ({
      ok: true as const,
      value: {
        id: 801,
        name: 'Synthetic program detail',
        channelId: 401,
        channelName: 'Synthetic detail channel',
        startAt: Date.parse('2026-05-05T12:00:00+09:00'),
        endAt: Date.parse('2026-05-05T12:30:00+09:00'),
        description: 'Synthetic program description',
      },
    })),
    addManualReserve: vi.fn(async () => ({
      ok: true as const,
      value: { reserveId: 901 },
    })),
    updateManualReserve: vi.fn(async () => ({
      ok: true as const,
      value: undefined,
    })),
  }
}

export function createDeferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve
  })

  return { promise, resolve }
}

export function createManualOptionsFetch(options?: { encode?: readonly string[] }) {
  const encode = options?.encode ?? ['synthetic-encode']

  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)

    if (url.includes('/api/channels')) {
      return new Response(
        JSON.stringify([{ id: 501, halfWidthName: 'Synthetic channel option' }]),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }

    if (url.includes('/api/config')) {
      return new Response(
        JSON.stringify({
          recorded: ['synthetic-parent'],
          encode,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }

    return new Response(null, { status: 404 })
  })
}

export async function selectManualOption(label: string, option: string): Promise<void> {
  fireEvent.mouseDown(screen.getByRole('combobox', { name: label }))
  fireEvent.click(await screen.findByRole('option', { name: option }))
}

export async function findReserveRow(name: string | RegExp): Promise<HTMLElement> {
  const title = await screen.findByText(name)
  const row = title.closest('[data-testid="reserves-list-item"]')

  expect(row).not.toBeNull()

  return (title.closest('button') ?? row) as HTMLElement
}

export function getReserveRow(name: string | RegExp): HTMLElement {
  const title = screen.getByText(name)
  const row = title.closest('[data-testid="reserves-list-item"]')

  expect(row).not.toBeNull()

  return (title.closest('button') ?? row) as HTMLElement
}
