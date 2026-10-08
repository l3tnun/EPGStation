import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'
import { expectHashRoute } from '../hashRouteAssertions'
import { createPlaybackNavigationConfig, createShellRepository } from './recordedSpecHelpers'
import { createRecordedRepository } from './recordedSpecRepository'

describe('Recorded list actions', () => {
  beforeEach(() => {
    localStorage.clear()
    window.history.replaceState(null, '', '/#/recorded')
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('[AC 2.14] navigates item menu rule and recorded search actions', async () => {
    const recordedRepository = createRecordedRepository()
    vi.mocked(recordedRepository.fetchRecorded).mockResolvedValue({
      ok: true,
      value: {
        records: [
          {
            id: 101,
            name: '[Synthetic] Program title #01',
            ruleId: 55,
            isProtected: false,
            isRecording: false,
            videoFiles: [{ id: 201, name: 'synthetic-video-one', size: 1024 }],
          },
        ],
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

    await screen.findByRole('heading', { name: '[Synthetic] Program title #01' })
    fireEvent.click(
      screen.getByRole('button', { name: '録画メニュー: [Synthetic] Program title #01' }),
    )
    fireEvent.click(screen.getByRole('menuitem', { name: 'rule' }))
    await waitFor(() => {
      expectHashRoute('#/search?rule=55')
    })

    expectHashRoute('#/search?rule=55')
  })

  it('[AC 2.36] keeps list item playback out of the recorded item menu', async () => {
    const recordedRepository = createRecordedRepository()
    vi.mocked(recordedRepository.fetchRecorded).mockResolvedValue({
      ok: true,
      value: {
        records: [
          {
            id: 101,
            name: 'Synthetic list playback target',
            isProtected: false,
            isRecording: false,
            videoFiles: [{ id: 202, name: 'synthetic-encoded', type: 'encoded', size: 1024 }],
          },
        ],
        total: 1,
      },
    })

    render(
      <App
        settings={{
          ...new DefaultSettingsFactory().create(),
          isPreferredPlayingOnWeb: true,
        }}
        apiRepository={createShellRepository()}
        recordedApiRepository={recordedRepository}
        navigationConfig={createPlaybackNavigationConfig()}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    await screen.findByRole('heading', { name: 'Synthetic list playback target' })
    fireEvent.click(
      screen.getByRole('button', { name: '録画メニュー: Synthetic list playback target' }),
    )
    expect(
      screen.queryByRole('menuitem', { name: 'play synthetic-encoded' }),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'search' })).toBeVisible()
  })

  it('[AC 2.15] navigates item menu recorded search by rule id', async () => {
    const recordedRepository = createRecordedRepository()
    vi.mocked(recordedRepository.fetchRecorded).mockResolvedValue({
      ok: true,
      value: {
        records: [
          {
            id: 101,
            name: '[Synthetic] Program title #01',
            ruleId: 55,
            isProtected: false,
            isRecording: false,
            videoFiles: [{ id: 201, name: 'synthetic-video-one', size: 1024 }],
          },
        ],
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

    await screen.findByRole('heading', { name: '[Synthetic] Program title #01' })
    fireEvent.click(
      screen.getByRole('button', { name: '録画メニュー: [Synthetic] Program title #01' }),
    )
    fireEvent.click(screen.getByRole('menuitem', { name: 'search' }))
    await waitFor(() => {
      expectHashRoute('#/recorded?ruleId=55')
    })
  })

  it('[AC 2.15] navigates item menu recorded search by keyword fallback', async () => {
    const recordedRepository = createRecordedRepository()
    vi.mocked(recordedRepository.fetchRecorded).mockResolvedValue({
      ok: true,
      value: {
        records: [
          {
            id: 101,
            name: '[Synthetic] Program title #01',
            isProtected: false,
            isRecording: false,
            videoFiles: [{ id: 201, name: 'synthetic-video-one', size: 1024 }],
          },
        ],
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

    await screen.findByRole('heading', { name: '[Synthetic] Program title #01' })
    fireEvent.click(
      screen.getByRole('button', { name: '録画メニュー: [Synthetic] Program title #01' }),
    )
    fireEvent.click(screen.getByRole('menuitem', { name: 'search' }))
    await waitFor(() => {
      expectHashRoute('#/recorded?keyword=Program+title')
    })
  })
})
