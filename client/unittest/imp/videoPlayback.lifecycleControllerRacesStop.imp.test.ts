import { afterEach, describe, expect, it, vi } from 'vitest'
import { HlsLifecycleController } from '@/features/video/playback/playbackLifecycle'

describe('Video Playback HLS lifecycle controller race conditions (stop/failure recovery)', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('discards a stale readiness-poll failure that arrives while an earlier failure is still stopping the stream', async () => {
    vi.useFakeTimers()
    let rejectPoll: ((error: unknown) => void) | undefined
    let resolveStop: (() => void) | undefined
    const repository = {
      start: vi.fn(async () => ({ streamId: 141 })),
      fetchStreams: vi.fn(
        () =>
          new Promise<readonly { streamId: number; isEnabled: boolean }[]>((_resolve, reject) => {
            rejectPoll = reject
          }),
      ),
      keep: vi.fn(async () => undefined),
      stop: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            resolveStop = resolve
          }),
      ),
    }
    const controller = new HlsLifecycleController({
      repository,
      readinessPollMs: 1000,
      readinessTimeoutMs: 1500,
      keepIntervalMs: 10000,
    })

    const startPromise = controller.start()
    // The first readiness poll starts and never settles on its own.
    await vi.advanceTimersByTimeAsync(1000)
    expect(repository.fetchStreams).toHaveBeenCalledTimes(1)

    // The readiness timeout fires while that poll is still pending: this is the first
    // call to resolveFailure(), which starts stopping the stream (also left pending).
    await vi.advanceTimersByTimeAsync(500)

    // The stale poll now rejects, triggering a second, redundant resolveFailure() call
    // while the first one is still awaiting stopStream() -- it must be a no-op.
    rejectPoll?.(new Error('synthetic stale readiness poll failure'))
    await vi.advanceTimersByTimeAsync(0)

    resolveStop?.()
    await startPromise

    expect(controller.snapshot()).toMatchObject({
      state: 'error',
      streamId: null,
      errorMessage: 'ストリーム準備に失敗',
    })
    // stopStream() must only be invoked once even though both readiness failure
    // triggers fired for the same generation.
    expect(repository.stop).toHaveBeenCalledTimes(1)
  })

  it('resolves immediately without stopping a stream when stop() is called before any stream has started', async () => {
    const repository = {
      start: vi.fn(async () => ({ streamId: 151 })),
      fetchStreams: vi.fn(async () => []),
      keep: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
    }
    const controller = new HlsLifecycleController({ repository })

    await expect(controller.stop()).resolves.toStrictEqual({
      state: 'stopped',
      streamId: null,
      errorMessage: null,
      snackbarText: null,
    })
    expect(repository.stop).not.toHaveBeenCalled()
  })

  it('discards a stale successful start (missing stream id) once a concurrent restart has taken over', async () => {
    vi.useFakeTimers()
    let resolveFirstStart: ((value: { streamId: number | null }) => void) | undefined
    const repository = {
      start: vi
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise<{ streamId: number | null }>((resolve) => {
              resolveFirstStart = resolve
            }),
        )
        .mockImplementationOnce(async () => ({ streamId: 162 })),
      fetchStreams: vi.fn(async () => [{ streamId: 162, isEnabled: true }]),
      keep: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
    }
    const controller = new HlsLifecycleController({
      repository,
      readinessPollMs: 1000,
      readinessTimeoutMs: 5000,
      keepIntervalMs: 10000,
    })

    const firstStart = controller.start()
    await vi.advanceTimersByTimeAsync(0)

    const secondStart = controller.start()
    await vi.advanceTimersByTimeAsync(1000)
    await secondStart

    // The first start's repository.start() call finally resolves with a missing stream
    // id, but a newer generation has since taken over -- this must be a silent no-op
    // rather than overwriting the current ready snapshot with an error.
    resolveFirstStart?.({ streamId: null })
    await vi.advanceTimersByTimeAsync(0)
    await firstStart

    expect(controller.snapshot()).toMatchObject({ state: 'ready', streamId: 162 })
    await controller.stop()
  })

  it('discards a stale readiness failure whose stopStream() resolves after a concurrent restart', async () => {
    vi.useFakeTimers()
    let resolveFirstStop: (() => void) | undefined
    const repository = {
      start: vi
        .fn()
        .mockImplementationOnce(async () => ({ streamId: 171 }))
        .mockImplementationOnce(async () => ({ streamId: 172 })),
      fetchStreams: vi
        .fn()
        .mockImplementationOnce(async () => {
          throw new Error('synthetic readiness poll failure')
        })
        .mockImplementation(async () => [{ streamId: 172, isEnabled: true }]),
      keep: vi.fn(async () => undefined),
      stop: vi
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise<void>((resolve) => {
              resolveFirstStop = resolve
            }),
        )
        .mockImplementation(async () => undefined),
    }
    const controller = new HlsLifecycleController({
      repository,
      readinessPollMs: 1000,
      readinessTimeoutMs: 5000,
      keepIntervalMs: 10000,
    })

    const firstStart = controller.start()
    await vi.advanceTimersByTimeAsync(1000)
    // The first stream's readiness poll rejects, and resolveFailure() begins stopping
    // stream 171 (left pending via resolveFirstStop).

    // A second start takes over before that stop settles.
    const secondStart = controller.start()
    await vi.advanceTimersByTimeAsync(1000)
    await secondStart

    // The stale stopStream() from the first failure now resolves: since generation has
    // moved on, this must not overwrite the current (now-ready) snapshot with an error.
    resolveFirstStop?.()
    await vi.advanceTimersByTimeAsync(0)
    await firstStart

    expect(controller.snapshot()).toMatchObject({ state: 'ready', streamId: 172 })
    await controller.stop()
  })

  it('resolves a pending start retry delay immediately when a concurrent restart invalidates it mid-attempt', async () => {
    vi.useFakeTimers()
    let rejectFirstAttempt: ((error: unknown) => void) | undefined
    const repository = {
      start: vi
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise((_resolve, reject) => {
              rejectFirstAttempt = reject
            }),
        )
        .mockImplementationOnce(async () => ({ streamId: 182 })),
      fetchStreams: vi.fn(async () => [{ streamId: 182, isEnabled: true }]),
      keep: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
    }
    const controller = new HlsLifecycleController({
      repository,
      readinessPollMs: 1000,
      readinessTimeoutMs: 5000,
      keepIntervalMs: 10000,
      startRetryCount: 1,
      // A long delay makes it obvious the retry wait resolved immediately from the
      // generation-invalidation branch rather than from its own setTimeout firing.
      retryDelayMs: 60000,
    })

    const firstStart = controller.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(repository.start).toHaveBeenCalledTimes(1)

    // A second start bumps the generation while the first attempt's repository.start()
    // call is still pending.
    const secondStart = controller.start()
    await vi.advanceTimersByTimeAsync(0)

    // The first attempt now fails: startWithRetry() records the error and calls
    // delayRetry() with an already-stale token, which must resolve immediately instead
    // of waiting out the (very long) retryDelayMs.
    rejectFirstAttempt?.(new Error('synthetic first-attempt failure'))
    await vi.advanceTimersByTimeAsync(0)

    await vi.advanceTimersByTimeAsync(1000)
    await secondStart
    await firstStart

    expect(controller.snapshot()).toMatchObject({ state: 'ready', streamId: 182 })
    await controller.stop()
  })
})
