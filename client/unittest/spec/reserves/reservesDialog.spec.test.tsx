import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import { ReserveDialog, ReservesPage } from '@/features/reserves'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'
import { expectHashRoute } from '../hashRouteAssertions'
import {
  createShellRepository,
  createReservesRepository,
  findReserveRow,
  getReserveRow,
} from './reservesTestKit'

describe('Reserves dialog and keyboard interaction', () => {
  beforeEach(() => {
    localStorage.clear()
    window.history.replaceState(null, '', '/#/reserves?type=conflict&page=3&timestamp=999')
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('[AC 2.9] [AC 2.10] opens ReserveDialog outside edit mode, linkifies extended text, and routes time clicks to Guide', async () => {
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

    fireEvent.click(await findReserveRow('Synthetic reserve one'))

    const dialog = await screen.findByRole('dialog', { name: 'Synthetic reserve one' })
    expect(dialog).toHaveTextContent('Synthetic channel')
    expect(dialog).toHaveTextContent('Synthetic genre')
    expect(dialog).toHaveTextContent('Synthetic reserve description')
    const link = within(dialog).getByRole('link', {
      name: 'https://example.invalid/reserve-info',
    })
    expect(link).toHaveAttribute('href', 'https://example.invalid/reserve-info')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')

    fireEvent.click(within(dialog).getByRole('button', { name: /05\/05\(火\) 10:15/ }))

    await waitFor(() => {
      expectHashRoute('#/guide?time=26050510')
    })
    expect(screen.queryByRole('dialog', { name: 'Synthetic reserve one' })).not.toBeInTheDocument()
  })

  it('[AC 2.9] opens ReserveDialog through keyboard-operable item content and shows API-shape fallbacks', async () => {
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

    const itemButton = await findReserveRow('Synthetic reserve two')
    expect(itemButton).toHaveTextContent('channel 302')

    fireEvent.click(itemButton)

    const dialog = await screen.findByRole('dialog', { name: 'Synthetic reserve two' })
    expect(dialog).toHaveTextContent('channel 302')
    expect(dialog).toHaveTextContent('アニメ・特撮')
  })

  it('[AC 3.4] toggles edit selection from keyboard without opening the dialog', async () => {
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
    const itemButton = getReserveRow('Synthetic reserve one')

    fireEvent.click(itemButton)

    expect(screen.getByTestId('edit-title-bar')).toHaveTextContent('1 件選択')
    expect(screen.queryByRole('dialog', { name: 'Synthetic reserve one' })).not.toBeInTheDocument()
  })

  it('[AC 2.10] lets ReserveDialog add broadcast wave to Guide route only when resolver returns one', async () => {
    window.history.replaceState(null, '', '/#/reserves')
    const reserve = {
      id: 401,
      name: 'Synthetic wave reserve',
      channelId: 777,
      startAt: Date.parse('2026-05-05T10:15:00+09:00'),
      endAt: Date.parse('2026-05-05T10:45:00+09:00'),
    }
    const firstView = render(
      <App
        settings={new DefaultSettingsFactory().create()}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      >
        <ReserveDialog
          open
          reserve={reserve}
          isEnableDisplayForEachBroadcastWave
          resolveBroadcastWave={() => 'BS'}
          onClose={() => undefined}
        />
      </App>,
    )

    fireEvent.click(
      within(await screen.findByRole('dialog', { name: 'Synthetic wave reserve' })).getByRole(
        'button',
        { name: /05\/05\(火\) 10:15/ },
      ),
    )
    await waitFor(() => {
      expectHashRoute('#/guide?time=26050510&type=BS')
    })

    firstView.unmount()
    window.history.replaceState(null, '', '/#/reserves')
    render(
      <App
        settings={new DefaultSettingsFactory().create()}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      >
        <ReserveDialog
          open
          reserve={reserve}
          isEnableDisplayForEachBroadcastWave
          resolveBroadcastWave={() => undefined}
          onClose={() => undefined}
        />
      </App>,
    )

    fireEvent.click(
      within(await screen.findByRole('dialog', { name: 'Synthetic wave reserve' })).getByRole(
        'button',
        { name: /05\/05\(火\) 10:15/ },
      ),
    )
    await waitFor(() => {
      expectHashRoute('#/guide?time=26050510')
    })
  })

  it('[AC 2.10] passes broadcast wave resolver through ReservesPage time clicks', async () => {
    window.history.replaceState(null, '', '/#/reserves')
    const reservesRepository = createReservesRepository()

    render(
      <App
        settings={new DefaultSettingsFactory().create()}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      >
        <ReservesPage
          isNavigationOpen={false}
          onNavigationClick={() => undefined}
          settings={new DefaultSettingsFactory().create()}
          apiRepository={reservesRepository}
          onFetchFailure={() => undefined}
          isEnableDisplayForEachBroadcastWave
          resolveBroadcastWave={() => 'CS'}
        />
      </App>,
    )

    fireEvent.click(await findReserveRow('Synthetic reserve one'))
    fireEvent.click(
      within(await screen.findByRole('dialog', { name: 'Synthetic reserve one' })).getByRole(
        'button',
        { name: /05\/05\(火\) 10:15/ },
      ),
    )

    await waitFor(() => {
      expectHashRoute('#/guide?time=26050510&type=CS')
    })
  })

  it('[AC 2.10] resolves broadcast wave through the real /reserves route wiring without an injected resolver prop', async () => {
    window.history.replaceState(null, '', '/#/reserves')
    const reservesRepository = createReservesRepository()
    vi.mocked(reservesRepository.fetchReserves).mockResolvedValue({
      ok: true,
      value: {
        reserves: [
          {
            id: 201,
            name: 'Synthetic wave route reserve',
            channelId: 501,
            channelType: 'BS',
            channelName: 'Synthetic wave channel',
            startAt: Date.parse('2026-05-05T10:15:00+09:00'),
            endAt: Date.parse('2026-05-05T10:45:00+09:00'),
          },
        ],
        total: 1,
      },
    })

    render(
      <App
        settings={{
          ...new DefaultSettingsFactory().create(),
          isEnableDisplayForEachBroadcastWave: true,
        }}
        apiRepository={createShellRepository()}
        reservesApiRepository={reservesRepository}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    fireEvent.click(await findReserveRow('Synthetic wave route reserve'))
    fireEvent.click(
      within(await screen.findByRole('dialog', { name: 'Synthetic wave route reserve' })).getByRole(
        'button',
        { name: /05\/05\(火\) 10:15/ },
      ),
    )

    await waitFor(() => {
      expectHashRoute('#/guide?time=26050510&type=BS')
    })
  })

  it('[AC 2.10] omits the broadcast wave type when the setting is disabled even though the channel resolves', async () => {
    window.history.replaceState(null, '', '/#/reserves')
    const reservesRepository = createReservesRepository()
    vi.mocked(reservesRepository.fetchReserves).mockResolvedValue({
      ok: true,
      value: {
        reserves: [
          {
            id: 202,
            name: 'Synthetic wave setting off reserve',
            channelId: 502,
            channelType: 'BS',
            channelName: 'Synthetic wave channel',
            startAt: Date.parse('2026-05-05T10:15:00+09:00'),
            endAt: Date.parse('2026-05-05T10:45:00+09:00'),
          },
        ],
        total: 1,
      },
    })

    render(
      <App
        settings={{
          ...new DefaultSettingsFactory().create(),
          isEnableDisplayForEachBroadcastWave: false,
        }}
        apiRepository={createShellRepository()}
        reservesApiRepository={reservesRepository}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    fireEvent.click(await findReserveRow('Synthetic wave setting off reserve'))
    fireEvent.click(
      within(
        await screen.findByRole('dialog', { name: 'Synthetic wave setting off reserve' }),
      ).getByRole('button', { name: /05\/05\(火\) 10:15/ }),
    )

    await waitFor(() => {
      expectHashRoute('#/guide?time=26050510')
    })
  })

  it('[AC 2.10] omits the broadcast wave type when the channel cannot be resolved to a wave', async () => {
    window.history.replaceState(null, '', '/#/reserves')
    const reservesRepository = createReservesRepository()
    vi.mocked(reservesRepository.fetchReserves).mockResolvedValue({
      ok: true,
      value: {
        reserves: [
          {
            id: 203,
            name: 'Synthetic wave unresolved reserve',
            channelId: 503,
            channelName: 'Synthetic wave channel',
            startAt: Date.parse('2026-05-05T10:15:00+09:00'),
            endAt: Date.parse('2026-05-05T10:45:00+09:00'),
          },
        ],
        total: 1,
      },
    })

    render(
      <App
        settings={{
          ...new DefaultSettingsFactory().create(),
          isEnableDisplayForEachBroadcastWave: true,
        }}
        apiRepository={createShellRepository()}
        reservesApiRepository={reservesRepository}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    fireEvent.click(await findReserveRow('Synthetic wave unresolved reserve'))
    fireEvent.click(
      within(
        await screen.findByRole('dialog', { name: 'Synthetic wave unresolved reserve' }),
      ).getByRole('button', { name: /05\/05\(火\) 10:15/ }),
    )

    await waitFor(() => {
      expectHashRoute('#/guide?time=26050510')
    })
  })
})
