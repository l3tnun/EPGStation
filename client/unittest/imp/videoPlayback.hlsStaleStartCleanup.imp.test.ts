import { afterEach, describe, expect, it, vi } from 'vitest'
import { HlsLifecycleController } from '@/features/video/playback/playbackLifecycle'
import type { HlsLifecycleSnapshot } from '@/features/video/playback/playbackLifecycleTypes'

type StreamId = number | string | null

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })

  return { promise, resolve, reject }
}

const STOP_FAILURE = 'ストリーム停止に失敗'

describe('Video Playback HLS lifecycle stale start and stop failure handling', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('starts in the idle state with no stream, error or snackbar', () => {
    const controller = new HlsLifecycleController({
      repository: {
        start: vi.fn(async () => ({ streamId: 1 })),
        fetchStreams: vi.fn(async () => []),
        keep: vi.fn(async () => undefined),
        stop: vi.fn(async () => undefined),
      },
    })

    expect(controller.snapshot()).toStrictEqual({
      state: 'idle',
      streamId: null,
      errorMessage: null,
      snackbarText: null,
    })
  })

  it('does not report a stop failure while replacing the previous stream on restart', async () => {
    vi.useFakeTimers()
    const snapshots: HlsLifecycleSnapshot[] = []
    const repository = {
      start: vi
        .fn()
        .mockImplementationOnce(async () => ({ streamId: 1 }))
        .mockImplementationOnce(async () => ({ streamId: 2 })),
      fetchStreams: vi.fn(async () => [
        { streamId: 1, isEnabled: false },
        { streamId: 2, isEnabled: false },
      ]),
      keep: vi.fn(async () => undefined),
      stop: vi
        .fn()
        .mockImplementationOnce(async () => {
          throw new Error('synthetic stop failure')
        })
        .mockImplementation(async () => undefined),
    }
    const controller = new HlsLifecycleController({
      repository,
      onChange: (snapshot) => snapshots.push(snapshot),
    })

    const first = controller.start()
    await vi.advanceTimersByTimeAsync(0)
    const second = controller.start()
    await vi.advanceTimersByTimeAsync(0)

    expect(repository.stop).toHaveBeenCalledWith(1)
    expect(controller.snapshot()).toMatchObject({ state: 'waiting', streamId: 2 })
    expect(snapshots.filter((snapshot) => snapshot.snackbarText === STOP_FAILURE)).toHaveLength(0)

    controller.cleanup({ emit: false })
    await Promise.all([first, second])
  })

  it('aborts the start request signal when the start request fails', async () => {
    const signals: (AbortSignal | undefined)[] = []
    const controller = new HlsLifecycleController({
      repository: {
        start: vi.fn(async (signal?: AbortSignal) => {
          signals.push(signal)
          throw new Error('synthetic start failure')
        }),
        fetchStreams: vi.fn(async () => []),
        keep: vi.fn(async () => undefined),
        stop: vi.fn(async () => undefined),
      },
    })

    const snapshot = await controller.start()

    expect(snapshot).toMatchObject({ state: 'error', errorMessage: 'ストリーム開始に失敗' })
    expect(signals).toHaveLength(1)
    expect(signals[0]?.aborted).toBe(true)
  })

  it('aborts the start request signal when the response carries no stream id', async () => {
    const signals: (AbortSignal | undefined)[] = []
    const controller = new HlsLifecycleController({
      repository: {
        start: vi.fn(async (signal?: AbortSignal) => {
          signals.push(signal)
          return { streamId: null }
        }),
        fetchStreams: vi.fn(async () => []),
        keep: vi.fn(async () => undefined),
        stop: vi.fn(async () => undefined),
      },
    })

    const snapshot = await controller.start()

    expect(snapshot).toMatchObject({ state: 'error', errorMessage: 'ストリーム id 取得に失敗' })
    expect(signals).toHaveLength(1)
    expect(signals[0]?.aborted).toBe(true)
  })

  it('does not try to stop a stream when a superseded start response carries no stream id', async () => {
    const pending = deferred<{ streamId: StreamId }>()
    const repository = {
      start: vi.fn(() => pending.promise),
      fetchStreams: vi.fn(async () => []),
      keep: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
    }
    const controller = new HlsLifecycleController({ repository })

    const start = controller.start()
    await controller.stop()
    pending.resolve({ streamId: null })
    const snapshot = await start

    expect(repository.stop).not.toHaveBeenCalled()
    expect(snapshot).toMatchObject({ state: 'stopped', streamId: null })
  })

  it('stops a superseded start stream without reporting a stop failure', async () => {
    const pending = deferred<{ streamId: StreamId }>()
    const repository = {
      start: vi.fn(() => pending.promise),
      fetchStreams: vi.fn(async () => []),
      keep: vi.fn(async () => undefined),
      stop: vi.fn(async () => {
        throw new Error('synthetic stop failure')
      }),
    }
    const controller = new HlsLifecycleController({ repository })

    const start = controller.start()
    await controller.stop()
    pending.resolve({ streamId: 7 })
    const snapshot = await start

    expect(repository.stop).toHaveBeenCalledTimes(1)
    expect(repository.stop).toHaveBeenCalledWith(7)
    expect(snapshot).toMatchObject({ state: 'stopped', streamId: null, snackbarText: null })
    expect(controller.snapshot().snackbarText).toBeNull()
  })

  it('treats a start that began before cleanup() as superseded after a later start', async () => {
    vi.useFakeTimers()
    const firstResponse = deferred<{ streamId: StreamId }>()
    const secondResponse = deferred<{ streamId: StreamId }>()
    const repository = {
      start: vi
        .fn()
        .mockImplementationOnce(() => firstResponse.promise)
        .mockImplementationOnce(() => secondResponse.promise),
      fetchStreams: vi.fn(async () => []),
      keep: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
    }
    const controller = new HlsLifecycleController({ repository })

    const first = controller.start()
    controller.cleanup()
    const second = controller.start()

    firstResponse.resolve({ streamId: 5 })
    await vi.advanceTimersByTimeAsync(0)

    expect(repository.stop).toHaveBeenCalledWith(5)
    expect(controller.snapshot()).toMatchObject({ state: 'starting', streamId: null })

    controller.cleanup()
    secondResponse.resolve({ streamId: 6 })
    await Promise.all([first, second])
    expect(repository.stop).toHaveBeenCalledWith(6)
  })

  it('does not call stop on cleanup() when no stream was started', () => {
    const repository = {
      start: vi.fn(async () => ({ streamId: 1 })),
      fetchStreams: vi.fn(async () => []),
      keep: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
    }
    const controller = new HlsLifecycleController({ repository })

    controller.cleanup()

    expect(repository.stop).not.toHaveBeenCalled()
  })

  it('calls the stop failure callback on cleanup() without reporting a snackbar', async () => {
    vi.useFakeTimers()
    const snapshots: HlsLifecycleSnapshot[] = []
    const onStopFailure = vi.fn()
    const repository = {
      start: vi.fn(async () => ({ streamId: 9 })),
      fetchStreams: vi.fn(async () => [{ streamId: 9, isEnabled: false }]),
      keep: vi.fn(async () => undefined),
      stop: vi.fn(async () => {
        throw new Error('synthetic stop failure')
      }),
    }
    const controller = new HlsLifecycleController({
      repository,
      onChange: (snapshot) => snapshots.push(snapshot),
    })

    const start = controller.start()
    await vi.advanceTimersByTimeAsync(0)
    const changesBeforeCleanup = snapshots.length

    controller.cleanup({ emit: false, onStopFailure })
    await vi.advanceTimersByTimeAsync(0)
    await start

    expect(repository.stop).toHaveBeenCalledWith(9)
    expect(onStopFailure).toHaveBeenCalledTimes(1)
    expect(snapshots).toHaveLength(changesBeforeCleanup)
    expect(controller.snapshot().snackbarText).toBeNull()
  })
})
