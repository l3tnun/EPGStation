import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'
import {
  createGuideNavigationConfigWithEncodeModes,
  createGuideRepository,
  createShellRepository,
  waitForGuideVisible,
} from './support/guideSpecHarness'

describe('Guide route and fetch lifecycle', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.classList.remove('fix-address-bar', 'guide-shell-scroll-lock')
    window.history.replaceState(null, '', '/#/guide?time=26050509')
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-05-05T09:00:00+09:00'))
  })

  afterEach(() => {
    document.documentElement.classList.remove('fix-address-bar', 'guide-shell-scroll-lock')
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('[AC 3.15] shows the failure snackbar when the reserve information update request fails', async () => {
    const guideRepository = createGuideRepository()
    vi.mocked(guideRepository.triggerReserveUpdate).mockResolvedValue({
      ok: false,
      error: 'guide-reserve-update-failed',
      message: '予約情報の更新を開始できませんでした。',
    })

    render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        guideApiRepository={guideRepository}
        navigationConfig={createGuideNavigationConfigWithEncodeModes()}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    await waitForGuideVisible()
    fireEvent.click(screen.getByRole('button', { name: '番組表メニュー' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: '予約情報更新' }))

    expect(await screen.findByText('予約情報の更新を開始できませんでした。')).toBeInTheDocument()
    expect(guideRepository.triggerReserveUpdate).toHaveBeenCalledTimes(1)
  })
})
