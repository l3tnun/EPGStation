import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  HlsLifecycleController,
  rebuildDirectStreamUrlForSeek,
  resolveM2tsLlPlaybackReadiness,
  resolvePlaybackLifecycleMode,
} from '@/features/video/playback/playbackLifecycle'
import { detectMpegtsLivePlaybackSupport } from '@/shared/media/mpegtsSupport'
import { flushMicrotasks } from './support/videoPlaybackFixtures'

describe('Video playback HLS lifecycle and direct stream constraints', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('keeps readiness timeout terminal when an in-flight poll later resolves ready', async () => {
    vi.useFakeTimers()
    let resolveReadiness:
      ((value: readonly { streamId: number; isEnabled: boolean }[]) => void) | undefined
    let resolveStop: (() => void) | undefined
    const repository = {
      start: vi.fn(async () => ({ streamId: 141 })),
      fetchStreams: vi.fn(
        () =>
          new Promise<readonly { streamId: number; isEnabled: boolean }[]>((resolve) => {
            resolveReadiness = resolve
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
      readinessTimeoutMs: 2000,
      keepIntervalMs: 10000,
    })

    const startPromise = controller.start()
    await flushMicrotasks()
    await vi.advanceTimersToNextTimerAsync()
    await vi.advanceTimersToNextTimerAsync()
    resolveReadiness?.([{ streamId: 141, isEnabled: true }])
    await flushMicrotasks()
    resolveStop?.()
    await startPromise

    expect(controller.snapshot()).toMatchObject({
      state: 'error',
      streamId: null,
      errorMessage: 'ストリーム準備に失敗',
    })
  })

  it('resolves pending HLS readiness wait during cleanup without leaving timers active', async () => {
    vi.useFakeTimers()
    const repository = {
      start: vi.fn(async () => ({ streamId: 121 })),
      fetchStreams: vi.fn(async () => [{ streamId: 121, isEnabled: false }]),
      keep: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
    }
    const controller = new HlsLifecycleController({
      repository,
      readinessPollMs: 1000,
      readinessTimeoutMs: 5000,
      keepIntervalMs: 10000,
    })

    let isStartSettled = false
    const startPromise = controller.start().then(() => {
      isStartSettled = true
    })
    await flushMicrotasks()
    await flushMicrotasks()
    expect(controller.snapshot()).toMatchObject({ state: 'waiting' })
    controller.cleanup()
    await flushMicrotasks()
    await flushMicrotasks()

    expect(isStartSettled).toBe(true)
    expect(controller.snapshot()).toMatchObject({
      state: 'stopped',
      streamId: null,
    })
    await vi.advanceTimersByTimeAsync(10000)
    expect(repository.fetchStreams).not.toHaveBeenCalled()
    expect(repository.keep).not.toHaveBeenCalled()
    await startPromise
  })

  it('can suppress lifecycle snapshot emission during React unmount cleanup', async () => {
    vi.useFakeTimers()
    const snapshots: string[] = []
    const onStopFailure = vi.fn()
    const repository = {
      start: vi.fn(async () => ({ streamId: 125 })),
      fetchStreams: vi.fn(async () => [{ streamId: 125, isEnabled: false }]),
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
      onChange: (snapshot) => {
        snapshots.push(snapshot.state)
      },
    })

    const startPromise = controller.start()
    await flushMicrotasks()
    controller.cleanup({ emit: false, onStopFailure })
    await startPromise
    await flushMicrotasks()

    expect(snapshots).not.toContain('stopped')
    expect(repository.stop).toHaveBeenCalledWith(125)
    expect(onStopFailure).toHaveBeenCalledTimes(1)
  })

  it('keeps WebM and MP4 direct stream outside frontend start/keep/stop and rebuilds seek URLs', () => {
    expect(
      resolvePlaybackLifecycleMode({ sourceKind: 'direct-stream', streamingType: 'webm' }),
    ).toBe('direct-response')
    expect(
      resolvePlaybackLifecycleMode({ sourceKind: 'direct-stream', streamingType: 'mp4' }),
    ).toBe('direct-response')
    expect(resolvePlaybackLifecycleMode({ sourceKind: 'hls-stream', streamingType: 'hls' })).toBe(
      'hls-api',
    )
    expect(rebuildDirectStreamUrlForSeek('./api/streams/recorded/701/mp4?mode=0&ss=15', 120)).toBe(
      './api/streams/recorded/701/mp4?mode=0&ss=120',
    )
    expect(
      rebuildDirectStreamUrlForSeek(
        'https://example.invalid/sub/api/streams/recorded/701/mp4?mode=0&ss=15',
        120,
      ),
    ).toBe('https://example.invalid/sub/api/streams/recorded/701/mp4?mode=0&ss=120')
    expect(
      rebuildDirectStreamUrlForSeek('/sub/api/streams/recorded/701/mp4?mode=0&ss=15', 120),
    ).toBe('/sub/api/streams/recorded/701/mp4?mode=0&ss=120')
  })

  it('resolves M2TS-LL platform constraints with injectable capabilities', () => {
    expect(
      resolveM2tsLlPlaybackReadiness({
        capability: { isSupported: () => false },
        hasVideoElement: true,
      }),
    ).toStrictEqual({ ready: false, message: '非対応ブラウザーです。' })
    expect(
      resolveM2tsLlPlaybackReadiness({
        capability: { isSupported: () => true },
        hasVideoElement: false,
      }),
    ).toStrictEqual({ ready: false, message: 'video 要素がありません。' })
  })

  it('uses the mpegts.js MSE live playback adapter for support checks', () => {
    expect(
      detectMpegtsLivePlaybackSupport({
        isSupported: () => false,
        getFeatureList: () => ({ mseLivePlayback: true }),
      }),
    ).toBe(false)
    expect(
      detectMpegtsLivePlaybackSupport({
        isSupported: () => true,
        getFeatureList: () => ({ mseLivePlayback: false }),
      }),
    ).toBe(false)
    expect(
      detectMpegtsLivePlaybackSupport({
        isSupported: () => true,
        getFeatureList: () => ({ mseLivePlayback: true }),
      }),
    ).toBe(true)
  })
})
