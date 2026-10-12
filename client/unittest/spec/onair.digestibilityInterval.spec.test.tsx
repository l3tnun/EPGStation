import { act, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NOW, createOnAirRepository, createSchedule, renderOnAir } from './support/onairSpecHarness'

describe('useOnAirSchedules digestibility interval', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('[AC 1.2] ticks the progress bar forward every ten seconds while a schedule is active', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(Date.parse('2026-05-05T09:00:00+09:00'))

    const repository = createOnAirRepository([
      {
        channel: { id: 10, name: 'Synthetic GR', channelType: 'GR' },
        programs: [
          {
            id: 10,
            name: 'Synthetic GR program',
            startAt: Date.now() - 1000,
            endAt: Date.now() + 9000,
          },
        ],
      },
    ])

    renderOnAir({ repository })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    const card = screen.getByTestId('onair-card-10')
    const initialProgress = within(card).getByRole('progressbar').getAttribute('aria-valuenow')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000)
    })

    const updatedProgress = within(screen.getByTestId('onair-card-10'))
      .getByRole('progressbar')
      .getAttribute('aria-valuenow')

    expect(Number(updatedProgress)).toBeGreaterThan(Number(initialProgress))
  })

  it('[AC 1.3] stops refetching the schedules after leaving the On Air screen', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    const repository = createOnAirRepository([createSchedule('GR', 10, 1)])

    const view = renderOnAir({ repository })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    const initialCalls = repository.fetchOnAir.mock.calls.length

    // While the screen is shown, the program end time triggers a refetch.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(61_000)
    })
    const callsWhileShown = repository.fetchOnAir.mock.calls.length
    expect(callsWhileShown).toBeGreaterThan(initialCalls)

    view.unmount()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300_000)
    })
    expect(repository.fetchOnAir).toHaveBeenCalledTimes(callsWhileShown)
  })

  it('[AC 3.11] stops refetching the live stream info after leaving the watch screen', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('{}'))
    const repository = createOnAirRepository([createSchedule('GR', 10, 30)], {}, [
      {
        channelId: 10,
        channelName: 'Synthetic Live Channel',
        mode: 0,
        name: 'Synthetic Live Stream',
        startAt: NOW - 30 * 60 * 1000,
        endAt: NOW + 60 * 1000,
      },
    ])

    const view = renderOnAir({
      repository,
      initialHash: '/#/onair/watch?type=hls&channel=10&mode=0',
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    const initialCalls = repository.fetchLiveStreams.mock.calls.length
    expect(initialCalls).toBeGreaterThan(0)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(61_000)
    })
    const callsWhileShown = repository.fetchLiveStreams.mock.calls.length
    expect(callsWhileShown).toBeGreaterThan(initialCalls)

    view.unmount()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300_000)
    })
    expect(repository.fetchLiveStreams).toHaveBeenCalledTimes(callsWhileShown)
  })
})
