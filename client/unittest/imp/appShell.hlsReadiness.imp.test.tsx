import { act, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RealtimeEventName } from '@/app/realtime'
import {
  createShellRepository,
  mockHlsFetch,
  renderPlayback,
} from '../spec/support/videoPlaybackSpecSupport'

describe('App Shell to HLS readiness notification wiring', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('forwards updateStatus to the waiting player and preserves version refresh', async () => {
    vi.useFakeTimers()
    const listeners = new Map<RealtimeEventName, () => void>()
    const connection = {
      on: vi.fn((event: RealtimeEventName, listener: () => void) => listeners.set(event, listener)),
      off: vi.fn((event: RealtimeEventName) => listeners.delete(event)),
      disconnect: vi.fn(),
    }
    const factory = vi.fn(() => connection)
    const apiRepository = createShellRepository()
    const { calls, setEnabled } = mockHlsFetch({ streamId: 82, enabled: false })
    const view = renderPlayback({
      hash: '/#/recorded/streaming/701?streamingType=hls&mode=0&fileType=ts',
      apiRepository,
      realtimeConnectionFactory: factory,
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    const player = screen.getByTestId('video-player-container')
    expect(player).toHaveAttribute('data-playback-lifecycle-state', 'waiting')
    const count = calls.filter((url) => url.includes('/streams?')).length
    const versions = apiRepository.fetchVersion.mock.calls.length
    expect(count).toBe(1)

    setEnabled(true)
    await act(async () => {
      listeners.get('updateStatus')?.()
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(player).toHaveAttribute('data-playback-lifecycle-state', 'ready')
    expect(calls.filter((url) => url.includes('/streams?'))).toHaveLength(count + 1)
    expect(apiRepository.fetchVersion.mock.calls.length).toBeGreaterThan(versions)
    expect(factory).toHaveBeenCalledOnce()

    await act(async () => {
      listeners.get('updateStatus')?.()
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(calls.filter((url) => url.includes('/streams?'))).toHaveLength(count + 1)
    view.unmount()
    expect(connection.off).toHaveBeenCalledWith('updateStatus', expect.any(Function))
    expect(connection.disconnect).toHaveBeenCalledOnce()
  })

  it('does not request HLS readiness on a direct-video route', async () => {
    vi.useFakeTimers()
    const listeners = new Map<RealtimeEventName, () => void>()
    const connection = {
      on: (event: RealtimeEventName, listener: () => void) => listeners.set(event, listener),
      off: (event: RealtimeEventName) => listeners.delete(event),
    }
    const { calls } = mockHlsFetch()
    const view = renderPlayback({
      hash: '/#/recorded/watch?videoId=701&recordedId=301',
      realtimeConnectionFactory: () => connection,
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
      listeners.get('updateStatus')?.()
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(calls.filter((url) => url.includes('/streams?'))).toHaveLength(0)
    view.unmount()
  })
})
