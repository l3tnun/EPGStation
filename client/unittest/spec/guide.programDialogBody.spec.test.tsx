import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ProgramDialogBody } from '@/features/guide/components/ProgramDialogBody'

describe('ProgramDialogBody optional sections', () => {
  it('[AC 4.17] omits the channel and time sub-text lines when they are unavailable', () => {
    render(
      <ProgramDialogBody
        program={{ id: 1, name: 'No channel or time' }}
        title="No channel or time"
      />,
    )

    expect(screen.queryByText('Synthetic Channel')).not.toBeInTheDocument()
    expect(screen.getByText('有料放送')).toBeInTheDocument()
  })

  it('[AC 4.17] renders legacy video/audio component details and marks a free broadcast', () => {
    render(
      <ProgramDialogBody
        program={{
          id: 2,
          name: 'Free broadcast with component details',
          channelName: 'Synthetic Channel',
          startAt: 0,
          endAt: 60_000,
          videoComponentType: 0x01,
          audioComponentType: 0b00011,
          audioSamplingRate: 44100,
          isFree: true,
        }}
        title="Free broadcast with component details"
      />,
    )

    expect(screen.getByText('Synthetic Channel')).toBeInTheDocument()
    expect(screen.getByText('480i(525i), アスペクト比4:3')).toBeInTheDocument()
    expect(screen.getByText('2/0モード(ステレオ)')).toBeInTheDocument()
    expect(screen.getByText('44.1kHz')).toBeInTheDocument()
    expect(screen.getByText('無料放送')).toBeInTheDocument()
  })
})
