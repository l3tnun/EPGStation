import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { StrictMode, useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import App from '@/App'
import { SettingsPage } from '@/features/settings/SettingsPage'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'
import {
  fullNavigationConfig,
  renderSettingsPage,
  mockWindowScrollTo,
} from './support/settingsScreenHelpers'

describe('Requirements 2.5, 3.1-3.7 Settings reset and theme preview workflow', () => {
  beforeEach(() => {
    localStorage.clear()
    window.history.replaceState(null, '', '/#/settings')
    mockWindowScrollTo()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('[AC 3.2] previews manual dark theme changes before save without persisting localStorage', () => {
    localStorage.setItem(
      'settings',
      JSON.stringify({
        ...new DefaultSettingsFactory().create(),
        shouldUseOSColorTheme: false,
        isForceDarkTheme: false,
      }),
    )

    render(<App osPrefersDark={false} viewportWidth={1440} initialDrawerState="none" />)

    expect(screen.getByTestId('app-shell')).toHaveAttribute('data-theme-mode', 'light')

    fireEvent.click(screen.getByRole('switch', { name: '全般 ダークテーマ' }))

    expect(screen.getByRole('switch', { name: '全般 ダークテーマ' })).toBeChecked()
    expect(screen.getByTestId('app-shell')).toHaveAttribute('data-theme-mode', 'dark')
    expect(JSON.parse(localStorage.getItem('settings') ?? '{}')).toMatchObject({
      shouldUseOSColorTheme: false,
      isForceDarkTheme: false,
    })
  })

  it('[AC 3.1] copies OS-derived dark state into tmp and preview theme when OS color theme is enabled', () => {
    localStorage.setItem(
      'settings',
      JSON.stringify({
        ...new DefaultSettingsFactory().create(),
        shouldUseOSColorTheme: false,
        isForceDarkTheme: false,
      }),
    )

    render(<App osPrefersDark={true} viewportWidth={1440} initialDrawerState="none" />)

    fireEvent.click(screen.getByRole('switch', { name: '全般 OSカラーテーマ' }))

    expect(screen.getByRole('switch', { name: '全般 OSカラーテーマ' })).toBeChecked()
    expect(screen.getByRole('switch', { name: '全般 ダークテーマ' })).toBeChecked()
    expect(screen.getByRole('switch', { name: '全般 ダークテーマ' })).toBeDisabled()
    expect(screen.getByTestId('app-shell')).toHaveAttribute('data-theme-mode', 'dark')
    expect(JSON.parse(localStorage.getItem('settings') ?? '{}')).toMatchObject({
      shouldUseOSColorTheme: false,
      isForceDarkTheme: false,
    })
  })

  it('[AC 3.3] [AC 3.4] [AC 3.5] resets tmp to defaults without persisting and restores visible theme from saved settings', async () => {
    localStorage.setItem(
      'settings',
      JSON.stringify({
        ...new DefaultSettingsFactory().create(),
        isEnablePWA: false,
        shouldUseOSColorTheme: false,
        isForceDarkTheme: true,
      }),
    )

    render(<App osPrefersDark={false} viewportWidth={1440} initialDrawerState="none" />)

    expect(screen.getByRole('switch', { name: '全般 PWA' })).not.toBeChecked()
    expect(screen.getByTestId('app-shell')).toHaveAttribute('data-theme-mode', 'dark')

    fireEvent.click(screen.getByRole('button', { name: 'リセット' }))

    expect(screen.getByRole('switch', { name: '全般 PWA' })).toBeChecked()
    expect(screen.getByRole('switch', { name: '全般 OSカラーテーマ' })).toBeChecked()
    expect(screen.getByTestId('app-shell')).toHaveAttribute('data-theme-mode', 'dark')
    expect(JSON.parse(localStorage.getItem('settings') ?? '{}')).toMatchObject({
      isEnablePWA: false,
      shouldUseOSColorTheme: false,
      isForceDarkTheme: true,
    })

    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => {
      expect(JSON.parse(localStorage.getItem('settings') ?? '{}')).toMatchObject({
        isEnablePWA: true,
        shouldUseOSColorTheme: true,
        isForceDarkTheme: false,
      })
      expect(screen.getByTestId('app-shell')).toHaveAttribute('data-theme-mode', 'light')
    })
  })

  it('[AC 2.4] saves only the default-based values after a reset, dropping unknown fields and mismatched stored values', async () => {
    localStorage.setItem(
      'settings',
      JSON.stringify({
        ...new DefaultSettingsFactory().create(),
        isEnablePWA: 'synthetic-not-a-boolean',
        syntheticLegacyField: { nested: [1, 2, 3] },
      }),
    )

    render(<App osPrefersDark={false} viewportWidth={1440} initialDrawerState="none" />)

    fireEvent.click(screen.getByRole('button', { name: 'リセット' }))
    expect(JSON.parse(localStorage.getItem('settings') ?? '{}').syntheticLegacyField).toStrictEqual(
      {
        nested: [1, 2, 3],
      },
    )
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => {
      expect(JSON.parse(localStorage.getItem('settings') ?? '{}')).toStrictEqual(
        new DefaultSettingsFactory().create(),
      )
    })
  })

  it('[AC 1.10] keeps unknown fields and mismatched stored values when saving without a reset', async () => {
    localStorage.setItem(
      'settings',
      JSON.stringify({
        ...new DefaultSettingsFactory().create(),
        isEnablePWA: 'synthetic-not-a-boolean',
        syntheticLegacyField: { nested: [1, 2, 3] },
      }),
    )

    render(<App osPrefersDark={false} viewportWidth={1440} initialDrawerState="none" />)

    fireEvent.click(screen.getByRole('switch', { name: '全般 ダークテーマ' }))
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => {
      expect(JSON.parse(localStorage.getItem('settings') ?? '{}')).toMatchObject({
        isForceDarkTheme: true,
        isEnablePWA: 'synthetic-not-a-boolean',
        syntheticLegacyField: { nested: [1, 2, 3] },
      })
    })
  })

  it('[AC frontend-settings-storage 1.10] overwrites a mismatched stored value once its control is changed and saved', async () => {
    localStorage.setItem(
      'settings',
      JSON.stringify({
        ...new DefaultSettingsFactory().create(),
        isEnablePWA: 'synthetic-not-a-boolean',
        syntheticLegacyField: 'kept',
      }),
    )

    render(<App osPrefersDark={false} viewportWidth={1440} initialDrawerState="none" />)

    fireEvent.click(screen.getByRole('switch', { name: '全般 PWA' }))
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => {
      expect(JSON.parse(localStorage.getItem('settings') ?? '{}')).toMatchObject({
        isEnablePWA: false,
        syntheticLegacyField: 'kept',
      })
    })
  })

  it('[AC frontend-settings-storage 1.10] [AC frontend-settings-storage 2.5] keeps stored unknown fields on the next save after a reset that was left without saving', async () => {
    localStorage.setItem(
      'settings',
      JSON.stringify({
        ...new DefaultSettingsFactory().create(),
        syntheticLegacyField: 'kept',
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

    fireEvent.click(screen.getByRole('button', { name: 'リセット' }))
    fireEvent.click(screen.getByRole('button', { name: 'ダッシュボード' }))
    await waitFor(() => {
      expect(screen.getByTestId('title-bar')).toHaveTextContent('EPGStation')
    })

    fireEvent.click(screen.getByRole('button', { name: '設定' }))
    await waitFor(() => {
      expect(screen.getByTestId('title-bar')).toHaveTextContent('設定')
    })
    fireEvent.click(screen.getByRole('switch', { name: '全般 PWA' }))
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => {
      expect(JSON.parse(localStorage.getItem('settings') ?? '{}')).toMatchObject({
        isEnablePWA: false,
        syntheticLegacyField: 'kept',
      })
    })
  })

  it('[AC 1.10] disables the guide dark-color switch while the preview theme is light and enables it once the preview is dark', () => {
    localStorage.setItem(
      'settings',
      JSON.stringify({
        ...new DefaultSettingsFactory().create(),
        shouldUseOSColorTheme: false,
        isForceDarkTheme: false,
      }),
    )

    render(<App osPrefersDark={false} viewportWidth={1440} initialDrawerState="none" />)

    const guideSwitch = screen.getByRole('switch', {
      name: '番組表 ダークテーマの配色を無効化する',
    })
    expect(screen.getByTestId('app-shell')).toHaveAttribute('data-theme-mode', 'light')
    expect(guideSwitch).toBeDisabled()

    fireEvent.click(screen.getByRole('switch', { name: '全般 ダークテーマ' }))

    expect(screen.getByTestId('app-shell')).toHaveAttribute('data-theme-mode', 'dark')
    expect(guideSwitch).toBeEnabled()
  })

  it('[AC 2.5] [AC 3.7] restores unsaved tmp and visible theme from saved settings when leaving Settings', async () => {
    localStorage.setItem(
      'settings',
      JSON.stringify({
        ...new DefaultSettingsFactory().create(),
        isEnablePWA: false,
        shouldUseOSColorTheme: false,
        isForceDarkTheme: false,
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

    fireEvent.click(screen.getByRole('switch', { name: '全般 PWA' }))
    fireEvent.click(screen.getByRole('switch', { name: '全般 ダークテーマ' }))

    expect(screen.getByRole('switch', { name: '全般 PWA' })).toBeChecked()
    expect(screen.getByTestId('app-shell')).toHaveAttribute('data-theme-mode', 'dark')

    fireEvent.click(screen.getByRole('button', { name: 'ダッシュボード' }))

    await waitFor(() => {
      expect(screen.getByTestId('title-bar')).toHaveTextContent('EPGStation')
      expect(screen.getByTestId('app-shell')).toHaveAttribute('data-theme-mode', 'light')
    })
    expect(JSON.parse(localStorage.getItem('settings') ?? '{}')).toMatchObject({
      isEnablePWA: false,
      shouldUseOSColorTheme: false,
      isForceDarkTheme: false,
    })

    fireEvent.click(screen.getByRole('button', { name: '設定' }))

    await waitFor(() => {
      expect(screen.getByTestId('title-bar')).toHaveTextContent('設定')
      expect(screen.getByRole('switch', { name: '全般 PWA' })).not.toBeChecked()
    })
  })

  it('[AC 3.7] does not restore theme preview when only callback props change', () => {
    localStorage.setItem(
      'settings',
      JSON.stringify({
        ...new DefaultSettingsFactory().create(),
        shouldUseOSColorTheme: false,
        isForceDarkTheme: false,
      }),
    )
    const restore = vi.fn()

    function RerenderingSettingsPage() {
      const [, setVersion] = useState(0)

      return (
        <>
          <button type="button" onClick={() => setVersion((current) => current + 1)}>
            rerender
          </button>
          <SettingsPage
            isNavigationOpen={false}
            onNavigationClick={vi.fn()}
            onThemePreviewRestore={(settings) => restore(settings)}
          />
        </>
      )
    }

    renderSettingsPage(<RerenderingSettingsPage />)

    fireEvent.click(screen.getByRole('button', { name: 'rerender' }))

    expect(restore).not.toHaveBeenCalled()
  })

  it('[AC 3.2] emits a single theme preview request for one committed StrictMode theme change', () => {
    localStorage.setItem(
      'settings',
      JSON.stringify({
        ...new DefaultSettingsFactory().create(),
        shouldUseOSColorTheme: false,
        isForceDarkTheme: false,
      }),
    )
    const preview = vi.fn()

    renderSettingsPage(
      <StrictMode>
        <SettingsPage
          isNavigationOpen={false}
          onNavigationClick={vi.fn()}
          onThemePreviewChange={preview}
        />
      </StrictMode>,
    )

    fireEvent.click(screen.getByRole('switch', { name: '全般 ダークテーマ' }))

    expect(preview).toHaveBeenCalledTimes(1)
    expect(preview).toHaveBeenCalledWith({
      shouldUseOSColorTheme: false,
      isForceDarkTheme: true,
    })
  })

  it('[AC 3.7] does not restore theme preview during StrictMode mount probing before a preview exists', () => {
    localStorage.setItem('settings', JSON.stringify(new DefaultSettingsFactory().create()))
    const restore = vi.fn()

    renderSettingsPage(
      <StrictMode>
        <SettingsPage
          isNavigationOpen={false}
          onNavigationClick={vi.fn()}
          onThemePreviewRestore={restore}
        />
      </StrictMode>,
    )

    expect(screen.getByTestId('settings-card')).toBeVisible()
    expect(restore).not.toHaveBeenCalled()
  })
})
