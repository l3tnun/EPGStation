import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import type { ServerConfigNavigationState } from '@/app/serverApi'
import type { RecordedApiRepository } from '@/features/recorded/recordedApi'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'
import { changeSettingsSelect, createShellRepository } from '../recorded/recordedSpecHelpers'
import { createRecordedRepository } from '../recorded/recordedSpecRepository'
import {
  createDeferred,
  fillRequiredUploadFields,
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

  it('[AC 2.17] clears length, program name, description, and extended fields through their clear buttons', async () => {
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
    fireEvent.change(screen.getByLabelText('長さ(分)'), { target: { value: '30' } })
    fireEvent.change(uploadProgramNameInput(), { target: { value: 'Synthetic program' } })
    fireEvent.change(screen.getByLabelText('description'), {
      target: { value: 'Synthetic summary' },
    })
    fireEvent.change(screen.getByLabelText('extended'), { target: { value: 'Synthetic extended' } })

    fireEvent.click(screen.getByRole('button', { name: '長さ(分)をクリア' }))
    expect(screen.getByLabelText('長さ(分)')).toHaveValue('')

    fireEvent.click(screen.getByRole('button', { name: 'nameをクリア' }))
    expect(uploadProgramNameInput()).toHaveValue('')

    fireEvent.click(screen.getByRole('button', { name: 'descriptionをクリア' }))
    expect(screen.getByLabelText('description')).toHaveValue('')

    fireEvent.click(screen.getByRole('button', { name: 'extendedをクリア' }))
    expect(screen.getByLabelText('extended')).toHaveValue('')
  })

  it('[AC 2.12] resolves the rule to null when the autocomplete selection is cleared', async () => {
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
    fireEvent.change(screen.getByRole('combobox', { name: 'ルール' }), {
      target: { value: 'Synthetic' },
    })
    await waitFor(() => {
      expect(recordedRepository.fetchRuleKeywords).toHaveBeenCalledWith('Synthetic')
    })
    fireEvent.click(await screen.findByRole('option', { name: 'Synthetic rule' }))
    const ruleCombobox = screen.getByRole('combobox', { name: 'ルール' })
    expect(ruleCombobox).toHaveValue('Synthetic rule')

    fireEvent.focus(ruleCombobox)
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(screen.getByRole('combobox', { name: 'ルール' })).toHaveValue('')

    fireEvent.click(screen.getByRole('button', { name: 'アップロード' }))
    expect(await screen.findByText('入力内容に問題があります。')).toBeVisible()
    expect(recordedRepository.createRecorded).not.toHaveBeenCalled()
  })

  it('[AC 3.1] keeps the persistent uploading dialog open when a close is attempted while uploading', async () => {
    const recordedRepository = createRecordedRepository()
    const metadataResult =
      createDeferred<Awaited<ReturnType<RecordedApiRepository['createRecorded']>>>()
    vi.mocked(recordedRepository.createRecorded).mockReturnValueOnce(metadataResult.promise)

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
    await fillRequiredUploadFields()
    fireEvent.click(screen.getByRole('button', { name: 'アップロード' }))

    const dialog = await screen.findByRole('dialog', { name: 'アップロード中' })
    fireEvent.keyDown(dialog, { key: 'Escape', code: 'Escape' })
    expect(screen.getByRole('dialog', { name: 'アップロード中' })).toBeVisible()

    metadataResult.resolve({ ok: true, value: { recordedId: 902 } })
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'アップロード中' })).not.toBeInTheDocument()
    })
  })

  it('[AC 2.21] [AC 2.24] selects the placeholder file type and directory options and clears the file back to empty', async () => {
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
            recordedDirectories: [],
          } as ServerConfigNavigationState
        }
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    await screen.findByTestId('recorded-upload-page')
    const block = uploadVideoBlock(0)
    expect(block.getByRole('combobox', { name: /directory/ })).toHaveTextContent('​')

    await changeSettingsSelect(/file type/, 'ts', block)
    expect(block.getByRole('combobox', { name: /file type/ })).toHaveTextContent('ts')

    fireEvent.mouseDown(block.getByRole('combobox', { name: /file type/ }))
    const fileTypeListbox = screen.getByRole('listbox')
    const hiddenFileTypeOption = Array.from(
      fileTypeListbox.querySelectorAll<HTMLLIElement>('li'),
    ).find((option) => option.textContent === 'file type')
    fireEvent.click(hiddenFileTypeOption!)
    await waitFor(() => {
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    })
    expect(block.getByRole('combobox', { name: /file type/ })).toHaveTextContent('​')

    const file = new File(['synthetic'], 'synthetic.ts')
    fireEvent.change(block.getByLabelText('video file'), { target: { files: [file] } })
    expect(block.getByText('synthetic.ts')).toBeVisible()

    fireEvent.change(block.getByLabelText('video file'), { target: { files: [] } })
    expect(block.queryByText('synthetic.ts')).not.toBeInTheDocument()
  })
})
