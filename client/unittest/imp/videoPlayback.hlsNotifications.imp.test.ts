import { afterEach, describe, expect, it, vi } from 'vitest'
import { HlsLifecycleController } from '@/features/video/playback/playbackLifecycle'
import type { HlsStreamStatus } from '@/features/video/playback/playbackLifecycleTypes'
import { createHlsReadinessNotifications } from '@/shared/hlsReadinessNotifications'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

function setup() {
  const notifications = createHlsReadinessNotifications()
  const unsubscribe = vi.fn()
  const subscribeReadiness = vi.fn((listener: () => void) => {
    const remove = notifications.subscribe(listener)
    return () => {
      unsubscribe()
      remove()
    }
  })
  const repository = {
    start: vi.fn(async (): Promise<{ streamId: number | null }> => ({ streamId: 1 })),
    fetchStreams: vi.fn(async (): Promise<readonly HlsStreamStatus[]> => [
      { streamId: 1, isEnabled: false },
    ]),
    keep: vi.fn(async () => undefined),
    stop: vi.fn(async (): Promise<void> => undefined),
  }
  const controller = new HlsLifecycleController({ repository, subscribeReadiness })
  return { notifications, unsubscribe, subscribeReadiness, repository, controller }
}

describe('HLS readiness notifications and single in-flight checks', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('subscribes before start, ignores early hints, and checks immediately when the ID arrives', async () => {
    vi.useFakeTimers()
    const { controller, repository, notifications, subscribeReadiness, unsubscribe } = setup()
    const response = deferred<{ streamId: number | null }>()
    repository.start.mockImplementation(() => {
      expect(subscribeReadiness).toHaveBeenCalledOnce()
      return response.promise
    })
    repository.fetchStreams.mockResolvedValue([{ streamId: 1, isEnabled: true }])

    const start = controller.start()
    notifications.notify()
    expect(repository.fetchStreams).not.toHaveBeenCalled()
    response.resolve({ streamId: 1 })
    await start

    expect(repository.fetchStreams).toHaveBeenCalledOnce()
    expect(controller.snapshot().state).toBe('ready')
    expect(unsubscribe).toHaveBeenCalledOnce()
    notifications.notify()
    expect(repository.fetchStreams).toHaveBeenCalledOnce()
    await controller.stop()
    expect(unsubscribe).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('checks on hints, verifies its own ID, and keeps the one-second fallback', async () => {
    vi.useFakeTimers()
    const { controller, repository, notifications } = setup()
    const start = controller.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(repository.fetchStreams).toHaveBeenCalledTimes(1)

    repository.fetchStreams.mockResolvedValue([
      { streamId: 1, isEnabled: false },
      { streamId: 2, isEnabled: true },
    ])
    notifications.notify()
    await vi.advanceTimersByTimeAsync(0)
    expect(repository.fetchStreams).toHaveBeenCalledTimes(2)
    expect(controller.snapshot().state).toBe('waiting')

    await vi.advanceTimersByTimeAsync(999)
    expect(repository.fetchStreams).toHaveBeenCalledTimes(2)
    repository.fetchStreams.mockResolvedValue([{ streamId: 1, isEnabled: true }])
    await vi.advanceTimersByTimeAsync(1)
    await start
    expect(repository.fetchStreams).toHaveBeenCalledTimes(3)
    expect(controller.snapshot().state).toBe('ready')
    await controller.stop()
  })

  it('coalesces concurrent timer and notification triggers into one follow-up check', async () => {
    vi.useFakeTimers()
    const { controller, repository, notifications } = setup()
    const first = deferred<readonly HlsStreamStatus[]>()
    const second = deferred<readonly HlsStreamStatus[]>()
    repository.fetchStreams
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise)
    const start = controller.start()
    await vi.advanceTimersByTimeAsync(0)

    notifications.notify()
    notifications.notify()
    await vi.advanceTimersByTimeAsync(3000)
    expect(repository.fetchStreams).toHaveBeenCalledTimes(1)
    first.resolve([{ streamId: 1, isEnabled: false }])
    await vi.advanceTimersByTimeAsync(0)
    expect(repository.fetchStreams).toHaveBeenCalledTimes(2)

    second.resolve([{ streamId: 1, isEnabled: true }])
    await start
    expect(controller.snapshot().state).toBe('ready')
    expect(repository.fetchStreams).toHaveBeenCalledTimes(2)
    await controller.stop()
  })

  it.each(['stop', 'cleanup'] as const)(
    'removes subscriptions and queued checks on %s and ignores late responses',
    async (operation) => {
      vi.useFakeTimers()
      const { controller, repository, notifications, unsubscribe } = setup()
      const response = deferred<readonly HlsStreamStatus[]>()
      repository.fetchStreams.mockImplementation(() => response.promise)
      const start = controller.start()
      await vi.advanceTimersByTimeAsync(0)
      notifications.notify()
      await controller[operation]()
      await start
      response.resolve([{ streamId: 1, isEnabled: true }])
      await vi.advanceTimersByTimeAsync(0)
      notifications.notify()
      expect(repository.fetchStreams).toHaveBeenCalledOnce()
      expect(unsubscribe).toHaveBeenCalledOnce()
      expect(controller.snapshot().state).toBe('stopped')
      expect(vi.getTimerCount()).toBe(0)
    },
  )

  it.each(['start-failure', 'missing-id', 'fetch-failure', 'missing-stream', 'timeout'])(
    'unsubscribes and settles waiting on %s',
    async (failure) => {
      vi.useFakeTimers()
      const { controller, repository, notifications, unsubscribe } = setup()
      if (failure === 'start-failure') repository.start.mockRejectedValue(new Error('start'))
      if (failure === 'missing-id') repository.start.mockResolvedValue({ streamId: null })
      if (failure === 'fetch-failure') repository.fetchStreams.mockRejectedValue(new Error('fetch'))
      if (failure === 'missing-stream') repository.fetchStreams.mockResolvedValue([])
      const start = controller.start()
      await vi.advanceTimersByTimeAsync(0)
      if (failure === 'timeout') await vi.advanceTimersByTimeAsync(1800000)
      await start

      expect(controller.snapshot().state).toBe('error')
      expect(unsubscribe).toHaveBeenCalledOnce()
      const count = repository.fetchStreams.mock.calls.length
      notifications.notify()
      await vi.advanceTimersByTimeAsync(1000)
      expect(repository.fetchStreams).toHaveBeenCalledTimes(count)
      expect(vi.getTimerCount()).toBe(0)
    },
  )

  it('aborts an in-flight readiness request at the deadline and rejects its late result', async () => {
    vi.useFakeTimers()
    const { repository, subscribeReadiness, unsubscribe } = setup()
    const response = deferred<readonly HlsStreamStatus[]>()
    let signal: AbortSignal | undefined
    const fetchStreams = vi.fn((requestSignal?: AbortSignal) => {
      signal = requestSignal
      return response.promise
    })
    const controller = new HlsLifecycleController({
      repository: { ...repository, fetchStreams },
      subscribeReadiness,
    })
    const start = controller.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(signal?.aborted).toBe(false)

    await vi.advanceTimersByTimeAsync(1800000)
    await start
    expect(signal?.aborted).toBe(true)
    expect(unsubscribe).toHaveBeenCalledOnce()
    expect(controller.snapshot().state).toBe('error')
    response.resolve([{ streamId: 1, isEnabled: true }])
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchStreams).toHaveBeenCalledOnce()
    expect(controller.snapshot().state).toBe('error')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not let an old subscription or response settle a restarted wait', async () => {
    vi.useFakeTimers()
    const { controller, repository, notifications, subscribeReadiness } = setup()
    const oldResponse = deferred<readonly HlsStreamStatus[]>()
    repository.start.mockResolvedValueOnce({ streamId: 1 }).mockResolvedValue({ streamId: 2 })
    repository.fetchStreams
      .mockImplementationOnce(() => oldResponse.promise)
      .mockResolvedValue([{ streamId: 2, isEnabled: false }])

    const oldStart = controller.start()
    await vi.advanceTimersByTimeAsync(0)
    const oldListener = subscribeReadiness.mock.calls[0][0]
    const nextStart = controller.start()
    await vi.advanceTimersByTimeAsync(0)
    oldListener()
    oldResponse.resolve([{ streamId: 1, isEnabled: true }])
    await vi.advanceTimersByTimeAsync(0)
    await oldStart
    expect(controller.snapshot()).toMatchObject({ state: 'waiting', streamId: 2 })

    repository.fetchStreams.mockResolvedValue([{ streamId: 2, isEnabled: true }])
    notifications.notify()
    await nextStart
    expect(controller.snapshot()).toMatchObject({ state: 'ready', streamId: 2 })
    await controller.stop()
  })

  it('keeps the current subscription when an older restart finishes stopping late', async () => {
    vi.useFakeTimers()
    const { controller, repository, notifications, subscribeReadiness, unsubscribe } = setup()
    const oldStop = deferred<void>()
    repository.start.mockResolvedValueOnce({ streamId: 1 }).mockResolvedValue({ streamId: 2 })
    repository.stop.mockImplementationOnce(() => oldStop.promise)
    repository.fetchStreams.mockResolvedValue([
      { streamId: 1, isEnabled: false },
      { streamId: 2, isEnabled: false },
    ])
    const firstStart = controller.start()
    await vi.advanceTimersByTimeAsync(0)
    const secondStart = controller.start()
    const thirdStart = controller.start()
    await vi.advanceTimersByTimeAsync(0)
    oldStop.resolve()
    await secondStart
    await firstStart

    expect(subscribeReadiness).toHaveBeenCalledTimes(2)
    expect(unsubscribe).toHaveBeenCalledTimes(1)
    expect(controller.snapshot()).toMatchObject({ state: 'waiting', streamId: 2 })
    repository.fetchStreams.mockResolvedValue([{ streamId: 2, isEnabled: true }])
    notifications.notify()
    await thirdStart
    expect(controller.snapshot()).toMatchObject({ state: 'ready', streamId: 2 })
    expect(unsubscribe).toHaveBeenCalledTimes(2)
    await controller.stop()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('isolates notifications between application instances', () => {
    const first = createHlsReadinessNotifications()
    const second = createHlsReadinessNotifications()
    const one = vi.fn()
    const two = vi.fn()
    const remove = first.subscribe(one)
    second.subscribe(two)
    first.notify()
    expect(one).toHaveBeenCalledOnce()
    expect(two).not.toHaveBeenCalled()
    remove()
    remove()
    first.notify()
    second.notify()
    expect(one).toHaveBeenCalledOnce()
    expect(two).toHaveBeenCalledOnce()
  })
})
