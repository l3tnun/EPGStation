import { render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'
import { createDashboardRepository, createShellRepository } from './dashboardTestKit'

function renderDashboard(isShowDropInfoInsteadOfDescription: boolean) {
  const dashboardRepository = createDashboardRepository()
  vi.mocked(dashboardRepository.fetchRecording).mockResolvedValue({
    ok: true,
    value: {
      records: [
        {
          id: 31,
          name: 'Synthetic recording with drop log',
          description: 'Synthetic recording description',
          isRecording: true,
          dropLogFile: { id: 310, dropCnt: 4, errorCnt: 0, scramblingCnt: 0 },
          videoFiles: [{ id: 311, size: 4096 }],
        },
      ],
      total: 1,
    },
  })
  vi.mocked(dashboardRepository.fetchRecorded).mockResolvedValue({
    ok: true,
    value: {
      records: [
        {
          id: 32,
          name: 'Synthetic recorded with drops',
          description: 'Synthetic recorded description with drops',
          isRecording: false,
          dropLogFile: { id: 320, dropCnt: 2, errorCnt: 1, scramblingCnt: 0 },
          videoFiles: [
            { id: 321, size: 20202 },
            { id: 322, size: 3 * 1024 * 1024 * 1024 },
          ],
        },
        {
          id: 33,
          name: 'Synthetic recorded without drops',
          description: 'Synthetic recorded description without drops',
          isRecording: false,
          dropLogFile: { id: 330, dropCnt: 0, errorCnt: 0, scramblingCnt: 0 },
        },
        {
          id: 34,
          name: 'Synthetic recorded without drop log',
          description: 'Synthetic recorded description without drop log',
          isRecording: false,
          videoFiles: [{ id: 341, size: 2048 }],
        },
      ],
      total: 3,
    },
  })

  render(
    <App
      settings={{ ...new DefaultSettingsFactory().create(), isShowDropInfoInsteadOfDescription }}
      apiRepository={createShellRepository()}
      dashboardApiRepository={dashboardRepository}
      osPrefersDark={false}
      viewportWidth={1440}
      initialDrawerState="none"
    />,
  )
}

function recordedItem(name: string): HTMLElement {
  const item = screen
    .getAllByTestId('dashboard-recorded-summary-item')
    .find((element) => within(element).queryByRole('button', { name }) !== null)
  expect(item, name).toBeDefined()
  return item as HTMLElement
}

describe('Dashboard recorded summary drop information', () => {
  beforeEach(() => {
    localStorage.clear()
    window.history.replaceState(null, '', '/#/')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('[AC 2.15] [AC frontend-recorded 1.13] shows drop counts with the formatted total file size and the drop warning like the recorded list', async () => {
    renderDashboard(true)
    await screen.findByTestId('dashboard-page')

    const withDrops = within(recordedItem('Synthetic recorded with drops')).getByText('2/1/0 3.0GB')
    expect(withDrops.className).toContain('dropWarning')
    expect(screen.queryByText(/bytes/)).not.toBeInTheDocument()
    expect(screen.queryByText('Synthetic recorded description with drops')).not.toBeInTheDocument()

    const withoutDrops = within(recordedItem('Synthetic recorded without drops')).getByText(
      '0/0/0 0.0B',
    )
    expect(withoutDrops.className).not.toContain('dropWarning')

    expect(
      within(recordedItem('Synthetic recorded without drop log')).getByText(
        'Synthetic recorded description without drop log',
      ),
    ).toBeVisible()
  })

  it('[AC 2.15] keeps the description for recording items even when they carry a drop log', async () => {
    renderDashboard(true)
    await screen.findByTestId('dashboard-page')

    const recording = screen.getByTestId('dashboard-recording-summary-item')
    expect(within(recording).getByText('Synthetic recording description')).toBeVisible()
    expect(within(recording).queryByText(/^4\/0\/0/)).not.toBeInTheDocument()
  })

  it('[AC 2.15] shows descriptions instead of drop information when the setting is off', async () => {
    renderDashboard(false)
    await screen.findByTestId('dashboard-page')

    expect(
      within(recordedItem('Synthetic recorded with drops')).getByText(
        'Synthetic recorded description with drops',
      ),
    ).toBeVisible()
    expect(screen.queryByText(/^2\/1\/0/)).not.toBeInTheDocument()
  })
})
