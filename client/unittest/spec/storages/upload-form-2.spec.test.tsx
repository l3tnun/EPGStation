import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import type { ServerConfigNavigationState } from '@/app/serverApi'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'
import {
  changeSettingsSelect,
  createShellRepository,
  expectMuiSelectBlank,
  expectMuiSelectText,
} from '../recorded/recordedSpecHelpers'
import { createRecordedRepository } from '../recorded/recordedSpecRepository'
import {
  createDeferred,
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
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('[AC 2.17] clears upload channel, genre, and sub genre select values through visible clear buttons', async () => {
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

    await changeSettingsSelect(/放送局※?/, 'Synthetic half channel')
    expectMuiSelectText(/放送局※?/, 'Synthetic half channel')
    fireEvent.click(screen.getByRole('button', { name: '放送局※をクリア' }))
    expectMuiSelectBlank(/放送局※?/)

    await changeSettingsSelect('genre', 'Synthetic genre')
    await changeSettingsSelect('sub genre', 'トークバラエティ')
    expectMuiSelectText('genre', 'Synthetic genre')
    expectMuiSelectText('sub genre', 'トークバラエティ')
    fireEvent.click(screen.getByRole('button', { name: 'sub genreをクリア' }))
    expectMuiSelectText('genre', 'Synthetic genre')
    expectMuiSelectBlank('sub genre')

    await changeSettingsSelect('sub genre', 'トークバラエティ')
    fireEvent.click(screen.getByRole('button', { name: 'genreをクリア' }))
    expectMuiSelectBlank('genre')
    expectMuiSelectBlank('sub genre')
  })

  it('[AC frontend-recorded 3.34] keeps Add Encode dialog AppSelect fields at the legacy compact height', () => {
    const addEncodeDialogSource = readFileSync(
      'src/features/recorded/components/AddEncodeDialog.tsx',
      'utf8',
    )

    expect(addEncodeDialogSource).toContain('ariaLabel="source"')
    expect(addEncodeDialogSource).toContain('ariaLabel="preset"')
    expect(addEncodeDialogSource).toContain('ariaLabel="recorded"')
    expect(addEncodeDialogSource.match(/controlHeight=\{32\}/gu)).toHaveLength(3)
  })

  it('[AC 2.7] [AC 2.15] resets to the route-init state and remounts datetime picker without refetching rules', async () => {
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
        viewportWidth={390}
        initialDrawerState="none"
      />,
    )

    await screen.findByTestId('recorded-upload-page')
    fireEvent.change(uploadProgramNameInput(), { target: { value: 'Synthetic input' } })
    fireEvent.change(screen.getByLabelText('開始'), { target: { value: '2026-05-05T12:30' } })
    fireEvent.change(uploadVideoBlock(0).getByLabelText('video file'), {
      target: { files: [new File(['synthetic'], 'synthetic-upload.ts')] },
    })
    expect(screen.getByText('synthetic-upload.ts')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: '動画ファイルを追加' }))
    expect(screen.getByTestId('recorded-upload-page')).toHaveAttribute(
      'data-video-block-count',
      '2',
    )

    fireEvent.click(screen.getByRole('button', { name: 'リセット' }))

    const page = screen.getByTestId('recorded-upload-page')
    expect(page).toHaveAttribute('data-video-block-count', '1')
    expect(page).toHaveAttribute('data-datetime-picker-generation', '1')
    expect(uploadProgramNameInput()).toHaveValue('')
    expect(screen.getByLabelText('開始')).toHaveValue('')
    expect(screen.queryByText('synthetic-upload.ts')).not.toBeInTheDocument()
    expect(recordedRepository.fetchRuleKeywords).toHaveBeenCalledTimes(1)
  })

  it('[AC 2.23] keeps the latest rule autocomplete response when earlier input resolves late', async () => {
    const recordedRepository = createRecordedRepository()
    const staleResult =
      createDeferred<Awaited<ReturnType<typeof recordedRepository.fetchRuleKeywords>>>()
    vi.mocked(recordedRepository.fetchRuleKeywords)
      .mockResolvedValueOnce({
        ok: true,
        value: [{ id: 1, keyword: 'Initial rule' }],
      })
      .mockReturnValueOnce(staleResult.promise)
      .mockResolvedValueOnce({
        ok: true,
        value: [{ id: 3, keyword: 'Latest rule' }],
      })

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
      target: { value: 'stale' },
    })
    fireEvent.change(screen.getByRole('combobox', { name: 'ルール' }), {
      target: { value: 'latest' },
    })
    await waitFor(() => {
      expect(recordedRepository.fetchRuleKeywords).toHaveBeenCalledWith('latest')
    })
    staleResult.resolve({
      ok: true,
      value: [{ id: 2, keyword: 'Stale rule' }],
    })

    fireEvent.focus(screen.getByRole('combobox', { name: 'ルール' }))
    expect(await screen.findByRole('option', { name: 'Latest rule' })).toBeVisible()
    expect(screen.queryByRole('option', { name: 'Stale rule' })).not.toBeInTheDocument()
  })

  it('[AC 2.5] keeps input-driven rule fetch failures out of the snackbar', async () => {
    const recordedRepository = createRecordedRepository()
    vi.mocked(recordedRepository.fetchRuleKeywords)
      .mockResolvedValueOnce({ ok: true, value: [{ id: 1, keyword: 'Route rule' }] })
      .mockResolvedValueOnce({
        ok: false,
        error: 'rule-keywords-failed',
        message: 'ルール情報取得に失敗',
      })

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
      target: { value: 'typed' },
    })
    await waitFor(() => {
      expect(recordedRepository.fetchRuleKeywords).toHaveBeenCalledWith('typed')
    })

    // v2 の `RecordedUpload.vue` は入力駆動の `updateRuleItems()` を catch せず、失敗は未処理
    // rejection になるため snackbar は出ない。route 初期化時の取得失敗だけが通知される。
    await act(async () => {
      await Promise.resolve()
    })
    expect(screen.queryByText('ルール情報取得に失敗')).not.toBeInTheDocument()
  })

  it('[AC 2.5] [AC 2.6] shows snackbar for route rule fetch failure only and validates required fields without upload requests', async () => {
    const recordedRepository = createRecordedRepository()
    vi.mocked(recordedRepository.fetchRuleKeywords)
      .mockResolvedValueOnce({
        ok: false,
        error: 'rule-keywords-failed',
        message: 'ルール情報取得に失敗',
      })
      .mockResolvedValueOnce({
        ok: false,
        error: 'rule-keywords-failed',
        message: 'ルール情報取得に失敗',
      })

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

    vi.useFakeTimers()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.getByText('ルール情報取得に失敗')).toBeVisible()
    vi.useRealTimers()

    fireEvent.change(screen.getByRole('combobox', { name: 'ルール' }), {
      target: { value: 'typed' },
    })
    await waitFor(() => {
      expect(recordedRepository.fetchRuleKeywords).toHaveBeenCalledWith('typed')
    })
    expect(screen.getAllByText('ルール情報取得に失敗')).toHaveLength(1)

    vi.useFakeTimers()
    fireEvent.click(screen.getByRole('button', { name: 'アップロード' }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.getByText('入力内容に問題があります。')).toBeVisible()
    vi.useRealTimers()
    expect(recordedRepository.deleteRecorded).not.toHaveBeenCalled()
  })

  it('keeps the add-video FAB at the Vuetify fixed-button default offset instead of a raised custom offset', () => {
    // Source: vuetify (a v2 dependency) dist/vuetify.css —
    // .v-btn--fixed.v-btn--bottom{bottom:16px} / .v-btn--fixed.v-btn--right{right:16px}
    // v2's <v-btn fixed bottom fab right> (RecordedUpload.vue:7) relies on these Vuetify
    // defaults; it does not raise the button above the viewport bottom edge.
    const css = readFileSync('src/features/storages/upload/RecordedUploadPage.module.css', 'utf8')

    expect(css).toMatch(/\.fabRow\s*\{[^}]*bottom: 16px;/)
    expect(css).not.toMatch(/\.fabRow\s*\{[^}]*bottom: 72px;/)
  })
})
