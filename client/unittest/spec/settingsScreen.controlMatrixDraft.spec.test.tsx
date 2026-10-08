import { fireEvent, screen } from '@testing-library/react'
import { StrictMode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { SettingsPage } from '@/features/settings/SettingsPage'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'
import {
  renderSettingsPage,
  mockWindowScrollTo,
  changeSettingsSelect,
  expectSettingsSelectVisibleText,
} from './support/settingsScreenHelpers'

describe('Requirements 1.6-1.14 Settings control matrix UI', () => {
  beforeEach(() => {
    localStorage.clear()
    localStorage.setItem('settings', JSON.stringify(new DefaultSettingsFactory().create()))
    mockWindowScrollTo()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('[AC 2.1] updates tmp only when a visible control changes and leaves localStorage untouched', () => {
    const savedSettings = {
      ...new DefaultSettingsFactory().create(),
      isEnablePWA: true,
      guideMode: 'sequential',
      onAirM2TSViewURLScheme: null,
    }
    localStorage.setItem('settings', JSON.stringify(savedSettings))
    const setItem = vi.spyOn(Storage.prototype, 'setItem')

    renderSettingsPage(
      <SettingsPage
        isNavigationOpen={false}
        onNavigationClick={vi.fn()}
        mpegtsSupported={true}
        currentPreviewTheme="dark"
      />,
    )

    fireEvent.click(screen.getByRole('switch', { name: '全般 PWA' }))
    changeSettingsSelect('番組表 描画設定', '最小')
    fireEvent.change(screen.getByRole('textbox', { name: '放映中 視聴 URL Scheme' }), {
      target: { value: 'synthetic-player://{content-id}' },
    })

    expect(screen.getByRole('switch', { name: '全般 PWA' })).not.toBeChecked()
    expectSettingsSelectVisibleText('番組表 描画設定', '最小')
    expect(screen.getByRole('textbox', { name: '放映中 視聴 URL Scheme' })).toHaveValue(
      'synthetic-player://{content-id}',
    )
    expect(JSON.parse(localStorage.getItem('settings') ?? '{}')).toMatchObject(savedSettings)
    expect(setItem).not.toHaveBeenCalled()
  })

  it('[AC frontend-settings-storage 1.5] repairs missing settings storage while rendering in StrictMode', () => {
    localStorage.clear()
    const setItem = vi.spyOn(Storage.prototype, 'setItem')

    renderSettingsPage(
      <StrictMode>
        <SettingsPage
          isNavigationOpen={false}
          onNavigationClick={vi.fn()}
          mpegtsSupported={true}
          currentPreviewTheme="dark"
        />
      </StrictMode>,
    )

    expect(screen.getByTestId('settings-card')).toBeVisible()
    expect(setItem).toHaveBeenCalledWith('settings', expect.any(String))
    expect(JSON.parse(localStorage.getItem('settings') ?? '{}')).toMatchObject({
      isEnablePWA: true,
      guideMode: 'sequential',
      searchLength: 300,
    })
  })

  it('[AC 1.14] does not repair existing out-of-range select values during render', () => {
    const savedSettings = {
      ...new DefaultSettingsFactory().create(),
      guideLength: 99,
    }
    localStorage.setItem('settings', JSON.stringify(savedSettings))
    const setItem = vi.spyOn(Storage.prototype, 'setItem')

    renderSettingsPage(
      <SettingsPage
        isNavigationOpen={false}
        onNavigationClick={vi.fn()}
        mpegtsSupported={true}
        currentPreviewTheme="dark"
      />,
    )

    expectSettingsSelectVisibleText('番組表 表示時間', '')
    expect(JSON.parse(localStorage.getItem('settings') ?? '{}')).toMatchObject({ guideLength: 99 })
    expect(setItem).not.toHaveBeenCalled()
  })

  it('[AC 1.14] shows existing invalid guideMode as unselected without repairing storage', () => {
    const savedSettings = {
      ...new DefaultSettingsFactory().create(),
      guideMode: '<invalid-guide-mode>',
    }
    localStorage.setItem('settings', JSON.stringify(savedSettings))
    const setItem = vi.spyOn(Storage.prototype, 'setItem')

    renderSettingsPage(
      <SettingsPage
        isNavigationOpen={false}
        onNavigationClick={vi.fn()}
        mpegtsSupported={true}
        currentPreviewTheme="dark"
      />,
    )

    expectSettingsSelectVisibleText('番組表 描画設定', '')
    expect(JSON.parse(localStorage.getItem('settings') ?? '{}')).toMatchObject({
      guideMode: '<invalid-guide-mode>',
    })
    expect(setItem).not.toHaveBeenCalled()
  })
})
