import { afterEach, describe, expect, it, vi } from 'vitest'
import { HlsLifecycleController } from '@/features/video/playback/playbackLifecycle'
import type { HlsLifecycleSnapshot } from '@/features/video/playback/playbackLifecycleTypes'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })

  return { promise, resolve, reject }
}

describe('Video Playback HLS lifecycle readiness timer release and retry delay', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('releases the readiness poll and timeout timers once the stream is ready, keeping only the keep timer', async () => {
    vi.useFakeTimers()
    const controller = new HlsLifecycleController({
      repository: {
        start: vi.fn(async () => ({ streamId: 1 })),
        fetchStreams: vi.fn(async () => [{ streamId: 1, isEnabled: true }]),
        keep: vi.fn(async () => undefined),
        stop: vi.fn(async () => undefined),
      },
      readinessPollMs: 1000,
      readinessTimeoutMs: 5000,
      keepIntervalMs: 10000,
    })

    const start = controller.start()
    await vi.advanceTimersByTimeAsync(1000)
    await start

    expect(controller.snapshot()).toMatchObject({ state: 'ready', streamId: 1 })
    expect(vi.getTimerCount()).toBe(1)
  })

  it('releases every timer when the stream disappears from the stream list, without reporting a stop failure', async () => {
    vi.useFakeTimers()
    const snapshots: HlsLifecycleSnapshot[] = []
    const repository = {
      start: vi.fn(async () => ({ streamId: 1 })),
      fetchStreams: vi.fn(async () => []),
      keep: vi.fn(async () => undefined),
      stop: vi.fn(async () => {
        throw new Error('synthetic stop failure')
      }),
    }
    const controller = new HlsLifecycleController({
      repository,
      readinessPollMs: 1000,
      readinessTimeoutMs: 5000,
      keepIntervalMs: 10000,
      onChange: (snapshot) => snapshots.push(snapshot),
    })

    const start = controller.start()
    await vi.advanceTimersByTimeAsync(1000)
    await start

    expect(repository.stop).toHaveBeenCalledWith(1)
    expect(controller.snapshot()).toMatchObject({
      state: 'error',
      streamId: null,
      errorMessage: 'ストリームが停止しました',
      snackbarText: null,
    })
    expect(snapshots.filter((snapshot) => snapshot.snackbarText !== null)).toHaveLength(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('releases the readiness poll, timeout and keep timers when stopped while waiting', async () => {
    vi.useFakeTimers()
    const controller = new HlsLifecycleController({
      repository: {
        start: vi.fn(async () => ({ streamId: 1 })),
        fetchStreams: vi.fn(async () => [{ streamId: 1, isEnabled: false }]),
        keep: vi.fn(async () => undefined),
        stop: vi.fn(async () => undefined),
      },
      readinessPollMs: 1000,
      readinessTimeoutMs: 5000,
      keepIntervalMs: 10000,
    })

    const start = controller.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(controller.snapshot()).toMatchObject({ state: 'waiting', streamId: 1 })
    expect(vi.getTimerCount()).toBe(3)

    await controller.stop()
    await start

    expect(vi.getTimerCount()).toBe(0)
  })

  it('lets a later wait be released by stop() after a superseded poll settles late', async () => {
    vi.useFakeTimers()
    const firstFetch = deferred<readonly { streamId: number; isEnabled: boolean }[]>()
    const repository = {
      start: vi
        .fn()
        .mockImplementationOnce(async () => ({ streamId: 101 }))
        .mockImplementationOnce(async () => ({ streamId: 102 })),
      fetchStreams: vi
        .fn()
        .mockImplementationOnce(() => firstFetch.promise)
        .mockImplementation(async () => [{ streamId: 102, isEnabled: false }]),
      keep: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
    }
    const controller = new HlsLifecycleController({
      repository,
      readinessPollMs: 1000,
      readinessTimeoutMs: 50000,
      keepIntervalMs: 10000,
    })

    const first = controller.start()
    await vi.advanceTimersByTimeAsync(1000)
    expect(repository.fetchStreams).toHaveBeenCalledTimes(1)

    const second = controller.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(controller.snapshot()).toMatchObject({ state: 'waiting', streamId: 102 })

    firstFetch.resolve([{ streamId: 101, isEnabled: true }])
    await vi.advanceTimersByTimeAsync(0)
    expect(controller.snapshot()).toMatchObject({ state: 'waiting', streamId: 102 })

    let secondSettled = false
    void second.then(() => {
      secondSettled = true
    })
    await controller.stop()
    await vi.advanceTimersByTimeAsync(0)

    expect(secondSettled).toBe(true)
    await first
  })

  it('waits the configured retry delay before retrying a failed start', async () => {
    vi.useFakeTimers()
    const repository = {
      start: vi.fn(async () => {
        throw new Error('synthetic start failure')
      }),
      fetchStreams: vi.fn(async () => []),
      keep: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
    }
    const controller = new HlsLifecycleController({
      repository,
      startRetryCount: 1,
      retryDelayMs: 200,
    })

    const start = controller.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(repository.start).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(199)
    expect(repository.start).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(1)
    expect(repository.start).toHaveBeenCalledTimes(2)
    await start
    expect(controller.snapshot()).toMatchObject({ state: 'error' })
  })

  it('does not leave a retry delay timer running when the start is superseded before the delay begins', async () => {
    vi.useFakeTimers()
    const response = deferred<{ streamId: number }>()
    const repository = {
      start: vi.fn(() => response.promise),
      fetchStreams: vi.fn(async () => []),
      keep: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
    }
    const controller = new HlsLifecycleController({
      repository,
      startRetryCount: 1,
      retryDelayMs: 200,
    })

    const start = controller.start()
    await vi.advanceTimersByTimeAsync(0)
    await controller.stop()
    response.reject(new Error('synthetic start failure'))
    await vi.advanceTimersByTimeAsync(0)

    expect(vi.getTimerCount()).toBe(0)
    await start
    expect(repository.start).toHaveBeenCalledTimes(1)
  })
})
