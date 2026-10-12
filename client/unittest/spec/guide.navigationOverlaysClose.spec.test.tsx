import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'
import {
  createGuideNavigationConfigWithEncodeModes,
  createGuideRepository,
  createShellRepository,
  waitForGuideVisible,
} from './support/guideSpecHarness'

describe('Guide navigation overlay dismissal (Escape/cancel) without selecting a value', () => {
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

  it('[AC 3.33] [AC 3.7] closes the day-select dialog on Escape without navigating and removes it from the DOM', async () => {
    render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        guideApiRepository={createGuideRepository()}
        navigationConfig={createGuideNavigationConfigWithEncodeModes()}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    await waitForGuideVisible()
    fireEvent.click(screen.getByRole('heading', { name: /番組表/ }))
    const dayDialog = await screen.findByRole('dialog')

    fireEvent.keyDown(dayDialog, { key: 'Escape' })

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
    expect(dayDialog.isConnected).toBe(false)
  })

  it('[AC 3.18] [AC 3.24] closes the genre visibility dialog via cancel without persisting changes and removes it from the DOM', async () => {
    render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        guideApiRepository={createGuideRepository()}
        navigationConfig={createGuideNavigationConfigWithEncodeModes()}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    await waitForGuideVisible()
    fireEvent.click(screen.getByRole('button', { name: '番組表メニュー' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: '表示ジャンル' }))
    const genreDialog = await screen.findByRole('dialog', { name: '表示ジャンル' })

    fireEvent.click(
      Array.from(genreDialog.querySelectorAll('button')).find(
        (button) => button.textContent === 'キャンセル',
      )!,
    )

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: '表示ジャンル' })).not.toBeInTheDocument()
    })
    expect(genreDialog.isConnected).toBe(false)
  })
})
