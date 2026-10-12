import { readFileSync } from 'node:fs'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AddEncodeDialog } from '@/features/recorded/components/AddEncodeDialog'
import { RecordedStreamSelectDialog } from '@/features/recorded/components/RecordedStreamSelectDialog'
import { SendVideoFileToKodiDialog } from '@/features/recorded/components/SendVideoFileToKodiDialog'
import { changeSettingsSelect, createPlaybackNavigationConfig } from './recordedSpecHelpers'
import { createRecordedRepository } from './recordedSpecRepository'

beforeEach(() => {
  localStorage.clear()
})

describe('AddEncodeDialog', () => {
  it('[AC 3.17] [AC 3.31] restores a stored preset when the server offers no encode modes', async () => {
    localStorage.setItem(
      'AddEncodeSeting',
      JSON.stringify({
        encodeMode: 'stored',
        parentDirectory: 'd1',
        isSaveSameDirectory: false,
        removeOriginal: true,
      }),
    )
    const apiRepository = createRecordedRepository()
    const onSnackbar = vi.fn()
    render(
      <AddEncodeDialog
        item={{ id: 3, videoFiles: [{ id: 1, name: 'a' }, { name: 'no id' }] }}
        open
        encodeModes={[]}
        recordedDirectories={['d1', 'd2']}
        apiRepository={apiRepository}
        onClose={vi.fn()}
        onSnackbar={onSnackbar}
      />,
    )

    expect(screen.getByRole('combobox', { name: 'preset' })).toHaveTextContent('stored')
    expect(screen.getByRole('checkbox', { name: '元ファイルを削除する' })).toBeChecked()
    fireEvent.change(screen.getByRole('textbox', { name: 'sub directory' }), {
      target: { value: 'sub' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'sub directoryをクリア' }))
    expect(screen.getByRole('textbox', { name: 'sub directory' })).toHaveValue('')
    fireEvent.click(screen.getByRole('checkbox', { name: '元ファイルを削除する' }))
    fireEvent.click(screen.getByRole('button', { name: '追加' }))

    await waitFor(() => {
      expect(onSnackbar).toHaveBeenCalledWith({ text: 'エンコード追加', severity: 'success' })
    })
    expect(apiRepository.addEncode).toHaveBeenCalledWith({
      recordedId: 3,
      sourceVideoFileId: 1,
      mode: 'stored',
      removeOriginal: false,
      isSaveSameDirectory: false,
      parentDir: 'd1',
    })
  })

  it('[AC 3.19] fails closed without a preset and reports API failures', async () => {
    const apiRepository = createRecordedRepository()
    vi.mocked(apiRepository.addEncode).mockResolvedValue({
      ok: false,
      error: 'add-encode-failed',
      message: 'failed',
    })
    const onSnackbar = vi.fn()
    const noPreset = render(
      <AddEncodeDialog
        item={{ id: 3 }}
        open
        encodeModes={[]}
        apiRepository={apiRepository}
        onClose={vi.fn()}
        onSnackbar={onSnackbar}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '追加' }))
    expect(onSnackbar).toHaveBeenCalledWith({
      text: 'エンコード追加に失敗しました',
      severity: 'error',
    })
    expect(apiRepository.addEncode).not.toHaveBeenCalled()
    expect(JSON.parse(localStorage.getItem('AddEncodeSeting') ?? '{}')).toEqual({
      encodeMode: null,
      parentDirectory: null,
      isSaveSameDirectory: false,
      removeOriginal: false,
    })
    noPreset.unmount()

    render(
      <AddEncodeDialog
        item={{ id: 3, videoFiles: [{ id: 1 }] }}
        open
        encodeModes={['fast']}
        apiRepository={apiRepository}
        onClose={vi.fn()}
        onSnackbar={onSnackbar}
      />,
    )
    fireEvent.click(screen.getByRole('checkbox', { name: '元ファイルと同じ場所に保存する' }))
    fireEvent.click(screen.getByRole('button', { name: '追加' }))
    await waitFor(() => {
      expect(apiRepository.addEncode).toHaveBeenCalledWith({
        recordedId: 3,
        sourceVideoFileId: 1,
        mode: 'fast',
        removeOriginal: false,
        isSaveSameDirectory: true,
      })
    })
    expect(onSnackbar).toHaveBeenLastCalledWith({
      text: 'エンコード追加に失敗しました',
      severity: 'error',
    })
  })
})

