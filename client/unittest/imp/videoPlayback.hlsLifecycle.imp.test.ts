import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  HlsLifecycleController,
  buildHlsPlaylistUrl,
  createFetchHlsLifecycleRepository,
} from '@/features/video/playback/playbackLifecycle'
import { flushMicrotasks } from './support/videoPlaybackFixtures'

describe('Video playback HLS lifecycle and direct stream constraints', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('starts HLS, waits for readiness, builds the playlist URL, keeps the stream, and stops it', async () => {
    vi.useFakeTimers()
    const repository = {
      start: vi.fn(async () => ({ streamId: 81 })),
      fetchStreams: vi
        .fn()
        .mockResolvedValueOnce([{ streamId: 81, isEnabled: false }])
        .mockResolvedValueOnce([{ streamId: 81, isEnabled: true }]),
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

    expect(controller.snapshot()).toMatchObject({
      state: 'waiting',
      streamId: 81,
    })

    await vi.advanceTimersByTimeAsync(1000)
    expect(repository.fetchStreams).toHaveBeenCalledTimes(1)
    expect(controller.snapshot()).toMatchObject({ state: 'waiting' })

    await vi.advanceTimersByTimeAsync(1000)
    await startPromise

    expect(controller.snapshot()).toStrictEqual({
      state: 'ready',
      streamId: 81,
      playlistUrl: './streamfiles/stream81.m3u8',
      errorMessage: null,
      snackbarText: null,
    })
    expect(buildHlsPlaylistUrl(81)).toBe('./streamfiles/stream81.m3u8')

    await vi.advanceTimersByTimeAsync(10000)
    expect(repository.keep).toHaveBeenCalledWith(81)

    await controller.stop()
    expect(repository.stop).toHaveBeenCalledWith(81)
    expect(controller.snapshot()).toMatchObject({
      state: 'stopped',
      streamId: null,
    })
  })

  it('retries transient recorded HLS stream start failures before surfacing a playback error', async () => {
    vi.useFakeTimers()
    const repository = {
      start: vi
        .fn()
        .mockRejectedValueOnce(new Error('synthetic transient start failure'))
        .mockResolvedValueOnce({ streamId: 82 }),
      fetchStreams: vi.fn(async () => [{ streamId: 82, isEnabled: true }]),
      keep: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
    }
    const controller = new HlsLifecycleController({
      repository,
      readinessPollMs: 1000,
      readinessTimeoutMs: 5000,
      keepIntervalMs: 10000,
      retryDelayMs: 200,
      startRetryCount: 1,
    })

    const startPromise = controller.start()
    await flushMicrotasks()
    await vi.advanceTimersByTimeAsync(200)
    await vi.advanceTimersByTimeAsync(1000)
    await startPromise

    expect(repository.start).toHaveBeenCalledTimes(2)
    expect(controller.snapshot()).toStrictEqual({
      state: 'ready',
      streamId: 82,
      playlistUrl: './streamfiles/stream82.m3u8',
      errorMessage: null,
      snackbarText: null,
    })
  })

  it('parses both legacy array and object HLS stream readiness responses', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ streamId: 81 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify([{ streamId: 81, isEnable: true }]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ items: [{ streamId: 82, isEnabled: true }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ items: [{ streamId: 83, isEnable: true }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )

    const repository = createFetchHlsLifecycleRepository({
      streamStartUrl: './api/streams/live/10/hls?mode=0',
      readinessUrl: './api/streams?isHalfWidth=false',
      fetcher,
    })

    await expect(repository.start()).resolves.toStrictEqual({ streamId: 81 })
    await expect(repository.fetchStreams()).resolves.toStrictEqual([
      { streamId: 81, isEnabled: true },
    ])
    await expect(repository.fetchStreams()).resolves.toStrictEqual([
      { streamId: 82, isEnabled: true },
    ])
    await expect(repository.fetchStreams()).resolves.toStrictEqual([
      { streamId: 83, isEnabled: true },
    ])
  })
})
