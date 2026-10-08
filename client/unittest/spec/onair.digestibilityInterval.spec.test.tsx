import { act, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createOnAirRepository, renderOnAir } from './support/onairSpecHarness'

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
})