describe('SendVideoFileToKodiDialog', () => {
  it('[AC 3.15] refuses to send without a host and reports send failures', async () => {
    const apiRepository = createRecordedRepository()
    const onSnackbar = vi.fn()
    const noHosts = render(
      <SendVideoFileToKodiDialog
        open
        item={{ videoFiles: [{ id: 1 }, { name: 'no id' }] }}
        hosts={[]}
        apiRepository={apiRepository}
        onClose={vi.fn()}
        onSnackbar={onSnackbar}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '#1' }))
    expect(onSnackbar).toHaveBeenCalledWith({ text: '送信に失敗しました', severity: 'error' })
    expect(apiRepository.sendVideoFileToKodi).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: /no id/ })).not.toBeInTheDocument()
    noHosts.unmount()

    vi.mocked(apiRepository.sendVideoFileToKodi).mockResolvedValue({
      ok: false,
      error: 'send-video-file-to-kodi-failed',
      message: 'failed',
    })
    render(
      <SendVideoFileToKodiDialog
        open
        item={{ name: 'Named', videoFiles: [{ id: 2, name: 'file' }] }}
        hosts={['h1']}
        apiRepository={apiRepository}
        onClose={vi.fn()}
        onSnackbar={onSnackbar}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'file' }))
    await waitFor(() => {
      expect(onSnackbar).toHaveBeenLastCalledWith({ text: '送信に失敗しました', severity: 'error' })
    })
    expect(apiRepository.sendVideoFileToKodi).toHaveBeenCalledWith({
      videoFileId: 2,
      kodiName: 'h1',
    })
  })
})

describe('RecordedStreamSelectDialog', () => {
  const streamConfig = createPlaybackNavigationConfig().streamConfig

  it('[AC 3.4] changes type and quality, then navigates and saves on watch', async () => {
    const onNavigate = vi.fn()
    const onClose = vi.fn()
    render(
      <RecordedStreamSelectDialog
        open
        item={{ id: 9 }}
        file={{ id: 1, type: 'ts' }}
        streamConfig={streamConfig}
        onClose={onClose}
        onNavigate={onNavigate}
        onSnackbar={vi.fn()}
      />,
    )

    await changeSettingsSelect('配信方式', 'HLS')
    await changeSettingsSelect('画質', 'ts-hls')
    fireEvent.click(screen.getByRole('button', { name: '視聴' }))

    expect(onNavigate).toHaveBeenCalledWith(expect.stringContaining('/recorded/streaming/1'))
    expect(onClose).toHaveBeenCalled()
    expect(JSON.parse(localStorage.getItem('RecordedSelectStreamSetting') ?? '{}')).toEqual({
      type: 'HLS',
      mode: 0,
    })
  })

  it('[AC 3.4] reports an invalid selection when no candidate exists and saves on cancel', () => {
    const onSnackbar = vi.fn()
    const onClose = vi.fn()
    render(
      <RecordedStreamSelectDialog
        open
        item={{}}
        file={{ id: 1, type: 'other' }}
        onClose={onClose}
        onNavigate={vi.fn()}
        onSnackbar={onSnackbar}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '視聴' }))
    expect(onSnackbar).toHaveBeenCalledWith({ text: '番組 ID が不正です', severity: 'error' })
    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem('RecordedSelectStreamSetting')).toBeNull()
  })
})

describe('detail dialog select height', () => {
  it('[AC 3.28] [AC 3.34] keeps the streaming and Kodi host AppSelect fields at the compact 32px height', () => {
    const streamSelectSource = readFileSync(
      'src/features/recorded/components/RecordedStreamSelectDialog.tsx',
      'utf8',
    )
    const kodiSource = readFileSync(
      'src/features/recorded/components/SendVideoFileToKodiDialog.tsx',
      'utf8',
    )

    expect(streamSelectSource).toContain('ariaLabel="配信方式"')
    expect(streamSelectSource).toContain('ariaLabel="画質"')
    expect(streamSelectSource.match(/<AppSelect/gu)).toHaveLength(2)
    expect(streamSelectSource.match(/controlHeight=\{32\}/gu)).toHaveLength(2)
    expect(kodiSource).toContain('ariaLabel="kodi host"')
    expect(kodiSource.match(/<AppSelect/gu)).toHaveLength(1)
    expect(kodiSource.match(/controlHeight=\{32\}/gu)).toHaveLength(1)
  })
})
