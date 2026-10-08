import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import type { ServerConfigNavigationState } from '@/app/serverApi'
import type { RecordedApiRepository } from '@/features/recorded/recordedApi'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'
import { createShellRepository } from '../recorded/recordedSpecHelpers'
import { createRecordedRepository } from '../recorded/recordedSpecRepository'
import {
  createDeferred,
  uploadVideoBlock,
  warmUpRecordedUploadAppRender,
} from './recordedUploadSpecSupport'

function renderUploadPage(recordedRepository: RecordedApiRepository) {
  return render(
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
}

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

  it('[AC 2.17] clears a video block name field through its own clear button', async () => {
    const recordedRepository = createRecordedRepository()
    renderUploadPage(recordedRepository)

    await screen.findByTestId('recorded-upload-page')
    const block = uploadVideoBlock(0)
    fireEvent.change(block.getByLabelText('name'), { target: { value: 'Main upload' } })
    expect(block.getByLabelText('name')).toHaveValue('Main upload')

    fireEvent.click(block.getByRole('button', { name: 'nameをクリア' }))
    expect(block.getByLabelText('name')).toHaveValue('')
  })

  it('[AC 2.25] updates only the targeted video block and leaves the others unchanged', async () => {
    const recordedRepository = createRecordedRepository()
    renderUploadPage(recordedRepository)

    await screen.findByTestId('recorded-upload-page')
    fireEvent.click(screen.getByRole('button', { name: '動画ファイルを追加' }))
    fireEvent.change(uploadVideoBlock(1).getByLabelText('name'), {
      target: { value: 'Second block name' },
    })

    fireEvent.change(uploadVideoBlock(0).getByLabelText('name'), {
      target: { value: 'First block name' },
    })

    expect(uploadVideoBlock(0).getByLabelText('name')).toHaveValue('First block name')
    expect(uploadVideoBlock(1).getByLabelText('name')).toHaveValue('Second block name')
  })

  it('[AC 2.26] leaves channel and genre selects empty when the route options fetch fails', async () => {
    const recordedRepository = createRecordedRepository()
    vi.mocked(recordedRepository.fetchRecordedOptions).mockResolvedValueOnce({
      ok: false,
      error: 'recorded-options-failed',
      message: 'options failed',
    })
    renderUploadPage(recordedRepository)

    await screen.findByTestId('recorded-upload-page')
    fireEvent.mouseDown(screen.getByRole('combobox', { name: /放送局※?/ }))
    expect(screen.queryByRole('option')).not.toBeInTheDocument()
  })

  it('[AC 2.27] does not apply the route options fetch after the page unmounts before it resolves', async () => {
    const recordedRepository = createRecordedRepository()
    const optionsDeferred =
      createDeferred<Awaited<ReturnType<RecordedApiRepository['fetchRecordedOptions']>>>()
    vi.mocked(recordedRepository.fetchRecordedOptions).mockReturnValueOnce(optionsDeferred.promise)

    const { unmount } = renderUploadPage(recordedRepository)
    await screen.findByTestId('recorded-upload-page')
    unmount()

    optionsDeferred.resolve({
      ok: true,
      value: { channels: [{ id: 1, name: 'Late channel' }], genres: [] },
    })
    await Promise.resolve()
    await Promise.resolve()
  })

  it('[AC 2.27] does not apply the route rule fetch after the page unmounts before it resolves', async () => {
    const recordedRepository = createRecordedRepository()
    const rulesDeferred =
      createDeferred<Awaited<ReturnType<RecordedApiRepository['fetchRuleKeywords']>>>()
    vi.mocked(recordedRepository.fetchRuleKeywords).mockReturnValueOnce(rulesDeferred.promise)

    const { unmount } = renderUploadPage(recordedRepository)
    await screen.findByTestId('recorded-upload-page')
    unmount()

    rulesDeferred.resolve({ ok: true, value: [{ id: 77, keyword: 'Late rule' }] })
    await Promise.resolve()
    await Promise.resolve()
  })

  it('[AC 2.12] skips applying the stale route rule fetch once the user has already typed a keyword', async () => {
    const recordedRepository = createRecordedRepository()
    const initialRulesDeferred =
      createDeferred<Awaited<ReturnType<RecordedApiRepository['fetchRuleKeywords']>>>()
    vi.mocked(recordedRepository.fetchRuleKeywords).mockReturnValueOnce(
      initialRulesDeferred.promise,
    )

    renderUploadPage(recordedRepository)
    await screen.findByTestId('recorded-upload-page')

    const ruleCombobox = screen.getByRole('combobox', { name: 'ルール' })
    fireEvent.change(ruleCombobox, { target: { value: 'Synthetic' } })
    await waitFor(() => {
      expect(recordedRepository.fetchRuleKeywords).toHaveBeenCalledWith('Synthetic')
    })

    initialRulesDeferred.resolve({
      ok: true,
      value: [{ id: 999, keyword: 'Stale route rule' }],
    })

    fireEvent.focus(ruleCombobox)
    expect(await screen.findByRole('option', { name: 'Synthetic rule' })).toBeVisible()
    expect(screen.queryByRole('option', { name: 'Stale route rule' })).not.toBeInTheDocument()
  })
})
