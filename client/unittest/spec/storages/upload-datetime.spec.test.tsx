import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { RecordedUploadDatetimePicker } from '@/features/storages/upload/components/RecordedUploadDatetimePicker'
import {
  MONDAY_FIRST_WEEKDAYS,
  calendarWeekdayHeaders,
  pickCalendarDay,
} from '../shared/dateTimePickerTestKit'

function DatetimePickerHarness({ initial = null }: { initial?: number | null }) {
  const [value, setValue] = useState<number | null>(initial)

  return <RecordedUploadDatetimePicker generation={0} value={value} onChange={setValue} />
}

describe('RecordedUploadDatetimePicker interactions', () => {
  it('[AC 2.17] clears the value through the field clear button', () => {
    render(<DatetimePickerHarness initial={new Date('2026-05-05T12:30').getTime()} />)

    expect(screen.getByLabelText('日付※')).toHaveValue('2026-05-05T12:30')
    fireEvent.click(screen.getByRole('button', { name: '開始をクリア' }))
    expect(screen.getByLabelText('日付※')).toHaveValue('')
  })

  it('[AC 2.19] commits a value through the native input event in addition to change', () => {
    render(<DatetimePickerHarness />)

    fireEvent.input(screen.getByLabelText('日付※'), { target: { value: '2026-06-01T09:00' } })
    expect(screen.getByLabelText('日付※')).toHaveValue('2026-06-01T09:00')
  })

  it('[AC 2.14] keeps the dialog open state controlled and closes it without changing the value on escape', async () => {
    render(<DatetimePickerHarness initial={new Date('2026-05-05T12:30').getTime()} />)

    fireEvent.click(screen.getByLabelText('日付※'))
    const dialog = await screen.findByRole('dialog', { name: '日付選択' })
    fireEvent.keyDown(dialog, { key: 'Escape', code: 'Escape' })
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: '日付選択' })).not.toBeInTheDocument()
    })
    expect(screen.getByLabelText('日付※')).toHaveValue('2026-05-05T12:30')
  })

  it('[AC 2.20] commits the unchanged formatted value when the dialog is confirmed without editing an empty draft', async () => {
    render(<DatetimePickerHarness />)

    fireEvent.click(screen.getByLabelText('日付※'))
    const dialog = await screen.findByRole('dialog', { name: '日付選択' })
    expect(within(dialog).queryByRole('gridcell', { selected: true })).toBeNull()

    fireEvent.click(within(dialog).getByRole('button', { name: '設定' }))

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: '日付選択' })).not.toBeInTheDocument()
    })
    expect(screen.getByLabelText('日付※')).toHaveValue('')
  })

  it('[AC 2.14] shows the Monday-first calendar and picks a day while keeping the time', async () => {
    render(<DatetimePickerHarness initial={new Date('2026-05-05T12:30').getTime()} />)

    fireEvent.click(screen.getByLabelText('日付※'))
    const dialog = await screen.findByRole('dialog', { name: '日付選択' })
    expect(calendarWeekdayHeaders(dialog)).toEqual(MONDAY_FIRST_WEEKDAYS)
    expect(within(dialog).getByRole('gridcell', { name: '5' })).toHaveAttribute(
      'aria-selected',
      'true',
    )

    pickCalendarDay(dialog, 10)
    fireEvent.click(within(dialog).getByRole('button', { name: '設定' }))

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: '日付選択' })).not.toBeInTheDocument()
    })
    expect(screen.getByLabelText('日付※')).toHaveValue('2026-05-10T12:30')
  })

  it('[AC 2.22] picking a day in the calendar does not change the selected time', async () => {
    render(<DatetimePickerHarness initial={new Date('2026-05-05T08:15').getTime()} />)

    fireEvent.click(screen.getByLabelText('日付※'))
    const dialog = await screen.findByRole('dialog', { name: '日付選択' })
    pickCalendarDay(dialog, 20)
    fireEvent.click(within(dialog).getByRole('button', { name: '設定' }))

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: '日付選択' })).not.toBeInTheDocument()
    })
    expect(screen.getByLabelText('日付※')).toHaveValue('2026-05-20T08:15')
  })

  it('[AC 2.20] the dialog level clear button resets the value and closes without committing a draft', async () => {
    render(<DatetimePickerHarness initial={new Date('2026-05-05T12:30').getTime()} />)

    fireEvent.click(screen.getByLabelText('日付※'))
    const dialog = await screen.findByRole('dialog', { name: '日付選択' })
    pickCalendarDay(dialog, 10)

    fireEvent.click(within(dialog).getByRole('button', { name: 'クリア' }))

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: '日付選択' })).not.toBeInTheDocument()
    })
    expect(screen.getByLabelText('日付※')).toHaveValue('')
  })
})
