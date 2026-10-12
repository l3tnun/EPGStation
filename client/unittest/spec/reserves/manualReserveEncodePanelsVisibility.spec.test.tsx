import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'
import {
  createReservesRepository,
  createManualOptionsFetch,
  createShellRepository,
} from './reservesTestKit'

describe('Manual Reserve encode panel visibility', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('[AC 4.30] hides エンコード1/2/3 and ファイル削除 panels when the server has no encode modes', async () => {
    vi.stubGlobal('fetch', createManualOptionsFetch({ encode: [] }))
    window.history.replaceState(null, '', '/#/reserves/manual')

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

    await screen.findByTestId('manual-reserve-page')

    expect(screen.queryByRole('button', { name: 'エンコード1' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'エンコード2' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'エンコード3' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'ファイル削除' })).not.toBeInTheDocument()
  })

  it('[AC 4.30] shows エンコード1/2/3 and ファイル削除 panels when the server has encode modes', async () => {
    vi.stubGlobal('fetch', createManualOptionsFetch({ encode: ['synthetic-encode'] }))
    window.history.replaceState(null, '', '/#/reserves/manual')

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

    await screen.findByTestId('manual-reserve-page')

    expect(await screen.findByRole('button', { name: 'エンコード1' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'エンコード2' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'エンコード3' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'ファイル削除' })).toBeInTheDocument()
  })
})
