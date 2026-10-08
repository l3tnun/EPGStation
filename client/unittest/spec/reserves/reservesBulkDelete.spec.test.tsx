import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'
import {
  createShellRepository,
  createReservesRepository,
  findReserveRow,
  getReserveRow,
} from './reservesTestKit'

describe('Reserves bulk delete and layout', () => {
  beforeEach(() => {
    localStorage.clear()
    window.history.replaceState(null, '', '/#/reserves?type=conflict&page=3&timestamp=999')
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('[AC 3.7] [AC 3.8] [AC 3.10] [AC 3.11] bulk deletes selected reserves sequentially, exits edit mode, clears selection, and waits for external refetch', async () => {
    const reservesRepository = createReservesRepository()

    render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        reservesApiRepository={reservesRepository}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    await findReserveRow('Synthetic reserve one')
    fireEvent.click(screen.getByRole('button', { name: '予約メニュー' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '編集' }))
    fireEvent.click(getReserveRow('Synthetic reserve one'))
    fireEvent.click(getReserveRow('Synthetic reserve two'))
    fireEvent.click(screen.getByRole('button', { name: '選択項目を削除' }))

    const dialog = await screen.findByRole('dialog', { name: '予約一括削除' })
    expect(dialog).toHaveTextContent('選択した 2 件の番組を削除しますか。')
    expect(within(dialog).queryByRole('heading', { name: '予約一括削除' })).not.toBeInTheDocument()
    vi.useFakeTimers()
    fireEvent.click(within(dialog).getByRole('button', { name: '削除' }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(screen.getByRole('alert')).toHaveTextContent('選択した番組の予約をキャンセルしました。')
    expect(reservesRepository.deleteReserve).toHaveBeenNthCalledWith(1, 101)
    expect(reservesRepository.deleteReserve).toHaveBeenNthCalledWith(2, 102)
    expect(screen.queryByTestId('edit-title-bar')).not.toBeInTheDocument()
    expect(getReserveRow('Synthetic reserve one')).toBeVisible()
    expect(getReserveRow('Synthetic reserve two')).toBeVisible()

    fireEvent.click(screen.getByRole('button', { name: '予約メニュー' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '編集' }))
    expect(screen.getByTestId('edit-title-bar')).toHaveTextContent('0 件選択')
    expect(reservesRepository.fetchReserves).toHaveBeenCalledTimes(1)
  })

  it('[AC 3.6] [AC 3.11] reports partial bulk delete failure after sequential DELETE attempts', async () => {
    const reservesRepository = createReservesRepository()
    vi.mocked(reservesRepository.deleteReserve)
      .mockResolvedValueOnce({ ok: true, value: undefined })
      .mockResolvedValueOnce({
        ok: false,
        error: 'reserve-delete-failed',
        message: '予約削除に失敗',
      })

    render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        reservesApiRepository={reservesRepository}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    await findReserveRow('Synthetic reserve one')
    fireEvent.click(screen.getByRole('button', { name: '予約メニュー' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '編集' }))
    fireEvent.click(screen.getByRole('button', { name: 'すべて選択' }))
    fireEvent.click(screen.getByRole('button', { name: '選択項目を削除' }))
    const bulkDeleteDialog = await screen.findByRole('dialog', { name: '予約一括削除' })

    vi.useFakeTimers()
    fireEvent.click(within(bulkDeleteDialog).getByRole('button', { name: '削除' }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(screen.getByRole('alert')).toHaveTextContent('一部番組のキャンセルに失敗しました。')
    expect(reservesRepository.deleteReserve).toHaveBeenCalledTimes(2)
    expect(reservesRepository.fetchReserves).toHaveBeenCalledTimes(1)
  })

  it('[AC 2.22] [AC 3.4] exposes table/card layout and edit visual state with synthetic reserves', async () => {
    const tableView = render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        reservesApiRepository={createReservesRepository()}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    expect(await screen.findByTestId('reserves-page')).toHaveAttribute(
      'data-reserves-layout',
      'table',
    )
    tableView.unmount()

    window.history.replaceState(null, '', '/#/reserves')
    render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        reservesApiRepository={createReservesRepository()}
        osPrefersDark={false}
        viewportWidth={390}
        initialDrawerState="none"
      />,
    )

    expect(await screen.findByTestId('reserves-page')).toHaveAttribute(
      'data-reserves-layout',
      'card',
    )
    fireEvent.click(screen.getByRole('button', { name: '予約メニュー' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '編集' }))
    fireEvent.click(getReserveRow('Synthetic reserve one'))

    expect(screen.getByTestId('edit-title-bar')).toHaveTextContent('1 件選択')
    expect(screen.getAllByTestId('reserves-list-item')[0]).toHaveAttribute('data-selected', 'true')
  })
})
