import { fireEvent, render, screen } from '@testing-library/react'
import { ThemeProvider, createTheme } from '@mui/material'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import { createShellTheme } from '@/app/theme'
import {
  EditTitleBar,
  TitleBar,
  resolveLegacyTitleBarMetrics,
  resolveLegacyTitleBarMinHeight,
} from '@/app/titleBar'

function renderWithTheme(ui: React.ReactElement, mode: 'light' | 'dark' = 'light') {
  return render(<ThemeProvider theme={createTheme({ palette: { mode } })}>{ui}</ThemeProvider>)
}

function renderWithShellTheme(ui: React.ReactElement, mode: 'light' | 'dark' = 'light') {
  return render(<ThemeProvider theme={createShellTheme(mode)}>{ui}</ThemeProvider>)
}

describe('Requirement 2.1-2.9 TitleBar shared contract', () => {
  afterEach(() => {
    document.title = ''
  })

  it('[AC 2.8] [AC 2.9] renders navigation, title, right action slot, extension slot, and syncs browser title', () => {
    const onNavigate = vi.fn()
    const onTitleClick = vi.fn()

    renderWithTheme(
      <TitleBar
        title="録画済み"
        isNavigationOpen={false}
        onNavigationClick={onNavigate}
        onTitleClick={onTitleClick}
        rightActions={<button type="button">screen menu</button>}
        extension={<div>screen tabs</div>}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'ナビゲーションを開閉' }))
    fireEvent.click(screen.getByRole('heading', { name: '録画済み' }))

    expect(onNavigate).toHaveBeenCalledTimes(1)
    expect(onTitleClick).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('heading', { name: '録画済み' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '録画済み' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'screen menu' })).toBeInTheDocument()
    expect(screen.getByText('screen tabs')).toBeInTheDocument()
    expect(document.title).toBe('録画済み')
  })

  it('[AC 2.9] does not make the title clickable when the routed screen omits a title handler', () => {
    renderWithTheme(<TitleBar title="設定" isNavigationOpen={false} onNavigationClick={vi.fn()} />)

    expect(screen.queryByRole('button', { name: '設定' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '設定' })).toBeInTheDocument()
  })

  it('[AC 2.1] [AC 2.2] exposes the navigation drawer expanded state on the navigation toggle', () => {
    const { rerender } = renderWithTheme(
      <TitleBar title="設定" onNavigationClick={vi.fn()} isNavigationOpen={false} />,
    )

    expect(screen.getByRole('button', { name: 'ナビゲーションを開閉' })).toHaveAttribute(
      'aria-expanded',
      'false',
    )

    rerender(
      <ThemeProvider theme={createTheme({ palette: { mode: 'light' } })}>
        <TitleBar title="設定" onNavigationClick={vi.fn()} isNavigationOpen={true} />
      </ThemeProvider>,
    )

    expect(screen.getByRole('button', { name: 'ナビゲーションを開閉' })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
  })

  it('[AC 2.9] keeps a clickable title heading without adding a title button role', () => {
    const onTitleClick = vi.fn()

    renderWithTheme(
      <TitleBar
        title="録画済み"
        isNavigationOpen={false}
        onNavigationClick={vi.fn()}
        onTitleClick={onTitleClick}
      />,
    )

    const titleHeading = screen.getByRole('heading', { level: 1, name: '録画済み' })

    fireEvent.click(titleHeading)

    expect(onTitleClick).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: '録画済み' })).not.toBeInTheDocument()
  })

  it('[AC 2.4] [AC 2.5] applies stable light and dark app bar treatments through MUI theme state', () => {
    const { rerender } = renderWithTheme(
      <TitleBar title="検索" isNavigationOpen={false} onNavigationClick={vi.fn()} />,
    )

    expect(screen.getByTestId('title-bar')).toHaveAttribute('data-app-bar-treatment', 'light')
    expect(screen.getByTestId('title-bar')).toHaveStyle({
      backgroundColor: 'rgb(63, 81, 181)',
    })

    rerender(
      <ThemeProvider theme={createTheme({ palette: { mode: 'dark' } })}>
        <TitleBar title="検索" isNavigationOpen={false} onNavigationClick={vi.fn()} />
      </ThemeProvider>,
    )

    expect(screen.getByTestId('title-bar')).toHaveAttribute('data-app-bar-treatment', 'dark')
    expect(screen.getByTestId('title-bar')).toHaveStyle({
      backgroundColor: 'rgb(39, 39, 39)',
    })
  })

  it('[AC 7.1] matches Vuetify dark app-bar color for edit title bars', () => {
    renderWithTheme(
      <EditTitleBar title="1 件選択" onClose={vi.fn()} onSelectAll={vi.fn()} onDelete={vi.fn()} />,
      'dark',
    )

    expect(screen.getByTestId('edit-title-bar')).toHaveStyle({
      backgroundColor: 'rgb(39, 39, 39)',
    })
  })

  it('[AC 7.1] matches Vuetify light app-bar color (white), not the page background, for edit title bars', () => {
    renderWithShellTheme(
      <EditTitleBar title="1 件選択" onClose={vi.fn()} onSelectAll={vi.fn()} onDelete={vi.fn()} />,
      'light',
    )

    expect(screen.getByTestId('edit-title-bar')).toHaveStyle({
      backgroundColor: 'rgb(255, 255, 255)',
    })
  })

  it('[AC 2.10] clips only the upper title bar shadow so no 1px line appears above the app bar', () => {
    renderWithTheme(<TitleBar title="検索" isNavigationOpen={false} onNavigationClick={vi.fn()} />)

    expect(screen.getByTestId('title-bar')).toHaveStyle({
      clipPath: 'inset(0 0 -16px 0)',
      top: '0px',
    })
  })

  it('[AC 2.11] keeps the legacy Vuetify toolbar height breakpoint for tablet parity', () => {
    expect(resolveLegacyTitleBarMinHeight(390)).toBe(56)
    expect(resolveLegacyTitleBarMinHeight(900)).toBe(56)
    expect(resolveLegacyTitleBarMinHeight(959)).toBe(56)
    expect(resolveLegacyTitleBarMinHeight(960)).toBe(64)
    expect(resolveLegacyTitleBarMinHeight(1440)).toBe(64)
  })

  it('[AC 2.12] keeps the legacy Vuetify toolbar inner geometry for navigation and title', () => {
    expect(resolveLegacyTitleBarMetrics()).toEqual({
      toolbarPaddingX: 16,
      toolbarPaddingY: 4,
      navigationButtonMarginLeft: -12,
      navigationButtonSize: 48,
      titlePaddingLeft: 20,
    })
  })

  it('[AC 2.3] routes edit title bar actions to the screen owner without owning edit state', () => {
    const onClose = vi.fn()
    const onSelectAll = vi.fn()
    const onDelete = vi.fn()

    renderWithTheme(
      <EditTitleBar
        title="2 件選択中"
        onClose={onClose}
        onSelectAll={onSelectAll}
        onDelete={onDelete}
      />,
    )

    expect(screen.getByTestId('edit-title-bar')).toHaveStyle({
      clipPath: 'inset(0 0 -16px 0)',
      top: '0px',
    })
    fireEvent.click(screen.getByRole('button', { name: '編集を終了' }))
    fireEvent.click(screen.getByRole('button', { name: 'すべて選択' }))
    fireEvent.click(screen.getByRole('button', { name: '選択項目を削除' }))

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onSelectAll).toHaveBeenCalledTimes(1)
    expect(onDelete).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('edit-title-bar')).not.toHaveAttribute('data-edit-owned')
  })

  it('[AC 2.1] [AC 2.2] [AC 2.6] lets a routed screen display the Dashboard version title and toggle shell navigation', () => {
    window.history.replaceState(null, '', '/#/')

    render(
      <App
        dashboardVersion="9.9.9"
        initialDrawerState="none"
        osPrefersDark={false}
        viewportWidth={1440}
      />,
    )

    expect(screen.getByTestId('title-bar')).toHaveAttribute('data-app-bar-treatment', 'light')
    expect(screen.getByRole('heading', { name: 'EPGStation v9.9.9' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'ナビゲーションを開閉' })).toHaveAttribute(
      'aria-controls',
      'shell-navigation-drawer',
    )
    expect(screen.getByRole('button', { name: 'ナビゲーションを開閉' })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    expect(document.title).toBe('EPGStation v9.9.9')

    fireEvent.click(screen.getByRole('button', { name: 'ナビゲーションを開閉' }))

    expect(screen.getByTestId('shell-drawer')).toHaveAttribute('data-drawer-open', 'false')
    expect(screen.getByRole('button', { name: 'ナビゲーションを開閉' })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
    expect(screen.getByTestId('shell-main')).toHaveAttribute('data-main-offset', '0')

    fireEvent.click(screen.getByRole('button', { name: 'ナビゲーションを開閉' }))

    expect(screen.getByTestId('shell-drawer')).toHaveAttribute('data-drawer-open', 'true')
    expect(screen.getByRole('button', { name: 'ナビゲーションを開閉' })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
  })
})
