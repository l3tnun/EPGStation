import { afterEach, describe, expect, it, vi } from 'vitest'
import { HlsLifecycleController } from '@/features/video/playback/playbackLifecycleController'
import type { HlsLifecycleRepository } from '@/features/video/playback/playbackLifecycleTypes'
import { createHlsReadyNotifications } from '@/shared/hlsReadyNotifications'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('direct HLS readiness notification', () => {
  it('accepts an event before the start response only when both identifiers match', async () => {
    vi.useFakeTimers()
    const notifications = createHlsReadyNotifications()
    const response = deferred<{ streamId: number }>()
    const repository = {
      start: vi.fn((signal?: AbortSignal, id?: string) => {
        void signal
        void id
        return response.promise
      }),
      fetchStreams: vi.fn(async () => [{ streamId: 7, isEnabled: true }]),
      keep: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
    }
    const controller = new HlsLifecycleController({
      repository,
      subscribeReady: notifications.subscribe,
    })
    const start = controller.start()
    const requestId = repository.start.mock.calls[0][1]
    expect(requestId).toMatch(/^[0-9a-f-]{36}$/)
    notifications.notify({ streamId: 7, startRequestId: '00000000-0000-4000-8000-000000000000' })
    notifications.notify({ streamId: 8, startRequestId: requestId! })
    expect(controller.snapshot().state).toBe('starting')
    notifications.notify({ streamId: 7, startRequestId: requestId! })
    response.resolve({ streamId: 7 })
    await start
    expect(controller.snapshot().state).toBe('ready')
    expect(repository.fetchStreams).not.toHaveBeenCalled()
    await controller.stop()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('accepts a matching notification after the start response without polling', async () => {
    vi.useFakeTimers()
    const notifications = createHlsReadyNotifications()
    const repository = {
      start: vi.fn<HlsLifecycleRepository['start']>(async () => ({ streamId: 7 })),
      fetchStreams: vi.fn(async () => []),
      keep: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
    }
    const controller = new HlsLifecycleController({
      repository,
      subscribeReady: notifications.subscribe,
    })
    const start = controller.start()
    const requestId = repository.start.mock.calls[0][1]!
    await vi.advanceTimersByTimeAsync(0)
    expect(controller.snapshot()).toMatchObject({ state: 'waiting', streamId: 7 })

    notifications.notify({ streamId: 8, startRequestId: requestId })
    expect(controller.snapshot().state).toBe('waiting')

    notifications.notify({ streamId: 7, startRequestId: requestId })
    expect(controller.snapshot()).toMatchObject({ state: 'ready', streamId: 7 })
    await start
    expect(repository.fetchStreams).not.toHaveBeenCalled()
    await controller.stop()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('uses the one-second state check when a notification is missed', async () => {
    vi.useFakeTimers()
    const notifications = createHlsReadyNotifications()
    const repository = {
      start: vi.fn(async () => ({ streamId: 7 })),
      fetchStreams: vi.fn(async () => [{ streamId: 7, isEnabled: true }]),
      keep: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
    }
    const controller = new HlsLifecycleController({
      repository,
      subscribeReady: notifications.subscribe,
    })
    const start = controller.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(repository.fetchStreams).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1000)
    await start
    expect(repository.fetchStreams).toHaveBeenCalledOnce()
    expect(controller.snapshot().state).toBe('ready')
    await controller.stop()
  })
})
