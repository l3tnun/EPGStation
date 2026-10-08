import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import type { ServerConfigNavigationState } from '@/app/serverApi'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'
import {
  createShellRepository,
  expectMuiSelectBlank,
  expectMuiSelectOption,
  expectMuiSelectText,
  selectNameMatcher,
} from '../recorded/recordedSpecHelpers'
import { createRecordedRepository } from '../recorded/recordedSpecRepository'
import {
  uploadProgramNameInput,
  uploadVideoBlock,
  warmUpRecordedUploadAppRender,
} from './recordedUploadSpecSupport'

describe('Recorded upload route and form state', () => {
  beforeAll(async () => {
    await warmUpRecordedUploadAppRender()
  })

  beforeEach(() => {
    localStorage.clear()
    window.history.replaceState(null, '', '/#/recorded/upload')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('[AC 2.1] [AC 2.2] [AC 2.3] [AC 2.4] [AC 2.8] [AC 2.9] [AC 2.10] [AC 2.12] [AC 2.13] [AC 2.14] [AC 2.20] initializes the upload form with title, settings-aware selectors, rule fetch, and one default video block', async () => {
    const recordedRepository = createRecordedRepository()

    render(
      <App
        settings={{
          ...new DefaultSettingsFactory().create(),
          isHalfWidthDisplayed: false,
        }}
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

    expect(screen.getByTestId('title-bar')).toHaveTextContent('アップロード')
    const page = await screen.findByTestId('recorded-upload-page')
    expect(page).toHaveAttribute('data-video-block-count', '1')
    expect(page).toHaveAttribute('data-datetime-picker-generation', '0')
    expect(screen.getByRole('combobox', { name: /放送局※?/ })).toHaveAttribute(
      'data-is-half-width',
      'false',
    )
    expect(screen.getByLabelText('genre')).toBeVisible()
    expect(screen.getByLabelText('sub genre')).toBeVisible()
    expect(screen.getByRole('combobox', { name: 'ルール' })).toBeVisible()
    expect(screen.getByLabelText('開始')).toBeVisible()
    expect(screen.getByLabelText('長さ(分)')).toBeVisible()
    expect(uploadProgramNameInput()).toBeVisible()
    expect(screen.getByLabelText('description')).toBeVisible()
    expect(screen.getByLabelText('extended')).toBeVisible()
    const datetimePicker = screen.getByTestId('recorded-upload-datetime-picker')
    expect(within(datetimePicker).queryByRole('button', { name: 'クリア' })).not.toBeInTheDocument()
    expect(within(datetimePicker).queryByRole('button', { name: '設定' })).not.toBeInTheDocument()
    expect(datetimePicker).toHaveAttribute('data-locale', 'ja-JP')
    expect(datetimePicker).toHaveAttribute('data-week-start', '1')
    fireEvent.click(screen.getByLabelText('日付※'))
    const dateDialog = await screen.findByRole('dialog', { name: '日付選択' })
    expect(within(dateDialog).getByLabelText('日付')).toHaveAttribute('type', 'date')
    expect(within(dateDialog).getByLabelText('時刻')).toHaveAttribute('type', 'time')
    expect(within(dateDialog).getByText('日付', { selector: 'label' })).toHaveClass(
      'MuiInputLabel-shrink',
    )
    expect(within(dateDialog).getByText('時刻', { selector: 'label' })).toHaveClass(
      'MuiInputLabel-shrink',
    )
    expect(within(dateDialog).getByRole('button', { name: 'クリア' })).toBeVisible()
    expect(within(dateDialog).getByRole('button', { name: '設定' })).toBeVisible()
    fireEvent.click(within(dateDialog).getByRole('button', { name: '設定' }))
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: '日付選択' })).not.toBeInTheDocument()
    })

    expect(recordedRepository.fetchRecordedOptions).toHaveBeenCalledTimes(1)
    expect(recordedRepository.fetchRuleKeywords).toHaveBeenCalledWith()
    fireEvent.change(screen.getByRole('combobox', { name: 'ルール' }), {
      target: { value: 'Synthetic' },
    })
    await waitFor(() => {
      expect(recordedRepository.fetchRuleKeywords).toHaveBeenCalledWith('Synthetic')
    })
    expect(await screen.findByRole('option', { name: 'Synthetic rule' })).toBeVisible()
    expect(screen.getByTestId('recorded-upload-video-block-0')).toHaveAttribute(
      'data-video-block-index',
      '0',
    )
    expectMuiSelectText(/directory/, 'archive-root', uploadVideoBlock(0))
    expect(uploadVideoBlock(0).getByLabelText('sub directory')).toHaveValue('')
    expect(uploadVideoBlock(0).getByLabelText('name')).toHaveValue('')
    expectMuiSelectBlank(/file type/, uploadVideoBlock(0))
    expect(uploadVideoBlock(0).getByLabelText('video file')).toHaveValue('')
    expect(screen.queryByRole('button', { name: /削除/ })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '動画ファイルを追加' }))
    expect(screen.getByTestId('recorded-upload-page')).toHaveAttribute(
      'data-video-block-count',
      '2',
    )
    expectMuiSelectText(/directory/, 'archive-root', uploadVideoBlock(1))
    expect(uploadVideoBlock(1).getByLabelText('sub directory')).toHaveValue('')
    expect(uploadVideoBlock(1).getByLabelText('name')).toHaveValue('')
    expectMuiSelectBlank(/file type/, uploadVideoBlock(1))
    expect(uploadVideoBlock(1).getByLabelText('video file')).toHaveValue('')
  })

  it('[AC 2.3] [AC 2.13] uses half-width channel display names and stores selected rule ids from keyword options', async () => {
    const recordedRepository = createRecordedRepository()

    render(
      <App
        settings={{
          ...new DefaultSettingsFactory().create(),
          isHalfWidthDisplayed: true,
        }}
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
    await expectMuiSelectOption(/放送局※?/, 'Synthetic half channel')

    fireEvent.change(screen.getByRole('combobox', { name: 'ルール' }), {
      target: { value: 'Synthetic' },
    })
    await waitFor(() => {
      expect(recordedRepository.fetchRuleKeywords).toHaveBeenCalledWith('Synthetic')
    })
    fireEvent.click(await screen.findByRole('option', { name: 'Synthetic rule' }))
    expect(screen.getByRole('combobox', { name: 'ルール' })).toHaveValue('Synthetic rule')
    expect(screen.getByTestId('recorded-upload-page')).toHaveAttribute(
      'data-selected-rule-id',
      '12',
    )
  })

  it('[AC 2.3] keeps upload select placeholder labels out of visible channel and genre option lists', async () => {
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

    fireEvent.mouseDown(screen.getByRole('combobox', { name: /放送局※?/ }))
    expect(screen.queryByRole('option', { name: 'channel' })).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /^\d+$/u })).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /\(\d+\)$/u })).not.toBeInTheDocument()
    expect(await screen.findByRole('option', { name: /Synthetic .*channel/u })).toBeVisible()
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' })
    await waitFor(() => {
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    })

    fireEvent.mouseDown(screen.getByRole('combobox', { name: selectNameMatcher('genre') }))
    expect(screen.queryByRole('option', { name: 'genre' })).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /\(\d+\)$/u })).not.toBeInTheDocument()
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' })
    await waitFor(() => {
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    })

    fireEvent.mouseDown(screen.getByRole('combobox', { name: selectNameMatcher('sub genre') }))
    expect(screen.queryByRole('option', { name: 'sub genre' })).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /\(\d+\)$/u })).not.toBeInTheDocument()
  })

  it('[AC 2.3] uses original upload option labels without recorded-search counts', async () => {
    const recordedRepository = createRecordedRepository()
    vi.mocked(recordedRepository.fetchRecordedOptions).mockResolvedValue({
      ok: true,
      value: {
        channels: [
          { id: 34, name: 'Synthetic channel(2)', halfWidthName: 'Synthetic half channel(2)' },
          { id: 99, name: '99' },
        ],
        genres: [{ id: 5, name: 'Synthetic genre(3)' }],
      },
    })

    render(
      <App
        settings={{
          ...new DefaultSettingsFactory().create(),
          isHalfWidthDisplayed: true,
        }}
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

    fireEvent.mouseDown(screen.getByRole('combobox', { name: /放送局※?/ }))
    expect(await screen.findByRole('option', { name: 'Synthetic half channel' })).toBeVisible()
    expect(
      screen.queryByRole('option', { name: 'Synthetic half channel(2)' }),
    ).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: '99' })).not.toBeInTheDocument()
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' })
    await waitFor(() => {
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    })

    fireEvent.mouseDown(screen.getByRole('combobox', { name: selectNameMatcher('genre') }))
    expect(await screen.findByRole('option', { name: 'Synthetic genre' })).toBeVisible()
    expect(screen.queryByRole('option', { name: 'Synthetic genre(3)' })).not.toBeInTheDocument()
  })
})
