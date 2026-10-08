import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import { ReserveDeleteDialog, ReservesPage } from '@/features/reserves'
import type { ReserveListItem } from '@/features/reserves/reservesApi'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'
import {
  createShellRepository,
  createReservesRepository,
  findReserveRow,
  getReserveRow,
} from './reservesTestKit'

describe('Reserves delete, unlock and update actions', () => {
  beforeEach(() => {
    localStorage.clear()
    window.history.replaceState(null, '', '/#/reserves?type=conflict&page=3&timestamp=999')
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('[AC 2.14] [AC 2.17] [AC 3.1] [AC 3.2] [AC 3.3] deletes a normal reserve through the single delete dialog and refreshes the list', async () => {
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
    fireEvent.click(screen.getByRole('button', { name: '予約メニュー: Synthetic reserve one' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'delete' }))

    expect(await screen.findByRole('dialog', { name: '予約削除' })).toHaveTextContent(
      'Synthetic reserve one を削除しますか?',
    )
    vi.useFakeTimers()
    fireEvent.click(screen.getByRole('button', { name: '削除' }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(screen.getByRole('alert')).toHaveTextContent('Synthetic reserve one を削除')
    expect(reservesRepository.deleteReserve).toHaveBeenCalledWith(101)
    expect(getReserveRow('Synthetic reserve one')).toBeVisible()
    expect(reservesRepository.fetchReserves).toHaveBeenCalledTimes(2)
  })

  it('[AC 3.1] [AC 3.3] uses fallback label for single delete and reports API failure', async () => {
    const reservesRepository = createReservesRepository()
    vi.mocked(reservesRepository.deleteReserve).mockResolvedValueOnce({
      ok: false,
      error: 'reserve-delete-failed',
      message: '予約削除に失敗',
    })
    const reserve: ReserveListItem = { id: 404 }
    const onSnackbar = vi.fn()

    render(
      <App
        settings={new DefaultSettingsFactory().create()}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      >
        <ReserveDeleteDialog
          open
          reserve={reserve}
          apiRepository={reservesRepository}
          onClose={() => undefined}
          onSnackbar={onSnackbar}
        />
      </App>,
    )

    const dialog = await screen.findByRole('dialog', { name: '予約削除' })
    expect(dialog).toHaveTextContent('予約id: 404 を削除しますか?')

    fireEvent.click(within(dialog).getByRole('button', { name: '削除' }))

    await waitFor(() => {
      expect(reservesRepository.deleteReserve).toHaveBeenCalledWith(404)
    })
    expect(onSnackbar).toHaveBeenCalledWith({
      text: '予約id: 404 を削除に失敗',
      severity: 'error',
    })
  })

  it('[AC 2.13] hides destructive menu actions for conflict reserves', async () => {
    const reservesRepository = createReservesRepository()
    vi.mocked(reservesRepository.fetchReserves).mockResolvedValueOnce({
      ok: true,
      value: {
        reserves: [{ id: 201, name: 'Synthetic conflict reserve', isConflict: true }],
        total: 1,
      },
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

    await findReserveRow('Synthetic conflict reserve')
    fireEvent.click(
      screen.getByRole('button', { name: '予約メニュー: Synthetic conflict reserve' }),
    )

    expect(screen.queryByRole('menuitem', { name: 'delete' })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'unlock' })).not.toBeInTheDocument()
  })

  it('[AC 2.15] [AC 2.17] unlocks skip reserves through API and snackbar without optimistic removal or direct refetch', async () => {
    const reservesRepository = createReservesRepository()
    vi.mocked(reservesRepository.fetchReserves).mockResolvedValueOnce({
      ok: true,
      value: {
        reserves: [{ id: 301, name: 'Synthetic skip reserve', isSkip: true }],
        total: 1,
      },
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

    await findReserveRow('Synthetic skip reserve')
    fireEvent.click(screen.getByRole('button', { name: '予約メニュー: Synthetic skip reserve' }))
    vi.useFakeTimers()
    fireEvent.click(screen.getByRole('menuitem', { name: 'unlock' }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(screen.getByRole('alert')).toHaveTextContent('Synthetic skip reserve 除外解除')
    expect(reservesRepository.unlockSkipReserve).toHaveBeenCalledWith(301)
    expect(getReserveRow('Synthetic skip reserve')).toBeVisible()
    expect(reservesRepository.fetchReserves).toHaveBeenCalledTimes(1)
  })

  it('[AC 2.24] closes the title bar menu when it is dismissed without selecting an action', async () => {
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
    expect(await screen.findByRole('menuitem', { name: '編集' })).toBeVisible()

    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })

    await waitFor(() => {
      expect(screen.queryByRole('menuitem', { name: '編集' })).not.toBeInTheDocument()
    })
  })

  it('[AC 2.8] [AC 2.18] runs reserve update from title bar without direct list refetch', async () => {
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
    vi.useFakeTimers()
    fireEvent.click(screen.getByRole('menuitem', { name: '予約情報更新' }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(screen.getByRole('alert')).toHaveTextContent('予約情報の更新開始')
    expect(reservesRepository.updateReserves).toHaveBeenCalled()
    expect(reservesRepository.fetchReserves).toHaveBeenCalledTimes(1)
  })

  it('[AC 2.8] reports reserve update failure from the title bar without a list refetch', async () => {
    const reservesRepository = createReservesRepository()
    vi.mocked(reservesRepository.updateReserves).mockResolvedValueOnce({
      ok: false,
      error: 'reserves-update-failed',
      message: '予約情報の更新を開始できませんでした。',
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
    vi.useFakeTimers()
    fireEvent.click(screen.getByRole('menuitem', { name: '予約情報更新' }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(screen.getByRole('alert')).toHaveTextContent('予約情報の更新を開始できませんでした。')
    expect(reservesRepository.fetchReserves).toHaveBeenCalledTimes(1)
  })

  it('[AC 3.7] [AC 3.9] shows zero-selection snackbar and closes bulk delete dialog from edit title bar', async () => {
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
    vi.useFakeTimers()
    fireEvent.click(screen.getByRole('button', { name: '選択項目を削除' }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(screen.getByRole('alert')).toHaveTextContent('番組を選択してください。')
    expect(screen.queryByRole('dialog', { name: '予約一括削除' })).not.toBeInTheDocument()
    expect(screen.getByTestId('edit-title-bar')).toHaveTextContent('0 件選択')
  })

  it('[AC 3.9] does not duplicate zero-selection bulk snackbar under StrictMode', async () => {
    const reservesRepository = createReservesRepository()
    const onFetchFailure = vi.fn()

    render(
      <StrictMode>
        <App
          settings={new DefaultSettingsFactory().create()}
          apiRepository={createShellRepository()}
          osPrefersDark={false}
          viewportWidth={1440}
          initialDrawerState="none"
        >
          <ReservesPage
            isNavigationOpen={false}
            onNavigationClick={() => undefined}
            settings={new DefaultSettingsFactory().create()}
            apiRepository={reservesRepository}
            onFetchFailure={onFetchFailure}
          />
        </App>
      </StrictMode>,
    )

    await findReserveRow('Synthetic reserve one')
    fireEvent.click(screen.getByRole('button', { name: '予約メニュー' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '編集' }))
    fireEvent.click(screen.getByRole('button', { name: '選択項目を削除' }))

    expect(screen.queryByRole('dialog', { name: '予約一括削除' })).not.toBeInTheDocument()
    expect(onFetchFailure).toHaveBeenCalledTimes(1)
    expect(onFetchFailure).toHaveBeenCalledWith({
      text: '番組を選択してください。',
      severity: 'error',
    })
  })
})
