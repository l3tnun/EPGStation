import { fireEvent, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProgramDialogProps } from '@/features/guide/ProgramDialog'
import { NOW, createSchedule, createOnAirRepository, renderOnAir } from './support/onairSpecHarness'

vi.mock('@/features/guide/ProgramDialog', async () => {
  const actual = await vi.importActual<typeof import('@/features/guide/ProgramDialog')>(
    '@/features/guide/ProgramDialog',
  )

  return {
    ...actual,
    ProgramDialog: (props: ProgramDialogProps) => (
      <div data-testid="fake-program-dialog" data-program-name={props.program.name}>
        <button type="button" onClick={() => props.onClose(props.detailSetting)}>
          fake-close
        </button>
        <button type="button" onClick={() => props.onExited()}>
          fake-exited
        </button>
      </div>
    ),
  }
})

describe('OnAirPage ProgramDialog onExited replay guard', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.spyOn(Date, 'now').mockReturnValue(NOW)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('[AC 2.10] keeps the selected program when onExited fires while the dialog is still open', async () => {
    const repository = createOnAirRepository([createSchedule('GR', 100, 30)])
    renderOnAir({ repository })

    const card = await screen.findByTestId('onair-card-100')
    fireEvent.click(within(card).getByTestId('onair-card-header'))

    const dialog = await screen.findByTestId('fake-program-dialog')
    expect(dialog).toHaveAttribute('data-program-name', 'Synthetic GR program')

    fireEvent.click(within(dialog).getByText('fake-exited'))

    expect(screen.getByTestId('fake-program-dialog')).toHaveAttribute(
      'data-program-name',
      'Synthetic GR program',
    )
  })

  it('[AC 2.10] clears the selected program only after both close and exited have fired', async () => {
    const repository = createOnAirRepository([createSchedule('GR', 100, 30)])
    renderOnAir({ repository })

    const card = await screen.findByTestId('onair-card-100')
    fireEvent.click(within(card).getByTestId('onair-card-header'))

    const dialog = await screen.findByTestId('fake-program-dialog')
    fireEvent.click(within(dialog).getByText('fake-close'))
    expect(screen.getByTestId('fake-program-dialog')).toBeInTheDocument()

    fireEvent.click(screen.getByText('fake-exited'))

    expect(screen.queryByTestId('fake-program-dialog')).not.toBeInTheDocument()
  })
})
