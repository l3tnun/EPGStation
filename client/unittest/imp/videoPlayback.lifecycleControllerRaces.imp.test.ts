import { afterEach, describe, expect, it, vi } from 'vitest'
import { HlsLifecycleController } from '@/features/video/playback/playbackLifecycle'

describe('Video Playback HLS lifecycle controller race conditions (start/poll/timeout)', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('silently invokes the keep-timer catch handler when a keep request fails', async () => {
    vi.useFakeTimers()
    const repository = {
      start: vi.fn(async () => ({ streamId: 91 })),
      fetchStreams: vi.fn(async () => [{ streamId: 91, isEnabled: true }]),
      keep: vi.fn(async () => {
        throw new Error('synthetic keep failure')
      }),
      stop: vi.fn(async () => undefined),
    }
    const controller = new HlsLifecycleController({
      repository,
      readinessPollMs: 1000,
      readinessTimeoutMs: 5000,
      keepIntervalMs: 10000,
    })

    const startPromise = controller.start()
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(1000)
    await startPromise
    expect(controller.snapshot()).toMatchObject({ state: 'ready', streamId: 91 })

    await vi.advanceTimersByTimeAsync(10000)
    await vi.advanceTimersByTimeAsync(0)

    expect(repository.keep).toHaveBeenCalledWith(91)
    // A rejected keep request must not surface as an unhandled rejection or error state.
    expect(controller.snapshot()).toMatchObject({ state: 'ready', streamId: 91 })

    await controller.stop()
  })

  it('completes the readiness wait as a stale generation when a poll resolves after a concurrent restart', async () => {
    vi.useFakeTimers()
    let resolveFirstFetch:
      ((value: readonly { streamId: number; isEnabled: boolean }[]) => void) | undefined
    const repository = {
      start: vi
        .fn(async () => ({ streamId: 101 }))
        .mockImplementationOnce(async () => ({ streamId: 101 }))
        .mockImplementationOnce(async () => ({ streamId: 102 })),
      fetchStreams: vi
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise<readonly { streamId: number; isEnabled: boolean }[]>((resolve) => {
              resolveFirstFetch = resolve
            }),
        )
        .mockImplementation(async () => [{ streamId: 102, isEnabled: true }]),
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
    await vi.advanceTimersByTimeAsync(1000)
    expect(repository.fetchStreams).toHaveBeenCalledTimes(1)

    // Restart before the first poll resolves: this bumps the generation while the
    // first waitForReadiness() poll's promise is still pending.
    const secondStart = controller.start()
    await vi.advanceTimersByTimeAsync(0)

    // The stale poll now resolves for the previous (no longer current) generation.
    resolveFirstFetch?.([{ streamId: 101, isEnabled: true }])
    await vi.advanceTimersByTimeAsync(0)

    await vi.advanceTimersByTimeAsync(1000)
    await secondStart
    await firstStart

    expect(controller.snapshot()).toMatchObject({ state: 'ready', streamId: 102 })
    await controller.stop()
  })

  it('completes the readiness wait as a stale generation when a poll rejects after a concurrent restart', async () => {
    vi.useFakeTimers()
    let rejectFirstFetch: ((error: unknown) => void) | undefined
    const repository = {
      start: vi
        .fn()
        .mockImplementationOnce(async () => ({ streamId: 111 }))
        .mockImplementationOnce(async () => ({ streamId: 112 })),
      fetchStreams: vi
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise<readonly { streamId: number; isEnabled: boolean }[]>((_resolve, reject) => {
              rejectFirstFetch = reject
            }),
        )
        .mockImplementation(async () => [{ streamId: 112, isEnabled: true }]),
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
    await vi.advanceTimersByTimeAsync(1000)

    const secondStart = controller.start()
    await vi.advanceTimersByTimeAsync(0)

    rejectFirstFetch?.(new Error('synthetic stale poll failure'))
    await vi.advanceTimersByTimeAsync(0)

    await vi.advanceTimersByTimeAsync(1000)
    await secondStart
    await firstStart

    expect(controller.snapshot()).toMatchObject({ state: 'ready', streamId: 112 })
    await controller.stop()
  })

  it('ignores a readiness timeout that fires for a stale generation after a concurrent restart', async () => {
    vi.useFakeTimers()
    const repository = {
      start: vi
        .fn()
        .mockImplementationOnce(async () => ({ streamId: 121 }))
        .mockImplementationOnce(async () => ({ streamId: 122 })),
      fetchStreams: vi
        .fn()
        .mockImplementationOnce(async () => [{ streamId: 121, isEnabled: false }])
        .mockImplementation(async () => [{ streamId: 122, isEnabled: true }]),
      keep: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
    }
    const controller = new HlsLifecycleController({
      repository,
      readinessPollMs: 1000,
      readinessTimeoutMs: 2000,
      keepIntervalMs: 10000,
    })

    const firstStart = controller.start()
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(1000)

    const secondStart = controller.start()
    await vi.advanceTimersByTimeAsync(0)

    // The first controller's readiness timeout (2000ms from its own start) fires while
    // the second start's wait is in flight, and must be treated as a stale generation.
    await vi.advanceTimersByTimeAsync(1000)
    await vi.advanceTimersByTimeAsync(0)

    await vi.advanceTimersByTimeAsync(1000)
    await secondStart
    await firstStart

    expect(controller.snapshot()).toMatchObject({ state: 'ready', streamId: 122 })
    await controller.stop()
  })

  it('aborts a retrying start with no recorded error when a third concurrent start invalidates it first', async () => {
    vi.useFakeTimers()
    let resolveSecondStop: (() => void) | undefined
    const repository = {
      start: vi
        .fn()
        .mockImplementationOnce(async () => ({ streamId: 131 }))
        .mockImplementationOnce(async () => ({ streamId: 133 })),
      fetchStreams: vi.fn(async () => []),
      keep: vi.fn(async () => undefined),
      stop: vi
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise<void>((resolve) => {
              resolveSecondStop = resolve
            }),
        )
        .mockImplementation(async () => undefined),
    }
    const controller = new HlsLifecycleController({
      repository,
      readinessPollMs: 1000,
      readinessTimeoutMs: 5000,
      keepIntervalMs: 10000,
      startRetryCount: 1,
      retryDelayMs: 500,
    })

    // First start reaches "waiting" (readiness never resolves in this test).
    const firstStart = controller.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(controller.snapshot()).toMatchObject({ state: 'waiting', streamId: 131 })

    // Second start begins stopping stream 131 (its own token is captured before that
    // stop resolves) but a third start bumps the generation again before the second
    // call's startWithRetry() loop ever runs, so its very first generation check fails
    // with no lastError recorded yet.
    const secondStart = controller.start()
    await vi.advanceTimersByTimeAsync(0)

    const thirdStart = controller.start()
    await vi.advanceTimersByTimeAsync(0)
    resolveSecondStop?.()

    // Resolve the still-pending third readiness wait deterministically instead of
    // racing the readiness poll/timeout timers.
    await controller.stop()
    await Promise.all([firstStart, secondStart, thirdStart])

    // Only the first and third starts ever reach repository.start(); the second is
    // aborted by the third before its startWithRetry() loop calls repository.start().
    expect(repository.start).toHaveBeenCalledTimes(2)
    expect(controller.snapshot()).toMatchObject({ state: 'stopped', streamId: null })
  })

  it('[AC 3.7] [AC 3.8] surfaces the start failure snackbar once every retry attempt is exhausted', async () => {
    vi.useFakeTimers()
    const repository = {
      start: vi.fn(async () => {
        throw new Error('synthetic persistent start failure')
      }),
      fetchStreams: vi.fn(async () => []),
      keep: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
    }
    const controller = new HlsLifecycleController({
      repository,
      readinessPollMs: 1000,
      readinessTimeoutMs: 5000,
      keepIntervalMs: 10000,
      startRetryCount: 1,
      retryDelayMs: 200,
    })

    const startPromise = controller.start()
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(200)
    await startPromise

    expect(repository.start).toHaveBeenCalledTimes(2)
    expect(controller.snapshot()).toMatchObject({
      state: 'error',
      streamId: null,
      errorMessage: 'ストリーム開始に失敗',
    })
  })
})
