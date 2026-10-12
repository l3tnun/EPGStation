import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'
import { createShellRepository, createReservesRepository } from './reservesTestKit'

describe('Reserves list pagination boundaries', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('[AC 1.12] hides pagination when there are zero reserves', async () => {
    window.history.replaceState(null, '', '/#/reserves')
    const reservesRepository = createReservesRepository()
    vi.mocked(reservesRepository.fetchReserves).mockResolvedValue({
      ok: true,
      value: { reserves: [], total: 0 },
    })
    const settings = { ...new DefaultSettingsFactory().create(), reservesLength: 10 }

    render(
      <App
        settings={settings}
        apiRepository={createShellRepository()}
        reservesApiRepository={reservesRepository}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    const page = await screen.findByTestId('reserves-page')
    expect(page).toHaveAttribute('data-reserves-total', '0')
    expect(screen.queryByRole('navigation', { name: 'ページ' })).not.toBeInTheDocument()
  })

  it('[AC 1.12] hides pagination when the total exactly fills one page', async () => {
    window.history.replaceState(null, '', '/#/reserves')
    const reservesRepository = createReservesRepository()
    vi.mocked(reservesRepository.fetchReserves).mockResolvedValue({
      ok: true,
      value: { reserves: [], total: 10 },
    })
    const settings = { ...new DefaultSettingsFactory().create(), reservesLength: 10 }

    render(
      <App
        settings={settings}
        apiRepository={createShellRepository()}
        reservesApiRepository={reservesRepository}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    const page = await screen.findByTestId('reserves-page')
    expect(page).toHaveAttribute('data-reserves-total', '10')
    expect(screen.queryByRole('navigation', { name: 'ページ' })).not.toBeInTheDocument()
  })

  it('[AC 1.12] shows a second page once the total exceeds one page by a single reserve', async () => {
    window.history.replaceState(null, '', '/#/reserves')
    const reservesRepository = createReservesRepository()
    vi.mocked(reservesRepository.fetchReserves).mockResolvedValue({
      ok: true,
      value: { reserves: [], total: 11 },
    })
    const settings = { ...new DefaultSettingsFactory().create(), reservesLength: 10 }

    render(
      <App
        settings={settings}
        apiRepository={createShellRepository()}
        reservesApiRepository={reservesRepository}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    const page = await screen.findByTestId('reserves-page')
    expect(page).toHaveAttribute('data-reserves-total', '11')
    const nav = await screen.findByRole('navigation', { name: 'ページ' })
    expect(nav).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '2 ページ' })).toBeInTheDocument()
    expect(reservesRepository.fetchReserves).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 10, offset: 0 }),
    )
  })
})
