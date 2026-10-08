import { fireEvent, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SettingsPage } from '@/features/settings/SettingsPage'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'
import { renderSettingsPage, mockWindowScrollTo } from './support/settingsScreenHelpers'

function renderSettings() {
  return renderSettingsPage(
    <SettingsPage
      isNavigationOpen={false}
      onNavigationClick={vi.fn()}
      mpegtsSupported={true}
      currentPreviewTheme="light"
    />,
  )
}

describe('Requirement 1.22 extended pagination switch in the rule section', () => {
  beforeEach(() => {
    localStorage.clear()
    localStorage.setItem('settings', JSON.stringify(new DefaultSettingsFactory().create()))
    mockWindowScrollTo()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('[AC 1.22] shows the switch right after the rule page-size select, off by default, with its helper text', () => {
    renderSettings()

    const toggle = screen.getByRole('switch', { name: 'ルール 拡張ページネーションの有効化' })
    expect(toggle).not.toBeChecked()
    expect(
      screen.getByText(
        'ルール一覧で先頭・最終ページへの移動とページ数の入力ができるページネーションを使う',
      ),
    ).toBeVisible()

    const pageSize = screen.getByRole('combobox', { name: 'ルール 表示件数' })
    expect(pageSize.compareDocumentPosition(toggle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    const nextControl = within(screen.getByTestId('settings-card'))
      .getAllByRole('switch')
      .find((control) => control.compareDocumentPosition(toggle) & Node.DOCUMENT_POSITION_PRECEDING)
    expect(nextControl).toHaveAccessibleName('ビデオプレーヤ 字幕の縁取りを強制する')
  })

  it('[AC 1.22] edits only the draft until 保存 is pressed, then persists isEnableExtendedPagination', () => {
    renderSettings()

    fireEvent.click(screen.getByRole('switch', { name: 'ルール 拡張ページネーションの有効化' }))

    expect(
      screen.getByRole('switch', { name: 'ルール 拡張ページネーションの有効化' }),
    ).toBeChecked()
    expect(JSON.parse(localStorage.getItem('settings') ?? '{}')).toMatchObject({
      isEnableExtendedPagination: false,
    })

    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    expect(JSON.parse(localStorage.getItem('settings') ?? '{}')).toMatchObject({
      isEnableExtendedPagination: true,
    })
  })
})
