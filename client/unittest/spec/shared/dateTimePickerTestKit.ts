import { fireEvent, within } from '@testing-library/react'
import { vi } from 'vitest'

// 日時 picker dialog の calendar の曜日 header（左の列から順）。
export function calendarWeekdayHeaders(dialog: HTMLElement): string[] {
  return within(dialog)
    .getAllByRole('columnheader')
    .map((header) => header.textContent ?? '')
}

// 表示中の月の「日」を選ぶ。
export function pickCalendarDay(dialog: HTMLElement, day: number): void {
  fireEvent.click(within(dialog).getByRole('gridcell', { name: String(day) }))
}

export const MONDAY_FIRST_WEEKDAYS = ['月', '火', '水', '木', '金', '土', '日']

// 値が空の picker で日を選ぶと、その日の 00:00 になる。選ぶ月を決めるため、現在日時（Date だけ）を固定する。
// 後始末は test 側の afterEach で vi.useRealTimers() を呼ぶ。
export function fixCurrentDate(iso: string): void {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(iso))
}
