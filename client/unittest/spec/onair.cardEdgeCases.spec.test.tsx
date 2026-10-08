import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { OnAirCard, OnAirList } from '@/features/onair/components/OnAirCard'
import { OnAirTabs } from '@/features/onair/components/OnAirTabs'
import type { OnAirSchedule } from '@/features/onair/onairApi'

const NOW = Date.parse('2026-05-05T09:00:00+09:00')

describe('OnAirCard edge cases without a program or channel id', () => {
  it('[AC 2.1] renders a blank time/title/description and an untagged testid when the schedule has no program', () => {
    const schedule: OnAirSchedule = { channel: { id: 5, name: 'Channel Only' } }
    const onProgramDialogOpen = vi.fn()
    const onStreamDialogOpen = vi.fn()

    const { container } = render(
      <OnAirCard
        schedule={schedule}
        now={NOW}
        onProgramDialogOpen={onProgramDialogOpen}
        onStreamDialogOpen={onStreamDialogOpen}
      />,
    )

    const card = container.querySelector('article')
    expect(card).not.toHaveAttribute('data-testid')
    within(card as HTMLElement).getByTestId('onair-card-header')
    expect(card?.querySelector('div[data-testid]')).toBeNull()
    expect(card).toHaveTextContent('Channel Only')
  })

  it('[AC 2.5] does not open the ProgramDialog when the header is clicked without a resolvable program', () => {
    const schedule: OnAirSchedule = { channel: { id: 5, name: 'Channel Only' } }
    const onProgramDialogOpen = vi.fn()
    const onStreamDialogOpen = vi.fn()

    render(
      <OnAirCard
        schedule={schedule}
        now={NOW}
        onProgramDialogOpen={onProgramDialogOpen}
        onStreamDialogOpen={onStreamDialogOpen}
      />,
    )

    fireEvent.click(screen.getByTestId('onair-card-header'))

    expect(onProgramDialogOpen).not.toHaveBeenCalled()
  })

  it('[AC 2.6] does not open the stream dialog when the schedule has no channel id', () => {
    const schedule: OnAirSchedule = {
      programs: [{ id: 42, name: 'No Channel Program' }],
    }
    const onProgramDialogOpen = vi.fn()
    const onStreamDialogOpen = vi.fn()

    render(
      <OnAirCard
        schedule={schedule}
        now={NOW}
        onProgramDialogOpen={onProgramDialogOpen}
        onStreamDialogOpen={onStreamDialogOpen}
      />,
    )

    fireEvent.click(screen.getByTestId('onair-card-body-42'))

    expect(onStreamDialogOpen).not.toHaveBeenCalled()
  })

  it('[AC 2.1] falls back to an empty program title/description when the program has neither', () => {
    const schedule: OnAirSchedule = {
      channel: { id: 6, name: 'Channel' },
      programs: [{ id: 60 }],
    }

    render(
      <OnAirCard
        schedule={schedule}
        now={NOW}
        onProgramDialogOpen={vi.fn()}
        onStreamDialogOpen={vi.fn()}
      />,
    )

    const body = screen.getByTestId('onair-card-body-60')
    expect(body.querySelector('[class*="programTitle"]')).toHaveTextContent('')
    expect(body.querySelector('[class*="description"]')).toHaveTextContent('')
  })

  it('[AC 2.4] shows an empty channel row when a logo channel has no name', () => {
    const schedule: OnAirSchedule = {
      channel: { id: 7, hasLogoData: true },
      programs: [{ id: 70 }],
    }

    render(
      <OnAirCard
        schedule={schedule}
        now={NOW}
        onProgramDialogOpen={vi.fn()}
        onStreamDialogOpen={vi.fn()}
      />,
    )

    expect(screen.getByAltText('')).toHaveAttribute('src', './api/channels/7/logo')
  })

  it('[AC 2.4] shows an empty channel row fallback when a channel without a logo has no name', () => {
    const schedule: OnAirSchedule = {
      channel: { id: 8, hasLogoData: false },
      programs: [{ id: 80 }],
    }

    render(
      <OnAirCard
        schedule={schedule}
        now={NOW}
        onProgramDialogOpen={vi.fn()}
        onStreamDialogOpen={vi.fn()}
      />,
    )

    expect(screen.getByTestId('onair-card-header')).toHaveTextContent('')
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('[AC 2.6] opens the stream dialog with an undefined name fallback when the channel has no name', () => {
    const schedule: OnAirSchedule = {
      channel: { id: 9 },
      programs: [{ id: 90 }],
    }
    const onStreamDialogOpen = vi.fn()

    render(
      <OnAirCard
        schedule={schedule}
        now={NOW}
        onProgramDialogOpen={vi.fn()}
        onStreamDialogOpen={onStreamDialogOpen}
      />,
    )

    fireEvent.click(screen.getByTestId('onair-card-body-90'))

    expect(onStreamDialogOpen).toHaveBeenCalledWith({ id: 9, name: undefined })
  })
})

describe('OnAirList card key fallback', () => {
  it('[AC 1.15] keys a schedule without a program id by its channel id, and by array index when both are missing', () => {
    const schedules: OnAirSchedule[] = [{ channel: { id: 501, name: 'Channel Keyed' } }, {}]

    const { container } = render(
      <OnAirList
        schedules={schedules}
        now={NOW}
        layout="list"
        onProgramDialogOpen={vi.fn()}
        onStreamDialogOpen={vi.fn()}
      />,
    )

    const cards = container.querySelectorAll('article')
    expect(cards).toHaveLength(2)
    expect(cards[0]).toHaveTextContent('Channel Keyed')
  })
})

describe('OnAirTabs scroll guard without a mocked window.scroll', () => {
  it('[AC 1.8] selects a tab without throwing when window.scroll has not been mocked', () => {
    const onSelect = vi.fn()

    render(<OnAirTabs tabs={['GR', 'BS']} selectedTab="GR" onSelect={onSelect} />)

    fireEvent.click(screen.getByRole('tab', { name: 'BS' }))

    expect(onSelect).toHaveBeenCalledWith('BS')
  })
})
