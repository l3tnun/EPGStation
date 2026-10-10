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

const SWITCH_NAME = 'ページネーション 拡張ページネーションの有効化'
const HELPER_TEXT =
  '録画済み・録画中・予約・ルール一覧のページ移動を拡張ページネーションに置き換える'

describe('Requirement 1.22 extended pagination switch in its own pagination section', () => {
  beforeEach(() => {
    localStorage.clear()
    localStorage.setItem('settings', JSON.stringify(new DefaultSettingsFactory().create()))
    mockWindowScrollTo()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('[AC 1.22] shows the switch alone in a pagination section between rules and the video player, off by default, with its helper text', () => {
    renderSettings()

    const toggle = screen.getByRole('switch', { name: SWITCH_NAME })
    expect(toggle).not.toBeChecked()
    expect(screen.getByText(HELPER_TEXT)).toBeVisible()
    expect(
      screen.queryByRole('switch', { name: 'ルール 拡張ページネーションの有効化' }),
    ).not.toBeInTheDocument()

    const headings = within(screen.getByTestId('settings-card'))
      .getAllByRole('heading', { level: 2 })
      .map((heading) => heading.textContent)
    const ruleIndex = headings.indexOf('ルール')
    expect(headings[ruleIndex + 1]).toBe('ページネーション')
    expect(headings[ruleIndex + 2]).toBe('ビデオプレーヤ')

    const pageSize = screen.getByRole('combobox', { name: 'ルール 表示件数' })
    expect(pageSize.compareDocumentPosition(toggle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    const previousControl = within(screen.getByTestId('settings-card'))
      .getAllByRole('combobox')
      .filter(
        (control) => control.compareDocumentPosition(toggle) & Node.DOCUMENT_POSITION_PRECEDING,
      )
      .at(-1)
    expect(previousControl).toBe(pageSize)
    const nextControl = within(screen.getByTestId('settings-card'))
      .getAllByRole('switch')
      .find((control) => control.compareDocumentPosition(toggle) & Node.DOCUMENT_POSITION_PRECEDING)
    expect(nextControl).toHaveAccessibleName('ビデオプレーヤ 字幕の縁取りを強制する')
  })

  it('[AC 1.22] edits only the draft until 保存 is pressed, then persists isEnableExtendedPagination', () => {
    renderSettings()

    fireEvent.click(screen.getByRole('switch', { name: SWITCH_NAME }))

    expect(screen.getByRole('switch', { name: SWITCH_NAME })).toBeChecked()
    expect(JSON.parse(localStorage.getItem('settings') ?? '{}')).toMatchObject({
      isEnableExtendedPagination: false,
    })

    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    expect(JSON.parse(localStorage.getItem('settings') ?? '{}')).toMatchObject({
      isEnableExtendedPagination: true,
    })
  })
})
