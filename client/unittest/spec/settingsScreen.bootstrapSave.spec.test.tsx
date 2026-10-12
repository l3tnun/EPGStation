import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import App from '@/App'
import { SettingsPage } from '@/features/settings/SettingsPage'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'
import {
  fullNavigationConfig,
  createScrollHistorySpy,
  renderSettingsPage,
  mockWindowScrollTo,
} from './support/settingsScreenHelpers'

describe('Requirement 1.1-1.5 Settings screen route bootstrap', () => {
  beforeEach(() => {
    localStorage.clear()
    window.history.replaceState(null, '', '/#/settings')
    mockWindowScrollTo()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('[AC 1.20] keeps custom switch thumb and track animated', () => {
    const css = readFileSync('src/features/settings/SettingsPage.module.css', 'utf8')

    expect(css).toContain('background-color 150ms ease')
    expect(css).toContain('transform 150ms ease')
  })

  it('[AC 4.1] keeps Settings MUI select controls themed in dark mode', () => {
    const css = readFileSync('src/features/settings/SettingsPage.module.css', 'utf8')

    expect(css).toContain(
      ":global([data-theme-mode='dark']) .selectControl :global(.MuiSelect-select)",
    )
    expect(css).toContain('color: rgb(255 255 255 / 87%);')
    expect(css).toContain('color-scheme: dark;')
    expect(css).toContain(
      ":global([data-theme-mode='dark']) .selectControl :global(.MuiSelect-icon)",
    )
    expect(css).toContain('color: rgb(255 255 255 / 70%);')
    expect(css).toContain(
      ":global([data-theme-mode='dark']) .selectControl :global(.MuiInput-underline::before)",
    )
    expect(css).toContain('border-bottom-color: rgb(255 255 255 / 50%);')
    expect(css).toContain(
      ":global([data-theme-mode='dark']) .selectControl :global(.MuiInput-underline::after)",
    )
    expect(css).toContain('border-bottom-color: #90caf9;')
  })

  it('[AC 4.3] resolves the dark checked switch thumb color through the primary token', () => {
    const css = readFileSync('src/features/settings/SettingsPage.module.css', 'utf8')

    expect(css).toContain(":global([data-theme-mode='dark']) .switchControl:checked::before")
    expect(css).toContain('background: var(--mui-palette-primary-main, #90caf9);')
  })

  it('[AC 2.10] keeps legacy settings action buttons and bottom spacer geometry', () => {
    const pageSource = readFileSync('src/features/settings/SettingsPage.tsx', 'utf8')
    const css = readFileSync('src/features/settings/SettingsPage.module.css', 'utf8')

    expect(pageSource).toContain('variant="text"')
    expect(pageSource).toContain('styles.bottomSpacer')
    expect(css).toContain('padding: 12px 0;')
    expect(css).toContain('border: 0;')
    expect(css).toContain('height: 24px;')
    expect(css).toContain('visibility: hidden;')
    expect(css).not.toContain('min-width: 94px')
  })

  it('[AC 1.1] [AC 1.3] [AC 1.4] [AC 1.5] [AC 1.2] renders /settings as a normal shell screen and signals scroll restoration readiness', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const scrollHistory = createScrollHistorySpy()

    render(
      <App
        scrollHistory={scrollHistory}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    expect(screen.getByTestId('title-bar')).toHaveTextContent('設定')
    expect(screen.queryByText('Synthetic route: /settings')).not.toBeInTheDocument()
    expect(screen.getByTestId('settings-card')).toBeVisible()

    const sections = within(screen.getByTestId('settings-card')).getAllByRole('heading', {
      level: 2,
    })

    expect(sections.map((section) => section.textContent)).toStrictEqual([
      '全般',
      '放映中',
      '番組表',
      '予約',
      '録画中',
      '録画',
      '検索',
      'ルール',
      'ページネーション',
      'ビデオプレーヤ',
    ])
    await waitFor(() => {
      expect(scrollHistory.emitDoneGetData).toHaveBeenCalledTimes(1)
    })
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('Requirements 2.1-2.4, 2.6-2.7 Settings save workflow', () => {
  beforeEach(() => {
    localStorage.clear()
    window.history.replaceState(null, '', '/#/settings')
    mockWindowScrollTo()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('[AC 2.1] [AC 2.2] [AC 2.3] [AC 2.4] persists tmp only on save, shows success snackbar, and requests navigation regeneration', async () => {
    localStorage.setItem(
      'settings',
      JSON.stringify({
        ...new DefaultSettingsFactory().create(),
        isEnableDisplayForEachBroadcastWave: false,
      }),
    )

    render(
      <App
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
        navigationConfig={fullNavigationConfig}
      />,
    )

    const navigation = screen.getByRole('navigation', { name: 'メインナビゲーション' })
    expect(within(navigation).getByText('番組表')).toBeVisible()
    expect(within(navigation).queryByText('番組表GR')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('switch', { name: '番組表 放送波種別表示' }))

    expect(JSON.parse(localStorage.getItem('settings') ?? '{}')).toMatchObject({
      isEnableDisplayForEachBroadcastWave: false,
    })
    expect(within(navigation).getByText('番組表')).toBeVisible()
    expect(within(navigation).queryByText('番組表GR')).not.toBeInTheDocument()

    // The save snackbar closes on its own timer, so observe it under a clock this test advances.
    vi.useFakeTimers()
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    for (let step = 0; step < 200 && screen.queryAllByRole('alert').length === 0; step += 1) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
    }

    {
      expect(JSON.parse(localStorage.getItem('settings') ?? '{}')).toMatchObject({
        isEnableDisplayForEachBroadcastWave: true,
      })
      expect(screen.getByRole('alert')).toHaveTextContent('保存されました')
      expect(
        screen.getByText('保存されました').closest('[data-snackbar-severity]'),
      ).toHaveAttribute('data-snackbar-severity', 'success')
      expect(within(navigation).queryByText('番組表')).not.toBeInTheDocument()
      expect(within(navigation).getByText('番組表GR')).toBeVisible()
    }
    vi.useRealTimers()
  })

  it('[AC 2.3] [AC 2.7] shows an error snackbar and requests no navigation regeneration when localStorage access fails', () => {
    const showSnackbar = vi.fn()
    const navigationRequest = vi.fn()

    renderSettingsPage(
      <SettingsPage
        isNavigationOpen={false}
        onNavigationClick={vi.fn()}
        onSnackbar={showSnackbar}
        mpegtsSupported={true}
        currentPreviewTheme="dark"
      />,
    )

    window.addEventListener('epgstation:navigation-regeneration-request', navigationRequest)
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('Blocked synthetic storage access', 'SecurityError')
    })

    expect(() => {
      fireEvent.click(screen.getByRole('button', { name: '保存' }))
    }).not.toThrow()
    expect(showSnackbar).toHaveBeenCalledTimes(1)
    expect(showSnackbar).toHaveBeenCalledWith({
      text: '設定の保存に失敗しました',
      severity: 'error',
    })
    expect(navigationRequest).not.toHaveBeenCalled()
  })

  it('[AC 2.3] [AC 2.7] announces the failure in the shell snackbar when the write is rejected', async () => {
    localStorage.setItem('settings', JSON.stringify(new DefaultSettingsFactory().create()))

    render(
      <App
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
        navigationConfig={fullNavigationConfig}
      />,
    )
    const navigationRequest = vi.fn()
    window.addEventListener('epgstation:navigation-regeneration-request', navigationRequest)
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Synthetic quota exceeded', 'QuotaExceededError')
    })

    fireEvent.click(screen.getByRole('switch', { name: '全般 PWA' }))
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('設定の保存に失敗しました')
    expect(
      screen.getByText('設定の保存に失敗しました').closest('[data-snackbar-severity]'),
    ).toHaveAttribute('data-snackbar-severity', 'error')
    expect(screen.queryByText('保存されました')).not.toBeInTheDocument()
    expect(navigationRequest).not.toHaveBeenCalled()
    window.removeEventListener('epgstation:navigation-regeneration-request', navigationRequest)
  })
})
