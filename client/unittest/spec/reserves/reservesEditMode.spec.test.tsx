import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'
import { expectHashRoute } from '../hashRouteAssertions'
import {
  SyntheticRealtimeConnection,
  createShellRepository,
  createReservesRepository,
  findReserveRow,
  getReserveRow,
} from './reservesTestKit'

describe('Reserves edit mode and menu routes', () => {
  beforeEach(() => {
    localStorage.clear()
    window.history.replaceState(null, '', '/#/reserves?type=conflict&page=3&timestamp=999')
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('[AC 2.7] [AC 3.4] [AC 3.5] [AC 3.6] uses edit mode for item selection, select-all toggle, exit clearing, and dialog suppression', async () => {
    render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        reservesApiRepository={createReservesRepository()}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    await findReserveRow('Synthetic reserve one')
    fireEvent.click(screen.getByRole('button', { name: '予約メニュー' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '編集' }))
    expect(screen.getByTestId('edit-title-bar')).toHaveTextContent('0 件選択')

    fireEvent.click(getReserveRow('Synthetic reserve one'))

    expect(screen.getByTestId('edit-title-bar')).toHaveTextContent('1 件選択')
    expect(screen.queryByRole('dialog', { name: 'Synthetic reserve one' })).not.toBeInTheDocument()

    fireEvent.click(getReserveRow('Synthetic reserve one'))
    expect(screen.getByTestId('edit-title-bar')).toHaveTextContent('0 件選択')

    fireEvent.click(getReserveRow('Synthetic reserve one'))
    expect(screen.getByTestId('edit-title-bar')).toHaveTextContent('1 件選択')

    fireEvent.click(screen.getByRole('button', { name: 'すべて選択' }))
    expect(screen.getByTestId('edit-title-bar')).toHaveTextContent('2 件選択')

    fireEvent.click(screen.getByRole('button', { name: 'すべて選択' }))
    expect(screen.getByTestId('edit-title-bar')).toHaveTextContent('0 件選択')

    fireEvent.click(getReserveRow('Synthetic reserve two'))
    expect(screen.getByTestId('edit-title-bar')).toHaveTextContent('1 件選択')
    fireEvent.click(screen.getByRole('button', { name: '編集を終了' }))
    fireEvent.click(screen.getByRole('button', { name: '予約メニュー' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '編集' }))
    expect(screen.getByTestId('edit-title-bar')).toHaveTextContent('0 件選択')
  })

  it('[AC 3.12] preserves selected visible reserve ids after refetch replaces row objects', async () => {
    const reservesRepository = createReservesRepository()
    const connection = new SyntheticRealtimeConnection()

    render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        reservesApiRepository={reservesRepository}
        realtimeConnectionFactory={() => connection}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    await findReserveRow('Synthetic reserve one')
    fireEvent.click(screen.getByRole('button', { name: '予約メニュー' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '編集' }))
    fireEvent.click(getReserveRow('Synthetic reserve one'))
    expect(screen.getByTestId('edit-title-bar')).toHaveTextContent('1 件選択')

    vi.mocked(reservesRepository.fetchReserves).mockResolvedValueOnce({
      ok: true,
      value: {
        reserves: [
          { id: 101, name: 'Synthetic reserve one refreshed' },
          { id: 103, name: 'Synthetic reserve three' },
        ],
        total: 2,
      },
    })

    act(() => {
      connection.emit('updateStatus')
    })

    expect(await findReserveRow('Synthetic reserve one refreshed')).toBeVisible()
    expect(screen.getByTestId('edit-title-bar')).toHaveTextContent('1 件選択')
  })

  it('[AC 2.11] [AC 2.12] routes ReserveMenu recorded search and edit actions', async () => {
    const firstView = render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        reservesApiRepository={createReservesRepository()}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    await findReserveRow('Synthetic reserve one')
    fireEvent.click(screen.getByRole('button', { name: '予約メニュー: Synthetic reserve one' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'recorded' }))

    await waitFor(() => {
      expectHashRoute('#/recorded?ruleId=501')
    })

    firstView.unmount()
    window.history.replaceState(null, '', '/#/reserves?type=normal')
    render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        reservesApiRepository={createReservesRepository()}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    await findReserveRow('Synthetic reserve one')
    fireEvent.click(screen.getByRole('button', { name: '予約メニュー: Synthetic reserve one' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'edit' }))
    await waitFor(() => {
      expectHashRoute('#/search?rule=501')
    })
  })
})
