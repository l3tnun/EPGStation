import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SettingsPage } from '@/features/settings/SettingsPage'
import { SettingsControl } from '@/features/settings/components/SettingsControl'
import { SettingsSchemeControl } from '@/features/settings/components/SettingsSchemeControl'
import type { SettingsControlDefinition } from '@/features/settings/settingsControlMatrix'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'
import {
  renderSettingsPage,
  mockWindowScrollTo,
  expectSettingsSelectVisibleText,
} from './support/settingsScreenHelpers'

const baseTmp = new DefaultSettingsFactory().create()

const syntheticTextControl = {
  section: '全般',
  label: 'synthetic text',
  key: 'recordedDownloadURLScheme',
  controlType: 'text',
  tmpTarget: 'recordedDownloadURLScheme',
} as const satisfies SettingsControlDefinition

const syntheticSelectWithoutOptions = {
  section: '全般',
  label: 'synthetic select',
  key: 'guideMode',
  controlType: 'select',
  tmpTarget: 'guideMode',
} as const satisfies SettingsControlDefinition

describe('SettingsControl standalone rendering for control-specific branches', () => {
  it('[AC 2.8] omits the URL scheme placeholder test id for a text control that is not the on-air scheme field', () => {
    render(
      <SettingsControl
        control={syntheticTextControl}
        tmp={baseTmp}
        disabled={false}
        onChange={vi.fn()}
      />,
    )

    expect(screen.queryByTestId('settings-url-scheme-placeholder')).not.toBeInTheDocument()
  })

  it('[AC 1.14] treats a select control with no options as having no selectable value', () => {
    render(
      <SettingsControl
        control={syntheticSelectWithoutOptions}
        tmp={baseTmp}
        disabled={false}
        onChange={vi.fn()}
      />,
    )

    expectSettingsSelectVisibleText('全般 synthetic select', '')
  })
})

describe('Requirements 1.9, 1.14, 2.9 Settings control clear buttons and out-of-range select display', () => {
  beforeEach(() => {
    mockWindowScrollTo()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('[AC 2.9] clears an on-air URL scheme value through its clear button', () => {
    localStorage.setItem('settings', JSON.stringify(baseTmp))
    renderSettingsPage(
      <SettingsPage isNavigationOpen={false} onNavigationClick={vi.fn()} mpegtsSupported={true} />,
    )

    const input = screen.getByRole('textbox', { name: '放映中 視聴 URL Scheme' })
    fireEvent.change(input, { target: { value: 'synthetic-player://{content-id}' } })
    fireEvent.click(screen.getByRole('button', { name: '放映中 視聴 URL Schemeをクリア' }))

    expect(input).toHaveValue('')
    expect(
      screen.queryByRole('button', { name: '放映中 視聴 URL Schemeをクリア' }),
    ).not.toBeInTheDocument()
  })

  it('[AC 1.14] shows an out-of-range stored select value as unselected without overwriting it', () => {
    localStorage.setItem('settings', JSON.stringify({ ...baseTmp, guideMode: 'legacy-unknown' }))
    renderSettingsPage(
      <SettingsPage isNavigationOpen={false} onNavigationClick={vi.fn()} mpegtsSupported={true} />,
    )

    expectSettingsSelectVisibleText('番組表 描画設定', '')
    expect(JSON.parse(localStorage.getItem('settings') ?? '{}')).toMatchObject({
      guideMode: 'legacy-unknown',
    })
  })
})

describe('Requirements 1.9, 2.9 Settings scheme control switch and clear button', () => {
  it('[AC 2.1] toggles the paired switch and reports the new checked state', () => {
    const onChange = vi.fn()
    render(
      <SettingsSchemeControl
        switchControl={{
          section: '録画',
          label: '視聴 URL Scheme',
          key: 'shouldUseRecordedViewURLScheme',
          controlType: 'switch',
          tmpTarget: 'shouldUseRecordedViewURLScheme',
        }}
        textControl={{
          section: '録画',
          label: '視聴 URL Scheme',
          key: 'recordedViewURLScheme',
          controlType: 'text',
          tmpTarget: 'recordedViewURLScheme',
        }}
        tmp={baseTmp}
        disabled={false}
        onChange={onChange}
      />,
    )

    fireEvent.click(screen.getByRole('switch', { name: '録画 視聴 URL Scheme' }))

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'shouldUseRecordedViewURLScheme' }),
      false,
    )
  })

  it('[AC 2.9] clears the paired text field through its clear button', () => {
    const onChange = vi.fn()
    render(
      <SettingsSchemeControl
        switchControl={{
          section: '録画',
          label: '視聴 URL Scheme',
          key: 'shouldUseRecordedViewURLScheme',
          controlType: 'switch',
          tmpTarget: 'shouldUseRecordedViewURLScheme',
        }}
        textControl={{
          section: '録画',
          label: '視聴 URL Scheme',
          key: 'recordedViewURLScheme',
          controlType: 'text',
          tmpTarget: 'recordedViewURLScheme',
        }}
        tmp={{ ...baseTmp, recordedViewURLScheme: 'synthetic-player://{content-id}' }}
        disabled={false}
        onChange={onChange}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '録画 視聴 URL Schemeをクリア' }))

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'recordedViewURLScheme' }),
      '',
    )
  })
})
