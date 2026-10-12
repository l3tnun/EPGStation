import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DateTimePickerDialog } from '@/shared/DateTimePickerDialog'
import {
  MONDAY_FIRST_WEEKDAYS,
  calendarWeekdayHeaders,
  pickCalendarDay,
} from './dateTimePickerTestKit'

function renderDialog(value: number | null, open = true) {
  const onSet = vi.fn()
  const onClear = vi.fn()
  const onClose = vi.fn()
  const element = (isOpen: boolean, current: number | null) => (
    <DateTimePickerDialog
      open={isOpen}
      title="日付選択"
      titleId="shared-picker-title"
      value={current}
      onSet={onSet}
      onClear={onClear}
      onClose={onClose}
    />
  )
  const view = render(element(open, value))

  return { ...view, element, onSet, onClear, onClose }
}

const MAY_5_1230 = Date.parse('2026-05-05T12:30:00+09:00')

describe('DateTimePickerDialog', () => {
  it('[AC frontend-storages-upload 2.14] shows a Japanese calendar whose first column is Monday', async () => {
    renderDialog(MAY_5_1230)

    const dialog = await screen.findByRole('dialog', { name: '日付選択' })
    expect(calendarWeekdayHeaders(dialog)).toEqual(MONDAY_FIRST_WEEKDAYS)
    expect(within(dialog).getByText('2026年5月')).toBeVisible()
    // 2026-05-01 is a Friday, so the first row starts with four empty cells (Mon-Thu).
    const firstDay = within(dialog).getByRole('gridcell', { name: '1' })
    expect(firstDay).toHaveAttribute('aria-colindex', '5')
    expect(within(dialog).getByRole('button', { name: 'クリア' })).toBeVisible()
    expect(within(dialog).getByRole('button', { name: '設定' })).toBeVisible()
  })

  it('[AC frontend-storages-upload 2.14] [AC frontend-storages-upload 2.22] picks a day, keeps the time and commits the combined value on set', async () => {
    const { onSet } = renderDialog(MAY_5_1230)

    const dialog = await screen.findByRole('dialog', { name: '日付選択' })
    pickCalendarDay(dialog, 20)
    fireEvent.click(within(dialog).getByRole('button', { name: '設定' }))

    expect(onSet).toHaveBeenCalledTimes(1)
    expect(onSet).toHaveBeenCalledWith(Date.parse('2026-05-20T12:30:00+09:00'))
  })

  it('[AC frontend-storages-upload 2.20] commits null when set is pressed without any selection', async () => {
    const { onSet } = renderDialog(null)

    const dialog = await screen.findByRole('dialog', { name: '日付選択' })
    fireEvent.click(within(dialog).getByRole('button', { name: '設定' }))

    expect(onSet).toHaveBeenCalledWith(null)
  })

  it('[AC frontend-storages-upload 2.20] calls clear from the クリア button without committing the draft', async () => {
    const { onSet, onClear } = renderDialog(MAY_5_1230)

    const dialog = await screen.findByRole('dialog', { name: '日付選択' })
    pickCalendarDay(dialog, 20)
    fireEvent.click(within(dialog).getByRole('button', { name: 'クリア' }))

    expect(onClear).toHaveBeenCalledTimes(1)
    expect(onSet).not.toHaveBeenCalled()
  })

  it('[AC frontend-storages-upload 2.20] re-initialises the draft from the current value each time it opens', async () => {
    const { rerender, element, onSet } = renderDialog(MAY_5_1230)

    let dialog = await screen.findByRole('dialog', { name: '日付選択' })
    pickCalendarDay(dialog, 20)
    rerender(element(false, MAY_5_1230))
    rerender(element(true, MAY_5_1230))
    dialog = await screen.findByRole('dialog', { name: '日付選択' })
    fireEvent.click(within(dialog).getByRole('button', { name: '設定' }))

    expect(onSet).toHaveBeenLastCalledWith(MAY_5_1230)
  })

  it('[AC frontend-storages-upload 2.14] closes through the dialog close request', async () => {
    const { onClose } = renderDialog(MAY_5_1230)

    const dialog = await screen.findByRole('dialog', { name: '日付選択' })
    fireEvent.keyDown(dialog, { key: 'Escape', code: 'Escape' })

    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('DateTimePickerDialog timezone', () => {
  it('[AC frontend-reserves 4.23] shows and commits the wall clock of the given timezone instead of the browser timezone', async () => {
    const onSet = vi.fn()
    // 2026-05-05 22:00 JST は Auckland (UTC+12) では 2026-05-06 01:00。
    render(
      <DateTimePickerDialog
        open
        title="時刻 開始"
        titleId="tz-picker-title"
        timezone="Pacific/Auckland"
        value={Date.parse('2026-05-05T22:00:00+09:00')}
        onSet={onSet}
        onClear={vi.fn()}
        onClose={vi.fn()}
      />,
    )

    const dialog = await screen.findByRole('dialog', { name: '時刻 開始' })
    expect(within(dialog).getByRole('gridcell', { name: '6' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    pickCalendarDay(dialog, 20)
    fireEvent.click(within(dialog).getByRole('button', { name: '設定' }))

    expect(onSet).toHaveBeenCalledWith(Date.parse('2026-05-20T01:00:00+12:00'))
  })
})

describe('DateTimePickerDialog follows the visible area', () => {
  const originalWidth = window.innerWidth
  const originalHeight = window.innerHeight

  afterEach(() => {
    window.innerWidth = originalWidth
    window.innerHeight = originalHeight
    Reflect.deleteProperty(window, 'visualViewport')
  })

  function resizeWindow(width: number, height: number) {
    act(() => {
      window.innerWidth = width
      window.innerHeight = height
      window.dispatchEvent(new Event('resize'))
    })
  }

  it('[AC frontend-storages-upload 2.14] stacks the toolbar above the calendar when the area is tall and moves it to the left when it is short and wide', async () => {
    window.innerWidth = 375
    window.innerHeight = 627
    renderDialog(MAY_5_1230)
    const dialog = await screen.findByRole('dialog', { name: '日付選択' })
    expect(dialog.querySelector('.MuiPickersLayout-landscape')).toBeNull()

    resizeWindow(375, 627)
    expect(dialog.querySelector('.MuiPickersLayout-landscape')).toBeNull()

    resizeWindow(667, 320)
    expect(dialog.querySelector('.MuiPickersLayout-landscape')).not.toBeNull()
    expect(within(dialog).getByRole('button', { name: '設定' })).toBeVisible()

    resizeWindow(375, 548)
    expect(dialog.querySelector('.MuiPickersLayout-landscape')).toBeNull()
  })

  it('[AC frontend-storages-upload 2.14] reads the visual viewport when the browser has one and stops listening on unmount', async () => {
    const viewport = Object.assign(new EventTarget(), { width: 667, height: 320 })
    Object.defineProperty(window, 'visualViewport', { value: viewport, configurable: true })
    const removeListener = vi.spyOn(viewport, 'removeEventListener')
    const { unmount } = renderDialog(MAY_5_1230)
    const dialog = await screen.findByRole('dialog', { name: '日付選択' })
    expect(dialog.querySelector('.MuiPickersLayout-landscape')).not.toBeNull()

    act(() => {
      viewport.height = 627
      viewport.width = 375
      viewport.dispatchEvent(new Event('resize'))
    })
    expect(dialog.querySelector('.MuiPickersLayout-landscape')).toBeNull()

    unmount()
    expect(removeListener).toHaveBeenCalledWith('resize', expect.any(Function))
  })
})
