import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { expect, vi } from 'vitest'
import { ScrollHistoryProvider } from '@/app/scrollHistory'
import type { NavigationConfigState } from '@/app/navigation'

export const fullNavigationConfig: NavigationConfigState = {
  status: 'loaded',
  liveStreamEnabled: true,
  enabledBroadcastWaves: ['GR', 'BS', 'CS', 'SKY'],
}

export function createScrollHistorySpy() {
  return {
    isNeedRestoreHistory: vi.fn(() => false),
    saveScrollData: vi.fn(),
    getScrollData: vi.fn(() => null),
    getHistoryPosition: vi.fn(() => null),
    updateHistoryPosition: vi.fn(),
    emitDoneGetData: vi.fn(),
    onDoneGetData: vi.fn(async () => undefined),
    clearRestoreHistory: vi.fn(),
  }
}

export function renderSettingsPage(children?: ReactNode) {
  const scrollHistory = createScrollHistorySpy()

  render(<ScrollHistoryProvider scrollHistory={scrollHistory}>{children}</ScrollHistoryProvider>)

  return scrollHistory
}

export function mockWindowScrollTo() {
  Object.defineProperty(window, 'scrollTo', {
    configurable: true,
    value: vi.fn(),
    writable: true,
  })
}

export function changeSettingsSelect(name: string, optionName: string) {
  fireEvent.mouseDown(screen.getByRole('combobox', { name }))
  fireEvent.click(screen.getByRole('option', { name: optionName }))
}

export function expectSettingsSelectVisibleText(name: string, value: string) {
  expect(screen.getByRole('combobox', { name }).textContent?.replace(/\u200b/g, '')).toBe(value)
}
