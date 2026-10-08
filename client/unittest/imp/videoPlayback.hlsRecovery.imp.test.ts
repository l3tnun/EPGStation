import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  HLS_MISSING_ID_SNACKBAR,
  HLS_READINESS_FAILURE_MESSAGE,
  HLS_START_FAILURE_SNACKBAR,
  HLS_STOP_FAILURE_SNACKBAR,
  HLS_STREAM_LOST_MESSAGE,
  HlsLifecycleController,
} from '@/features/video/playback/playbackLifecycle'
import { flushMicrotasks } from './support/videoPlaybackFixtures'

describe('Video playback HLS lifecycle and direct stream constraints', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('turns HLS start, missing id, readiness timeout, and stop failures into recoverable state', async () => {
    vi.useFakeTimers()
    const startFailureController = new HlsLifecycleController({
      repository: {
        start: vi.fn(async () => {
          throw new Error('synthetic start failure')
        }),
        fetchStreams: vi.fn(),
        keep: vi.fn(),
        stop: vi.fn(),
      },
      readinessPollMs: 1000,
      readinessTimeoutMs: 5000,
      keepIntervalMs: 10000,
    })

    await startFailureController.start()
    expect(startFailureController.snapshot()).toMatchObject({
      state: 'error',
      errorMessage: HLS_START_FAILURE_SNACKBAR,
      snackbarText: HLS_START_FAILURE_SNACKBAR,
    })

    const missingIdController = new HlsLifecycleController({
      repository: {
        start: vi.fn(async () => ({ streamId: null })),
        fetchStreams: vi.fn(),
        keep: vi.fn(),
        stop: vi.fn(),
      },
      readinessPollMs: 1000,
      readinessTimeoutMs: 5000,
      keepIntervalMs: 10000,
    })

    await missingIdController.start()
    expect(missingIdController.snapshot()).toMatchObject({
      state: 'error',
      errorMessage: HLS_MISSING_ID_SNACKBAR,
      snackbarText: HLS_MISSING_ID_SNACKBAR,
    })

    // This exercises readinessTimeoutMs purely as the absolute safety net (see
    // playbackLifecycleControllerBase.ts): a short value is injected so the fake clock does not
    // need to advance the full production default (1800000ms) to prove the backstop still fires.
    // It does NOT stand in for the production default -- see the two tests below for the
    // present-but-disabled ("keeps waiting") and disappeared ("fails immediately") branches that
    // a fixed 30s cutoff would conflate.
    const timeoutRepository = {
      start: vi.fn(async () => ({ streamId: 91 })),
      fetchStreams: vi.fn(async () => [{ streamId: 91, isEnabled: false }]),
      keep: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
    }
    const timeoutController = new HlsLifecycleController({
      repository: timeoutRepository,
      readinessPollMs: 1000,
      readinessTimeoutMs: 2500,
      keepIntervalMs: 10000,
    })

    const timeoutPromise = timeoutController.start()
    await vi.advanceTimersByTimeAsync(3000)
    await timeoutPromise

    expect(timeoutController.snapshot()).toMatchObject({
      state: 'error',
      streamId: null,
      errorMessage: 'ストリーム準備に失敗',
      snackbarText: null,
    })
    expect(timeoutRepository.stop).toHaveBeenCalledWith(91)
    await vi.advanceTimersByTimeAsync(10000)
    expect(timeoutRepository.keep).not.toHaveBeenCalled()

    const stopFailureController = new HlsLifecycleController({
      repository: {
        start: vi.fn(async () => ({ streamId: 101 })),
        fetchStreams: vi.fn(async () => [{ streamId: 101, isEnabled: true }]),
        keep: vi.fn(async () => undefined),
        stop: vi.fn(async () => {
          throw new Error('synthetic stop failure')
        }),
      },
      readinessPollMs: 1000,
      readinessTimeoutMs: 5000,
      keepIntervalMs: 10000,
    })
    const stopStartPromise = stopFailureController.start()
    await vi.advanceTimersByTimeAsync(1000)
    await stopStartPromise

    await stopFailureController.stop()
    expect(stopFailureController.snapshot()).toMatchObject({
      state: 'stopped',
      streamId: null,
      snackbarText: HLS_STOP_FAILURE_SNACKBAR,
    })
  })

  it('cleans up late HLS start resolution with the generation token', async () => {
    vi.useFakeTimers()
    let resolveStart: ((value: { streamId: number }) => void) | undefined
    const repository = {
      start: vi.fn(
        () =>
          new Promise<{ streamId: number }>((resolve) => {
            resolveStart = resolve
          }),
      ),
      fetchStreams: vi.fn(async () => [{ streamId: 111, isEnabled: true }]),
      keep: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
    }
    const controller = new HlsLifecycleController({
      repository,
      readinessPollMs: 1000,
      readinessTimeoutMs: 5000,
      keepIntervalMs: 10000,
    })

    const startPromise = controller.start()
    await flushMicrotasks()
    controller.cleanup()
    resolveStart?.({ streamId: 111 })
    await startPromise

    expect(repository.stop).toHaveBeenCalledWith(111)
    expect(repository.fetchStreams).not.toHaveBeenCalled()
    expect(controller.snapshot()).toMatchObject({
      state: 'stopped',
      streamId: null,
    })
  })

  it('ignores late readiness resolution after cleanup and stops previous stream before restart', async () => {
    vi.useFakeTimers()
    let resolveReadiness:
      ((value: readonly { streamId: number; isEnabled: boolean }[]) => void) | undefined
    const repository = {
      start: vi
        .fn()
        .mockResolvedValueOnce({ streamId: 131 })
        .mockResolvedValueOnce({ streamId: 132 }),
      fetchStreams: vi.fn(
        () =>
          new Promise<readonly { streamId: number; isEnabled: boolean }[]>((resolve) => {
            resolveReadiness = resolve
          }),
      ),
      keep: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
    }
    const snapshots: string[] = []
    const controller = new HlsLifecycleController({
      repository,
      readinessPollMs: 1000,
      readinessTimeoutMs: 5000,
      keepIntervalMs: 10000,
      onChange: (snapshot) => {
        snapshots.push(snapshot.state)
      },
    })

    const firstStart = controller.start()
    await flushMicrotasks()
    await vi.advanceTimersByTimeAsync(1000)
    controller.cleanup()
    resolveReadiness?.([{ streamId: 131, isEnabled: true }])
    await firstStart

    expect(controller.snapshot()).toMatchObject({ state: 'stopped', streamId: null })
    expect(snapshots.at(-1)).toBe('stopped')

    const secondStart = controller.start()
    await flushMicrotasks()
    await vi.advanceTimersByTimeAsync(1000)
    resolveReadiness?.([{ streamId: 132, isEnabled: true }])
    await secondStart

    expect(controller.snapshot()).toMatchObject({ state: 'ready', streamId: 132 })

    const thirdStart = controller.start()
    await flushMicrotasks()
    expect(repository.stop).toHaveBeenCalledWith(132)
    resolveReadiness?.([{ streamId: 132, isEnabled: true }])
    await vi.advanceTimersByTimeAsync(1000)
    resolveReadiness?.([{ streamId: 132, isEnabled: true }])
    await thirdStart
  })

  it('keeps waiting past the old 30s cutoff while isEnabled stays false and the stream stays listed', async () => {
    // The production default (readinessTimeoutMs left unset) must not treat a present-but-disabled
    // stream as a failure just because 30s has elapsed.
    vi.useFakeTimers()
    const repository = {
      start: vi.fn(async () => ({ streamId: 201 })),
      fetchStreams: vi.fn(async () => [{ streamId: 201, isEnabled: false }]),
      keep: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
    }
    const controller = new HlsLifecycleController({
      repository,
      readinessPollMs: 1000,
      keepIntervalMs: 10000,
    })

    const startPromise = controller.start()
    await flushMicrotasks()
    await vi.advanceTimersByTimeAsync(60_000)

    expect(controller.snapshot()).toMatchObject({ state: 'waiting', streamId: 201 })
    expect(repository.stop).not.toHaveBeenCalled()

    controller.cleanup({ emit: false })
    await startPromise
  })

  it('pins the production readinessTimeoutMs default to exactly 1800000ms', async () => {
    // This is the machine-checked counterpart to the readinessTimeoutMs default documented in
    // .kiro/specs/frontend-video-playback/design.md: it fails if the constructor default in
    // playbackLifecycleControllerBase.ts drifts away from 1800000 (30 minutes) in either
    // direction, not just "is bigger than the old 30s cutoff" (the 'keeps waiting' test above
    // only proves that). readinessTimeoutMs is intentionally left unset here so the real
    // production default applies.
    vi.useFakeTimers()
    const repository = {
      start: vi.fn(async () => ({ streamId: 301 })),
      fetchStreams: vi.fn(async () => [{ streamId: 301, isEnabled: false }]),
      keep: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
    }
    const controller = new HlsLifecycleController({
      repository,
      readinessPollMs: 1000,
      keepIntervalMs: 10000,
    })

    const startPromise = controller.start()
    await flushMicrotasks()

    // One poll tick before the boundary the safety net must not have fired yet.
    await vi.advanceTimersByTimeAsync(1_800_000 - 1_000)
    expect(controller.snapshot()).toMatchObject({ state: 'waiting', streamId: 301 })
    expect(repository.stop).not.toHaveBeenCalled()

    // Crossing 1_800_000ms total must fire the safety net exactly here, not later.
    await vi.advanceTimersByTimeAsync(1_000)
    await startPromise

    expect(controller.snapshot()).toMatchObject({
      state: 'error',
      streamId: null,
      errorMessage: HLS_READINESS_FAILURE_MESSAGE,
      snackbarText: null,
    })
    expect(repository.stop).toHaveBeenCalledWith(301)
  })

  it('fails immediately with a distinct message when the stream disappears from /streams', async () => {
    vi.useFakeTimers()
    const repository = {
      start: vi.fn(async () => ({ streamId: 202 })),
      fetchStreams: vi
        .fn()
        .mockResolvedValueOnce([{ streamId: 202, isEnabled: false }])
        .mockResolvedValueOnce([]),
      keep: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
    }
    const controller = new HlsLifecycleController({
      repository,
      readinessPollMs: 1000,
      keepIntervalMs: 10000,
    })

    const startPromise = controller.start()
    await flushMicrotasks()
    await vi.advanceTimersByTimeAsync(1000)
    expect(controller.snapshot()).toMatchObject({ state: 'waiting' })

    await vi.advanceTimersByTimeAsync(1000)
    await startPromise

    expect(controller.snapshot()).toMatchObject({
      state: 'error',
      streamId: null,
      errorMessage: HLS_STREAM_LOST_MESSAGE,
      snackbarText: null,
    })
    expect(repository.stop).toHaveBeenCalledWith(202)
  })
})
