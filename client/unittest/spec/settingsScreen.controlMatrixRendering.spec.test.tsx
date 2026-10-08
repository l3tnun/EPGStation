import { fireEvent, render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { SettingsPage } from '@/features/settings/SettingsPage'
import { ClearableTextField } from '@/shared/ClearableTextField'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'
import { renderSettingsPage, mockWindowScrollTo } from './support/settingsScreenHelpers'

describe('Requirements 1.6-1.14 Settings control matrix UI', () => {
  beforeEach(() => {
    localStorage.clear()
    localStorage.setItem('settings', JSON.stringify(new DefaultSettingsFactory().create()))
    mockWindowScrollTo()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('[AC 1.8] [AC 1.9] [AC 1.12] renders accessible controls from the full matrix, gating the live web playback switch on mpegts support', () => {
    renderSettingsPage(
      <SettingsPage
        isNavigationOpen={false}
        onNavigationClick={vi.fn()}
        mpegtsSupported={false}
        currentPreviewTheme="dark"
      />,
    )

    expect(screen.getByRole('switch', { name: '全般 PWA' })).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: '全般 OSカラーテーマ' })).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: '全般 ダークテーマ' })).toBeDisabled()
    expect(screen.getByRole('combobox', { name: '番組表 描画設定' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: '検索 最大表示件数' })).toBeInTheDocument()
    expect(
      screen.queryByRole('switch', { name: '放映中 web での再生を優先する' }),
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('switch', { name: 'ビデオプレーヤ 字幕の縁取りを強制する' }),
    ).toBeInTheDocument()
    // The first render above passes `mpegtsSupported={false}`, which is why the 放映中 switch is
    // absent there; the second render below turns it on and the switch has to appear.
    expect(screen.getByText('PWAを有効化する(※再読込後有効になります)')).toBeVisible()
    expect(screen.getByText('OSのカラーテーマに連動させる')).toBeVisible()

    renderSettingsPage(
      <SettingsPage
        isNavigationOpen={false}
        onNavigationClick={vi.fn()}
        mpegtsSupported={true}
        currentPreviewTheme="dark"
      />,
    )

    expect(
      screen.getByRole('switch', { name: '放映中 web での再生を優先する' }),
    ).toBeInTheDocument()
  })

  it('[AC 1.12] [AC 2.8] renders Vue-compatible URL scheme controls without duplicate scheme labels', () => {
    renderSettingsPage(
      <SettingsPage
        isNavigationOpen={false}
        onNavigationClick={vi.fn()}
        mpegtsSupported={true}
        currentPreviewTheme="dark"
      />,
    )

    expect(screen.getAllByText('視聴 URL Scheme')).toHaveLength(2)
    expect(screen.getAllByText('ダウンロード URL Scheme')).toHaveLength(1)
    expect(screen.getByRole('switch', { name: '録画 視聴 URL Scheme' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: '録画 視聴 URL Scheme' })).toHaveAttribute(
      'placeholder',
      'URL',
    )
    expect(screen.getByRole('textbox', { name: '録画 ダウンロード URL Scheme' })).toHaveAttribute(
      'placeholder',
      'URL',
    )
  })

  it('[AC 2.9] aligns every URL scheme clear button with the text input underline', () => {
    const css = readFileSync('src/features/settings/SettingsPage.module.css', 'utf8')

    expect(css).toMatch(/\.textControlInputWrap\s*\{[^}]*display:\s*grid;/s)
    expect(css).toMatch(/\.textControlInputWrap\s*\{[^}]*padding-top:\s*12px;/s)
    expect(css).toMatch(/\.textControl\s*\{[^}]*grid-area:\s*1 \/ 1;/s)
    expect(css).toMatch(/\.textControlClearButton\s*\{[^}]*grid-area:\s*1 \/ 1;/s)
    expect(css).toMatch(/\.textControlClearButton\s*\{[^}]*justify-self:\s*end;/s)
    expect(css).not.toMatch(/\.textControlClearButton\s*\{[^}]*top:\s*\d+px;/s)
    expect(css).not.toMatch(/\.textControlClearButton\s*\{[^}]*top:\s*50%;/s)
    expect(css).toMatch(/\.textControlClearButton\s*\{[^}]*bottom:\s*auto;/s)
    expect(css).not.toMatch(/\.textControlRow > \.textControlClearButton\s*\{/)
    expect(css).not.toMatch(/\.schemeControlRow > \.textControlClearButton\s*\{/)
  })

  it('[AC 2.9] renders URL scheme and shared clear buttons through the centered clear affordance owners', () => {
    const clearableSource = readFileSync('src/shared/ClearableTextField.tsx', 'utf8')
    renderSettingsPage(
      <SettingsPage
        isNavigationOpen={false}
        onNavigationClick={vi.fn()}
        mpegtsSupported={true}
        currentPreviewTheme="dark"
      />,
    )

    const schemeInput = screen.getByRole('textbox', { name: '録画 視聴 URL Scheme' })
    fireEvent.change(schemeInput, { target: { value: 'synthetic-player://{content-id}' } })
    const schemeClearButton = screen.getByRole('button', {
      name: '録画 視聴 URL Schemeをクリア',
    })
    expect(schemeClearButton).toHaveClass(/textControlClearButton/)

    renderSettingsPage(
      <ClearableTextField label="shared clearable" value="synthetic" onClear={vi.fn()} />,
    )
    const sharedClearButton = screen.getByRole('button', { name: 'shared clearableをクリア' })
    expect(sharedClearButton).toBeVisible()
    expect(clearableSource).toContain("alignSelf: 'center'")
    expect(clearableSource).toContain("height: '100%'")
    expect(clearableSource).toContain('sx={{ mr: 0 }}')
  })

  it('[AC 2.9] keeps ClearableTextField clear behavior and fallback adornment branches covered', () => {
    const onClear = vi.fn()
    const { rerender } = render(
      <ClearableTextField label="shared clearable" value="synthetic" onClear={onClear} />,
    )

    fireEvent.mouseDown(screen.getByRole('button', { name: 'shared clearableをクリア' }))
    fireEvent.click(screen.getByRole('button', { name: 'shared clearableをクリア' }))
    expect(onClear).toHaveBeenCalledTimes(1)

    rerender(
      <ClearableTextField
        label="shared clearable"
        value=""
        onClear={onClear}
        slotProps={{
          input: {
            endAdornment: <span data-testid="fallback-adornment">suffix</span>,
          },
        }}
      />,
    )
    expect(screen.queryByRole('button', { name: 'shared clearableをクリア' })).toBeNull()
    expect(screen.getByTestId('fallback-adornment')).toBeVisible()

    rerender(
      <ClearableTextField label="shared clearable" value="synthetic" disabled onClear={onClear} />,
    )
    expect(screen.queryByRole('button', { name: 'shared clearableをクリア' })).toBeNull()

    rerender(<ClearableTextField value="synthetic" onClear={onClear} />)
    expect(screen.getByRole('button', { name: '入力をクリア' })).toBeVisible()
  })
})
