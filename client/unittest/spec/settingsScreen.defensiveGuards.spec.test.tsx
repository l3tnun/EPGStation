import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { StrictMode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { ScrollHistoryProvider } from '@/app/scrollHistory'
import { SettingsPage } from '@/features/settings/SettingsPage'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'
import { isVisibleControl } from '@/features/settings/lib/settingsControlSupport'
import { createSettingsControlUpdate } from '@/features/settings/settingsControlMatrix'
import {
  createScrollHistorySpy,
  renderSettingsPage,
  mockWindowScrollTo,
} from './support/settingsScreenHelpers'

vi.mock('@/features/settings/lib/settingsControlSupport', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/features/settings/lib/settingsControlSupport')>()

  return { ...actual, isVisibleControl: vi.fn(actual.isVisibleControl) }
})

vi.mock('@/features/settings/settingsControlMatrix', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/settings/settingsControlMatrix')>()

  return { ...actual, createSettingsControlUpdate: vi.fn(actual.createSettingsControlUpdate) }
})

describe('Settings screen defensive guards for already-filtered control changes', () => {
  beforeEach(() => {
    localStorage.clear()
    localStorage.setItem(
      'settings',
      JSON.stringify({ ...new DefaultSettingsFactory().create(), isEnablePWA: false }),
    )
    mockWindowScrollTo()
    vi.mocked(isVisibleControl).mockClear()
    vi.mocked(createSettingsControlUpdate).mockClear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('[AC 2.11] discards a control change that resolves as no longer visible instead of updating tmp', () => {
    renderSettingsPage(
      <SettingsPage isNavigationOpen={false} onNavigationClick={vi.fn()} mpegtsSupported={true} />,
    )

    vi.mocked(isVisibleControl).mockReturnValueOnce(false)
    fireEvent.click(screen.getByRole('switch', { name: '全般 PWA' }))
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    expect(JSON.parse(localStorage.getItem('settings') ?? '{}')).toMatchObject({
      isEnablePWA: false,
    })
  })

  it('[AC 2.11] discards a control change that produces no tmp update instead of writing an undefined value', () => {
    renderSettingsPage(
      <SettingsPage isNavigationOpen={false} onNavigationClick={vi.fn()} mpegtsSupported={true} />,
    )

    vi.mocked(createSettingsControlUpdate).mockReturnValueOnce(null)
    fireEvent.click(screen.getByRole('switch', { name: '全般 PWA' }))
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    expect(JSON.parse(localStorage.getItem('settings') ?? '{}')).toMatchObject({
      isEnablePWA: false,
    })
  })

  it('[AC 3.7] does not restore a theme preview on unmount when no preview was ever activated', () => {
    const restore = vi.fn()
    const { unmount } = render(
      <ScrollHistoryProvider scrollHistory={createScrollHistorySpy()}>
        <SettingsPage
          isNavigationOpen={false}
          onNavigationClick={vi.fn()}
          onThemePreviewRestore={restore}
        />
      </ScrollHistoryProvider>,
    )

    unmount()

    expect(restore).not.toHaveBeenCalled()
  })

  it('[AC 1.4] emits scroll-restoration done only once when StrictMode probes the mount effect twice', async () => {
    const scrollHistory = createScrollHistorySpy()

    render(
      <StrictMode>
        <ScrollHistoryProvider scrollHistory={scrollHistory}>
          <SettingsPage isNavigationOpen={false} onNavigationClick={vi.fn()} />
        </ScrollHistoryProvider>
      </StrictMode>,
    )

    await waitFor(() => {
      expect(scrollHistory.emitDoneGetData).toHaveBeenCalledTimes(1)
    })
  })
})
