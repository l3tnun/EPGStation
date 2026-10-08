import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'
import { expectHashRoute } from '../hashRouteAssertions'
import { SyntheticRealtimeConnection, createShellRepository } from './recordedSpecHelpers'
import { createRecordedRepository } from './recordedSpecRepository'

describe('Recorded list edit-mode, selection, and navigation branches', () => {
  beforeEach(() => {
    localStorage.clear()
    window.history.replaceState(null, '', '/#/recorded')
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('[AC 2.9] toggles a selected item back off and sizes selections without video files as 0B', async () => {
    const recordedRepository = createRecordedRepository()
    vi.mocked(recordedRepository.fetchRecorded).mockResolvedValue({
      ok: true,
      value: {
        records: [{ id: 101, name: 'No video files item' }],
        total: 1,
      },
    })

    render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        recordedApiRepository={recordedRepository}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    await screen.findByTestId('recorded-page')
    fireEvent.click(screen.getByRole('button', { name: '録画済みメニュー' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '編集' }))
    const item = screen.getAllByTestId('recorded-list-item')[0]
    fireEvent.click(item)
    expect(screen.getByTestId('edit-title-bar')).toHaveTextContent('1 件選択 (0.0B)')
    fireEvent.click(item)
    expect(screen.getByTestId('edit-title-bar')).toHaveTextContent('0 件選択 (0.0B)')
  })

  it('[AC 2.1] selects only the records that have an id when using select-all', async () => {
    const recordedRepository = createRecordedRepository()
    vi.mocked(recordedRepository.fetchRecorded).mockResolvedValue({
      ok: true,
      value: {
        records: [
          { id: 101, name: 'Has id', videoFiles: [{ id: 201, size: 100 }] },
          { name: 'Missing id' },
        ],
        total: 2,
      },
    })

    render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        recordedApiRepository={recordedRepository}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    await screen.findByTestId('recorded-page')
    fireEvent.click(screen.getByRole('button', { name: '録画済みメニュー' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '編集' }))
    fireEvent.click(screen.getByRole('button', { name: 'すべて選択' }))
    // Only the record with an id counts toward the selection total.
    expect(screen.getByTestId('edit-title-bar')).toHaveTextContent('1 件選択 (100.0B)')
  })

  it('[AC 2.7] narrows a stale selection to what refetched data still contains, like Recording/Reserves', async () => {
    // Seed the route with a timestamp query so the app-shell route-normalization
    // redirect (AppShellContent's createTimestampNormalizedRoutePath) does not
    // remount RecordedPage on first render; this test targets the same-route
    // Socket.IO refetch path only, not client-side pagination navigation.
    window.history.replaceState(null, '', '/#/recorded?timestamp=1')

    const recordedRepository = createRecordedRepository()
    const connection = new SyntheticRealtimeConnection()
    const withId101 = {
      ok: true as const,
      value: {
        records: [{ id: 101, name: 'First page item', videoFiles: [{ id: 201, size: 100 }] }],
        total: 1,
      },
    }
    const withoutId101 = {
      ok: true as const,
      value: {
        records: [{ id: 202, name: 'Other item', videoFiles: [{ id: 302, size: 50 }] }],
        total: 1,
      },
    }
    vi.mocked(recordedRepository.fetchRecorded).mockResolvedValueOnce(withId101)

    render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        recordedApiRepository={recordedRepository}
        realtimeConnectionFactory={() => connection}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    await screen.findByTestId('recorded-page')
    fireEvent.click(screen.getByRole('button', { name: '録画済みメニュー' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '編集' }))
    fireEvent.click(screen.getAllByTestId('recorded-list-item')[0])
    expect(screen.getByTestId('edit-title-bar')).toHaveTextContent('1 件選択 (100.0B)')

    // A Socket.IO updateStatus refetch (no route change) replaces the visible
    // records with a set that no longer includes the selected item.
    vi.mocked(recordedRepository.fetchRecorded).mockResolvedValueOnce(withoutId101)
    act(() => {
      connection.emit('updateStatus')
    })
    await screen.findByText('Other item')
    expect(screen.getByTestId('edit-title-bar')).toHaveTextContent('0 件選択 (0.0B)')

    // A later refetch brings the originally-selected id back into view. Like
    // Recording (`toggleVisibleRecordingSelection`) and Reserves
    // (`toggleVisibleReserveSelection`), which both narrow `selectedIds` to
    // the visible set on every refetch via a 'preserve-visible' effect,
    // Recorded must not resurrect a selection the user never made on this
    // sighting of the item; v2 has the same property because
    // `RecordedState.fetchData` only restores `isSelected` for ids still
    // present in the array being replaced.
    vi.mocked(recordedRepository.fetchRecorded).mockResolvedValueOnce(withId101)
    act(() => {
      connection.emit('updateStatus')
    })
    await screen.findByText('First page item')
    expect(screen.getByTestId('edit-title-bar')).toHaveTextContent('0 件選択 (0.0B)')
  })

  it('[AC 4.1] opens the upload route from the recorded menu', async () => {
    const recordedRepository = createRecordedRepository()

    render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        recordedApiRepository={recordedRepository}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    await screen.findByTestId('recorded-page')
    fireEvent.click(screen.getByRole('button', { name: '録画済みメニュー' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'アップロード' }))
    expectHashRoute('#/recorded/upload')
  })

  it('[AC 3.1] navigates to the detail route when a table row is clicked outside edit mode', async () => {
    const recordedRepository = createRecordedRepository()
    vi.mocked(recordedRepository.fetchRecorded).mockResolvedValue({
      ok: true,
      value: {
        records: [
          { id: 101, name: 'Table nav target', videoFiles: [{ id: 201, size: 10 }] },
          { name: 'Missing id row' },
        ],
        total: 2,
      },
    })

    render(
      <App
        settings={{ ...new DefaultSettingsFactory().create(), isShowTableMode: true }}
        apiRepository={createShellRepository()}
        recordedApiRepository={recordedRepository}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    await screen.findByText('Table nav target')
    const rows = screen.getAllByTestId('recorded-list-item')
    expect(rows).toHaveLength(2)
    // Clicking the item menu button is an interactive click and must not navigate.
    const hashBeforeMenuClick = window.location.hash
    fireEvent.click(screen.getByRole('button', { name: '録画メニュー: Table nav target' }))
    expect(window.location.hash).toBe(hashBeforeMenuClick)
    // A click on interactive content inside a menu-opened dialog (portal child of the row)
    // must also be treated as interactive and not navigate.
    fireEvent.click(screen.getByRole('menuitem', { name: 'delete' }))
    fireEvent.click(await screen.findByRole('checkbox', { name: /synthetic|#201/ }))
    expect(window.location.hash).toBe(hashBeforeMenuClick)
    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
    fireEvent.click(rows[0])
    expectHashRoute('#/recorded/detail/101')
  })

  it('[AC 3.1] navigates to the detail route when a small-card item is clicked outside edit mode', async () => {
    const recordedRepository = createRecordedRepository()
    vi.mocked(recordedRepository.fetchRecorded).mockResolvedValue({
      ok: true,
      value: {
        records: [
          { id: 102, name: 'Small card nav target', videoFiles: [{ id: 202, size: 10 }] },
          { name: 'Missing id small card' },
        ],
        total: 2,
      },
    })

    render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        recordedApiRepository={recordedRepository}
        osPrefersDark={false}
        viewportWidth={600}
        initialDrawerState="none"
      />,
    )

    await screen.findByText('Small card nav target')
    expect(screen.getByTestId('recorded-page')).toHaveAttribute(
      'data-recorded-layout',
      'small-card',
    )
    // Clicking the item menu button is an interactive click and must not navigate.
    const hashBeforeMenuClick = window.location.hash
    fireEvent.click(screen.getByRole('button', { name: '録画メニュー: Small card nav target' }))
    expect(window.location.hash).toBe(hashBeforeMenuClick)
    // A click on interactive content inside a menu-opened dialog (portal child of the card)
    // must also be treated as interactive and not navigate.
    fireEvent.click(screen.getByRole('menuitem', { name: 'delete' }))
    fireEvent.click(await screen.findByRole('checkbox', { name: /synthetic|#202/ }))
    expect(window.location.hash).toBe(hashBeforeMenuClick)
    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
    fireEvent.click(screen.getAllByTestId('recorded-list-item')[0])
    expectHashRoute('#/recorded/detail/102')
  })
})
