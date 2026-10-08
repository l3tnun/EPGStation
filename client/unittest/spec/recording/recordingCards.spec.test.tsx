import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'
import { expectHashRoute } from '../hashRouteAssertions'
import { createShellRepository, createRecordingRepository } from './recordingTestKit'

function setViewportWidth(width: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
}

describe('Recording card layout', () => {
  const originalWidth = window.innerWidth

  beforeEach(() => {
    localStorage.clear()
    window.history.replaceState(null, '', '/#/recording')
  })

  afterEach(() => {
    setViewportWidth(originalWidth)
    vi.restoreAllMocks()
  })

  it('[AC 1.5] [AC 1.6] [AC 1.20] renders cards at mobile width, marks blank descriptions, and keeps menus out of the row click', async () => {
    setViewportWidth(500)
    const recordingRepository = createRecordingRepository()
    vi.mocked(recordingRepository.fetchRecording).mockResolvedValue({
      ok: true,
      value: {
        total: 3,
        records: [
          {
            id: 101,
            name: 'Card with description',
            channelName: 'Card channel',
            startAt: Date.UTC(2026, 0, 5, 3, 0),
            endAt: Date.UTC(2026, 0, 5, 4, 0),
            description: 'Card description',
          },
          { id: 102, name: 'Card blank description', description: '  \n ' },
          { name: 'Card without id' },
        ],
      },
    })

    render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        recordingApiRepository={recordingRepository}
        osPrefersDark={false}
        viewportWidth={500}
        initialDrawerState="none"
      />,
    )

    const cards = await screen.findByLabelText('録画中一覧カード')
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    const items = screen.getAllByTestId('recording-list-item')
    expect(items).toHaveLength(3)
    expect(cards).toHaveTextContent('Card channel')
    expect(cards).toHaveTextContent('01/05(月) 12:00 ~ 13:00 (60 m)')
    expect(cards).toHaveTextContent('Card description')
    expect(items[1]).toHaveTextContent('dummy')
    expect(items[1]?.querySelector('[class*="cardDummy"]')).not.toBeNull()

    fireEvent.click(items[0]?.querySelector('[class*="cardMenu"]') as HTMLElement)
    expectHashRoute('/recording')
    fireEvent.click(screen.getByRole('button', { name: '録画メニュー: Card with description' }))
    expectHashRoute('/recording')
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })

    fireEvent.click(items[2] as HTMLElement)
    expectHashRoute('/recording')

    fireEvent.click(screen.getByRole('button', { name: '録画中を編集' }))
    expect(screen.queryByRole('button', { name: /録画メニュー:/ })).not.toBeInTheDocument()
    fireEvent.click(items[0] as HTMLElement)
    expect(items[0]).toHaveAttribute('data-selected', 'true')
    expect(items[0]?.className).toMatch(/selectedCard/)
    fireEvent.click(items[0] as HTMLElement)
    expect(items[0]).toHaveAttribute('data-selected', 'false')
    fireEvent.click(items[2] as HTMLElement)
    expect(screen.getByTestId('edit-title-bar')).toHaveTextContent('0 件選択')
  })

  it('[AC 1.29] switches between table and cards on resize', async () => {
    setViewportWidth(1440)
    const recordingRepository = createRecordingRepository()

    render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        recordingApiRepository={recordingRepository}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    await screen.findByTestId('recording-page')
    expect(screen.getByRole('table')).toBeVisible()
    act(() => {
      setViewportWidth(480)
      window.dispatchEvent(new Event('resize'))
    })
    expect(await screen.findByLabelText('録画中一覧カード')).toBeVisible()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    act(() => {
      setViewportWidth(1024)
      window.dispatchEvent(new Event('resize'))
    })
    expect(await screen.findByRole('table')).toBeVisible()
  })

  it('[AC 1.32] renders table rows without an id as non-navigable', async () => {
    setViewportWidth(1440)
    const recordingRepository = createRecordingRepository()
    vi.mocked(recordingRepository.fetchRecording).mockResolvedValue({
      ok: true,
      value: { total: 1, records: [{ name: 'Row without id' }] },
    })

    render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        recordingApiRepository={recordingRepository}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    const row = await screen.findByTestId('recording-list-item')
    fireEvent.click(row)
    expectHashRoute('/recording')
  })
})
