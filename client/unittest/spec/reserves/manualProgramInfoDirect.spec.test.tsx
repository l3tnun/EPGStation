import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ManualProgramInfo } from '@/features/reserves/components/ManualProgramInfo'

describe('ManualProgramInfo optional field rendering edges', () => {
  it('[AC 4.3] renders genres, extended text, component details, and a free-broadcast label', () => {
    render(
      <ManualProgramInfo
        program={{
          id: 1,
          name: 'Full program',
          channelId: 1,
          startAt: Date.parse('2026-05-05T10:15:00+09:00'),
          endAt: Date.parse('2026-05-05T10:45:00+09:00'),
          description: 'Program description',
          extended: 'Program extended text',
          genres: ['Synthetic genre'],
          isFree: true,
          videoComponentType: 1,
          audioComponentType: 2,
          audioSamplingRate: 3,
        }}
      />,
    )

    expect(screen.getByText('Synthetic genre')).toBeVisible()
    expect(screen.getByText('Program extended text')).toBeVisible()
    expect(screen.getByText('無料放送')).toBeVisible()
  })

  it('[AC 4.3] renders a pay-broadcast label when the program is not free', () => {
    render(
      <ManualProgramInfo
        program={{
          id: 2,
          name: 'Paid program',
          channelId: 1,
          startAt: Date.parse('2026-05-05T10:15:00+09:00'),
          endAt: Date.parse('2026-05-05T10:45:00+09:00'),
          isFree: false,
        }}
      />,
    )

    expect(screen.getByText('有料放送')).toBeVisible()
  })
})
