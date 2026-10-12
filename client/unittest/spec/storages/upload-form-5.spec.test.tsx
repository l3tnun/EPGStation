import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import type { ServerConfigNavigationState } from '@/app/serverApi'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'
import { changeSettingsSelect, createShellRepository } from '../recorded/recordedSpecHelpers'
import { createRecordedRepository } from '../recorded/recordedSpecRepository'
import { fixCurrentDate, pickCalendarDay } from '../shared/dateTimePickerTestKit'
import { uploadVideoBlock, warmUpRecordedUploadAppRender } from './recordedUploadSpecSupport'

describe('Recorded upload route and form state', () => {
  beforeAll(async () => {
    await warmUpRecordedUploadAppRender()
  })

  beforeEach(() => {
    localStorage.clear()
    window.history.replaceState(null, '', '/#/recorded/upload')
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('[AC 2.17] clears the video block sub directory and changes the directory selection', async () => {
    const recordedRepository = createRecordedRepository()

    render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        recordedApiRepository={recordedRepository}
        navigationConfig={
          {
            status: 'loaded',
            liveStreamEnabled: false,
            enabledBroadcastWaves: [],
            recordedDirectories: ['archive-root', 'backup-root'],
          } as ServerConfigNavigationState
        }
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    await screen.findByTestId('recorded-upload-page')
    const block = uploadVideoBlock(0)
    expect(block.getByRole('combobox', { name: /directory/ })).toHaveTextContent('archive-root')

    await changeSettingsSelect(/directory/, 'backup-root', block)
    expect(block.getByRole('combobox', { name: /directory/ })).toHaveTextContent('backup-root')

    fireEvent.change(block.getByLabelText('sub directory'), { target: { value: 'season-two' } })
    expect(block.getByLabelText('sub directory')).toHaveValue('season-two')
    fireEvent.click(block.getByRole('button', { name: 'sub directoryをクリア' }))
    expect(block.getByLabelText('sub directory')).toHaveValue('')

    fireEvent.change(block.getByLabelText('name'), { target: { value: 'Synthetic upload' } })
    expect(block.getByLabelText('name')).toHaveValue('Synthetic upload')
    fireEvent.click(block.getByRole('button', { name: 'nameをクリア' }))
    expect(block.getByLabelText('name')).toHaveValue('')
  })

  it('[AC 2.14] clears the start field directly and opens the dialog from the current value', async () => {
    const recordedRepository = createRecordedRepository()

    render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        recordedApiRepository={recordedRepository}
        navigationConfig={
          {
            status: 'loaded',
            liveStreamEnabled: false,
            enabledBroadcastWaves: [],
            recordedDirectories: ['archive-root'],
          } as ServerConfigNavigationState
        }
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    await screen.findByTestId('recorded-upload-page')
    fireEvent.change(screen.getByLabelText('開始'), { target: { value: '2026-05-05T12:30' } })
    expect(screen.getByLabelText('開始')).toHaveValue('2026-05-05T12:30')

    fireEvent.click(screen.getByRole('button', { name: '開始をクリア' }))
    expect(screen.getByLabelText('開始')).toHaveValue('')

    fireEvent.change(screen.getByLabelText('開始'), {
      target: { value: '2026-06-15T09:00' },
    })
    fireEvent.click(screen.getByLabelText('日付※'))
    const dateDialog = await screen.findByRole('dialog', { name: '日付選択' })
    expect(within(dateDialog).getByRole('gridcell', { name: '15' })).toHaveAttribute(
      'aria-selected',
      'true',
    )

    fireEvent.click(within(dateDialog).getByRole('button', { name: 'クリア' }))
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: '日付選択' })).not.toBeInTheDocument()
    })
    expect(screen.getByLabelText('開始')).toHaveValue('')
  })

  it('[AC 2.14] picks a day in the calendar and commits it as the start value', async () => {
    fixCurrentDate('2026-07-01T12:00:00+09:00')
    const recordedRepository = createRecordedRepository()

    render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        recordedApiRepository={recordedRepository}
        navigationConfig={
          {
            status: 'loaded',
            liveStreamEnabled: false,
            enabledBroadcastWaves: [],
            recordedDirectories: ['archive-root'],
          } as ServerConfigNavigationState
        }
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    await screen.findByTestId('recorded-upload-page')
    fireEvent.click(screen.getByLabelText('日付※'))
    const dateDialog = await screen.findByRole('dialog', { name: '日付選択' })

    pickCalendarDay(dateDialog, 20)
    fireEvent.click(within(dateDialog).getByRole('button', { name: 'クリア' }))
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: '日付選択' })).not.toBeInTheDocument()
    })
    expect(screen.getByLabelText('開始')).toHaveValue('')

    fireEvent.click(screen.getByLabelText('日付※'))
    const reopenedDialog = await screen.findByRole('dialog', { name: '日付選択' })
    expect(within(reopenedDialog).queryByRole('gridcell', { selected: true })).toBeNull()
    pickCalendarDay(reopenedDialog, 20)
    fireEvent.click(within(reopenedDialog).getByRole('button', { name: '設定' }))
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: '日付選択' })).not.toBeInTheDocument()
    })
    expect(screen.getByLabelText('開始')).toHaveValue('2026-07-20T00:00')
  })

  it('[AC 2.14] closes the date dialog without committing when dismissed via escape', async () => {
    const recordedRepository = createRecordedRepository()

    render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        recordedApiRepository={recordedRepository}
        navigationConfig={
          {
            status: 'loaded',
            liveStreamEnabled: false,
            enabledBroadcastWaves: [],
            recordedDirectories: ['archive-root'],
          } as ServerConfigNavigationState
        }
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    await screen.findByTestId('recorded-upload-page')
    fireEvent.change(screen.getByLabelText('開始'), { target: { value: '2026-05-05T12:30' } })
    fireEvent.click(screen.getByLabelText('日付※'))
    const dateDialog = await screen.findByRole('dialog', { name: '日付選択' })

    pickCalendarDay(dateDialog, 9)
    fireEvent.keyDown(dateDialog, { key: 'Escape', code: 'Escape' })
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: '日付選択' })).not.toBeInTheDocument()
    })
    expect(screen.getByLabelText('開始')).toHaveValue('2026-05-05T12:30')
  })
})
